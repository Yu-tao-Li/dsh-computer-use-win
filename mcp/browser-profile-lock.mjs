import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const contention = new Set(['EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY', 'EPERM', 'ENOTDIR', 'EISDIR', 'ERR_FS_EISDIR']);
const mightBeBusy = error => error.code === 'ENOENT' || contention.has(error.code);
const ownerPattern = /^owner-(\d+)-[a-f0-9]{16}$/;
const incompleteClaimMs = 2000;

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function removeEmpty(directory) {
  try { rmdirSync(directory); }
  catch (error) { if (!mightBeBusy(error)) throw error; }
}

function reap(lock, deadStaging = false) {
  try {
    const entry = lstatSync(lock);
    if (entry.isFile()) {
      const pid = Number(readFileSync(lock, 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffffffff) {
        if (alive(pid)) return { pid };
      } else if (Date.now() - entry.mtimeMs < incompleteClaimMs) {
        // An old server may still be between creating its PID file and writing it.
        return {};
      }
      const current = lstatSync(lock);
      if (!current.isFile() || current.ino !== entry.ino || current.mtimeMs !== entry.mtimeMs || current.size !== entry.size) return {};
      unlinkSync(lock);
      return { removed: true };
    }
    if (!entry.isDirectory()) return { unexpected: true };
    const entries = readdirSync(lock);
    if (entries.length > 1) return { unexpected: true };
    if (!entries.length && !deadStaging && Date.now() - entry.mtimeMs < incompleteClaimMs) return {};
    if (entries.length === 1) {
      const owner = ownerPattern.exec(entries[0]);
      if (!owner) return { unexpected: true };
      const pid = Number(owner[1]);
      if (alive(pid)) return { pid };
      unlinkSync(path.join(lock, entries[0]));
    }
    rmdirSync(lock);
    return { removed: true };
  } catch (error) {
    if (!mightBeBusy(error)) throw error;
    return {};
  }
}

// Windows rename can replace an existing regular file with a directory.
// Claim with mkdir there, so an older server's live PID file remains intact.
// Only a successful creation AND owner marker on the same directory grant the lock.
function claim(lock, pending, marker) {
  if (process.platform !== 'win32') { renameSync(pending, lock); return; }
  mkdirSync(lock);
  const created = lstatSync(lock);
  try { writeFileSync(path.join(lock, marker), '', { flag: 'wx' }); }
  catch (error) { if (error.code !== 'ENOENT') removeEmpty(lock); throw error; }
  const current = lstatSync(lock);
  if (current.ino === created.ino) return;
  unlinkSync(path.join(lock, marker));
  const error = new Error('Another server replaced the empty lock directory');
  error.code = 'EBUSY';
  throw error;
}

export async function acquireProfileLock(lock, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const marker = 'owner-' + process.pid + '-' + randomBytes(8).toString('hex');
  const directory = path.dirname(lock), prefix = path.basename(lock) + '.pending-';
  const pending = process.platform === 'win32' ? null : mkdtempSync(path.join(directory, prefix + process.pid + '-'));
  let acquired = false;
  const release = async target => {
    for (let attempt = 0; ; attempt++) {
      try { unlinkSync(path.join(target, marker)); break; }
      catch (error) {
        if (error.code === 'ENOENT') break;
        if (!contention.has(error.code) || attempt >= 5) break;
        await delay(50);
      }
    }
    removeEmpty(target);
  };
  try {
    if (pending) writeFileSync(path.join(pending, marker), '', { flag: 'wx' });
    let retriedRemoval = false;
    for (;;) {
      try { claim(lock, pending, marker); acquired = true; break; }
      catch (error) { if (!mightBeBusy(error)) throw error; }
      const { removed, pid, unexpected } = reap(lock);
      if (removed && !retriedRemoval) { retriedRemoval = true; continue; }
      if (unexpected || Date.now() >= deadline) {
        const reason = unexpected ? 'The profile lock contains unexpected files.' :
          pid ? 'The profile lock belongs to running process ' + pid + '.' : 'Another DSH server may be using this browser. Try again.';
        throw new Error('BROWSER_PROFILE_BUSY: ' + reason);
      }
      await delay(100);
    }
    try {
      for (const entry of readdirSync(directory)) {
        if (!entry.startsWith(prefix)) continue;
        const owner = /^(\d+)-[A-Za-z0-9]{6}$/.exec(entry.slice(prefix.length));
        if (owner && !alive(Number(owner[1]))) reap(path.join(directory, entry), true);
      }
    } catch (error) { if (!mightBeBusy(error)) throw error; }
    return () => release(lock);
  } catch (error) {
    if (acquired || pending) await release(acquired ? lock : pending);
    throw error;
  }
}

export async function profileLock(profile, action) {
  const release = await acquireProfileLock(profile + '.dsh-lock');
  try { return await action(); }
  finally { await release(); }
}

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POWERSHELL, WORK_DIR } from './takeover.mjs';

export function backgroundDesktopArgs(name) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('../scripts/background-desktop.ps1', import.meta.url)), '-DesktopName', name];
}

// The server asks the DSH adapter for the hidden desktop by writing this file
// next to the one where the adapter then puts the desktop's name.
export const backgroundRequestFile = file => file.replace(/\.json$/i, '') + '-request.json';

export function startBackgroundDesktop(onExit) {
  if (process.platform !== 'win32') throw new Error('WCU_BACKGROUND_DESKTOP_UNAVAILABLE: use a native Windows DSH host.');
  const name = 'Wincu-' + randomUUID().replaceAll('-', '');
  const child = spawn(DEFAULT_POWERSHELL, [...backgroundDesktopArgs(name), '-Own'], { cwd: WORK_DIR, windowsHide: true });
  let disposed = false, started = false, stderr = '';
  child.stdin.on('error', () => {}); // The owner may already have exited at cleanup.
  child.stderr.setEncoding('utf8').on('data', data => { stderr = (stderr + data).slice(-2048); });
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    if (!disposed && started) onExit?.(new Error(stderr.trim() || `Background desktop owner exited (${signal ?? code})`));
    resolve();
  }));
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Background desktop startup timed out')), 20000);
    child.once('error', reject);
    closed.then(() => reject(new Error(stderr.trim() || 'Background desktop owner closed before startup')));
    lines.on('line', line => {
      if (line !== name) return;
      started = true;
      resolve();
    });
    closed.then(() => clearTimeout(timeout));
    lines.once('close', () => clearTimeout(timeout));
  });
  function dispose() {
    if (!disposed) {
      disposed = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 3000);
      timer.unref();
      closed.then(() => clearTimeout(timer));
    }
    return closed;
  }
  return { name, ready: ready.then(() => { lines.close(); }, error => { void dispose(); throw error; }), dispose };
}

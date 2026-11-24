import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/hyperv-desktop.ps1', import.meta.url));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

// Pluggable VM backend interface (#101): future adapters (such as VMware vmrun
// or VirtualBox VBoxManage guestcontrol) implement this same contract:
// { id, capabilities, start(mode, name, env), configure(name), probe() }.
function start(mode, name, env = process.env) {
  if (process.platform !== 'win32') throw new Error('WCU_HYPERV_UNAVAILABLE: use a native Windows DSH host to run in Hyper-V.');
  // A saved name controls one exact VM. Nothing from a tool request becomes a command.
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || /[\u0000-\u001f]/.test(name)) {
    throw new Error('WCU_HYPERV_VM_REQUIRED: choose a local Hyper-V virtual machine in Computer Use settings.');
  }
  return spawn(powershell, ['-NoProfile', '-File', script, '-Mode', mode, '-VMName', name], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
  });
}

function configure(name) {
  return new Promise((resolve, reject) => {
    const worker = start('Configure', name);
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => worker.kill(), 85_000);
    worker.stdout.setEncoding('utf8').on('data', chunk => { stdout = (stdout + chunk).slice(-8192); });
    worker.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
    worker.once('error', error => { clearTimeout(deadline); reject(error); });
    worker.once('close', code => {
      clearTimeout(deadline);
      if (code !== 0) { reject(new Error(stderr.trim() || 'The Hyper-V connection could not be configured.')); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); }
      catch { reject(new Error('Windows did not return a connection result.')); }
    });
  });
}

function probe() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: true, backend: 'hyperv', available: false, reason: 'platform' });
  return new Promise(resolve => {
    const worker = spawn(powershell, ['-NoProfile', '-File', script, '-Mode', 'Probe'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; worker.kill(); }, 20_000);
    worker.stdout.setEncoding('utf8').on('data', chunk => { stdout = (stdout + chunk).slice(-8192); });
    worker.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
    worker.once('error', error => {
      clearTimeout(deadline);
      resolve({ ok: false, backend: 'hyperv', error: String(error.message || error) });
    });
    worker.once('close', code => {
      clearTimeout(deadline);
      if (timedOut) { resolve({ ok: false, backend: 'hyperv', error: 'Hyper-V availability check timed out.' }); return; }
      if (code !== 0) { resolve({ ok: false, backend: 'hyperv', error: stderr.trim() || 'Could not check Hyper-V availability.' }); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); }
      catch { resolve({ ok: false, backend: 'hyperv', error: 'Windows did not return a Hyper-V availability result.' }); }
    });
  });
}

export const hypervBackend = Object.freeze({
  id: 'hyperv',
  capabilities: Object.freeze({
    isolatedDesktop: true,
    needsSignedInDesktop: true,
    guestNodeMajor: 22,
  }),
  start,
  configure,
  probe,
});

export const VM_BACKENDS = Object.freeze({ hyperv: hypervBackend });

export function vmBackend(id = 'hyperv') {
  const backend = VM_BACKENDS[id];
  if (!backend) throw new Error(`WCU_VM_BACKEND_UNKNOWN: unsupported VM backend '${id}'.`);
  return backend;
}

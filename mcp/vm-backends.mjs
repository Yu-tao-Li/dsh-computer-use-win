import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/hyperv-desktop.ps1', import.meta.url));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const scriptArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];

const REMOTE_HOST_ERROR = 'WCU_REMOTE_HOST_REQUIRED: enter the remote Windows address (IP or computer name, optional :port) in Computer Use settings.';

// Pluggable VM backend interface (#101): Hyper-V covers local Hyper-V VMs,
// while WinRM covers VMware, VirtualBox, and other Windows machines with
// WinRM enabled (including Windows Home hosts). Every backend implements:
// { id, capabilities, start(mode, target, env), configure(target), probe() }.
export function parseRemoteHost(text) {
  if (typeof text !== 'string') throw new Error(REMOTE_HOST_ERROR);
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('-') || /[\u0000-\u001f\s]/.test(trimmed)) {
    throw new Error(REMOTE_HOST_ERROR);
  }
  let host, portText;
  const bracketed = trimmed.match(/^\[([0-9A-Fa-f:]+)\](?::(\d+))?$/);
  if (bracketed) {
    host = bracketed[1];
    portText = bracketed[2];
    if (!host.includes(':')) throw new Error(REMOTE_HOST_ERROR);
  } else {
    const simple = trimmed.match(/^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(?::(\d+))?$/);
    if (!simple) throw new Error(REMOTE_HOST_ERROR);
    host = simple[1];
    portText = simple[2];
  }
  let port = 5985;
  if (portText !== undefined) {
    port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(REMOTE_HOST_ERROR);
  }
  return { host, port };
}

function makeConfigure(startFn, fallbackError = 'The VM connection could not be configured.') {
  return target => new Promise((resolve, reject) => {
    const worker = startFn('Configure', target);
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => worker.kill(), 85_000);
    worker.stdout.setEncoding('utf8').on('data', chunk => { stdout = (stdout + chunk).slice(-8192); });
    worker.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
    worker.once('error', error => { clearTimeout(deadline); reject(error); });
    worker.once('close', code => {
      clearTimeout(deadline);
      if (code !== 0) { reject(new Error(stderr.trim() || fallbackError)); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); }
      catch { reject(new Error('Windows did not return a connection result.')); }
    });
  });
}

function startHyperv(mode, name, env = process.env) {
  if (process.platform !== 'win32') throw new Error('WCU_HYPERV_UNAVAILABLE: use a native Windows DSH host to run in Hyper-V.');
  // A saved name controls one exact VM. Nothing from a tool request becomes a command.
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || /[\u0000-\u001f]/.test(name)) {
    throw new Error('WCU_HYPERV_VM_REQUIRED: choose a local Hyper-V virtual machine in Computer Use settings.');
  }
  return spawn(powershell, [...scriptArgs, '-Mode', mode, '-Backend', 'HyperV', '-VMName', name], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
  });
}

function probeHyperv() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: true, backend: 'hyperv', available: false, reason: 'platform' });
  return new Promise(resolve => {
    const worker = spawn(powershell, [...scriptArgs, '-Mode', 'Probe'], {
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

function startWinrm(mode, target, env = process.env) {
  if (process.platform !== 'win32') throw new Error('WCU_REMOTE_UNAVAILABLE: use a native Windows DSH host to connect to a remote Windows PC.');
  parseRemoteHost(target);
  return spawn(powershell, [...scriptArgs, '-Mode', mode, '-Backend', 'WinRM', '-Target', target.trim()], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
  });
}

function probeWinrm() {
  return Promise.resolve({
    ok: true,
    backend: 'winrm',
    available: process.platform === 'win32',
    reason: process.platform === 'win32' ? null : 'platform',
  });
}

export const hypervBackend = Object.freeze({
  id: 'hyperv',
  capabilities: Object.freeze({
    isolatedDesktop: true,
    needsSignedInDesktop: true,
    guestNodeMajor: 22,
  }),
  start: startHyperv,
  configure: makeConfigure(startHyperv, 'The Hyper-V connection could not be configured.'),
  probe: probeHyperv,
});

export const winrmBackend = Object.freeze({
  id: 'winrm',
  capabilities: Object.freeze({
    isolatedDesktop: true,
    needsSignedInDesktop: true,
    guestNodeMajor: 22,
    network: true,
  }),
  start: startWinrm,
  configure: makeConfigure(startWinrm, 'The remote Windows connection could not be configured.'),
  probe: probeWinrm,
});

export const VM_BACKENDS = Object.freeze({ hyperv: hypervBackend, winrm: winrmBackend });

export function vmBackend(id = 'hyperv') {
  const backend = VM_BACKENDS[id];
  if (!backend) throw new Error(`WCU_VM_BACKEND_UNKNOWN: unsupported VM backend '${id}'.`);
  return backend;
}

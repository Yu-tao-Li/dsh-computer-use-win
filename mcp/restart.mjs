// "Restart now" after an update on DSH Desktop. The plugin market restarts
// only a host nothing supervises, and DSH Desktop supervises its host, so the
// settings page asks the plugin instead: a helper that Explorer starts (outside
// DSH's process tree, on the user's desktop) quits DSH Desktop the way its
// installer does and opens it again (scripts/restart-dsh.ps1). Hosts that are
// not DSH Desktop report no support, and the page then says how to restart by
// hand.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trustedRequest } from './diagnostics.mjs';
import { DEFAULT_POWERSHELL } from './takeover.mjs';

export const RESTART_ROUTE = '/dsh-computer-use-win/api/restart';
const script = fileURLToPath(new URL('../scripts/restart-dsh.ps1', import.meta.url));

// The adapter runs inside DSH Desktop's host process, whose executable is DSH
// Desktop itself; a dsh CLI or web host runs on node.exe instead.
export function desktopExecutable(execPath = process.execPath, platform = process.platform) {
  return platform === 'win32' && path.win32.basename(execPath).toLowerCase() === 'dsh desktop.exe' ? execPath : null;
}

// Explorer's desktop folder view runs the helper, as launch_app does (#55): it
// becomes Explorer's child on the user's desktop, so quitting DSH does not end
// it, and the second DSH Desktop instance it starts finds the running one. (A
// process that WMI creates is not on that desktop, and its quit request never
// reached DSH.)
export function restartArguments(executable) {
  return `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" -Executable "${executable}"`;
}
export function startRestart(executable, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(DEFAULT_POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
      "$windows = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39')); " +
      '$location = 0; $root = $null; $hwnd = 0; ' +
      '$desktop = $windows.FindWindowSW([ref]$location, [ref]$root, 8, [ref]$hwnd, 1); ' +
      'if ($null -eq $desktop) { exit 3 }; ' +
      "$desktop.Document.Application.ShellExecute($env:WCU_RESTART_FILE, $env:WCU_RESTART_ARGUMENTS, '', 'open', 0); exit 0"],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, WCU_RESTART_FILE: DEFAULT_POWERSHELL, WCU_RESTART_ARGUMENTS: restartArguments(executable) } });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Windows did not start the restart helper (${code}).`)));
  });
}

export function createRestartHandler({ executable = desktopExecutable(), start = startRestart, logger } = {}) {
  let started = false;
  return async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    if (!trustedRequest(request)) return send(403, { ok: false });
    if (request.method === 'GET') return send(200, { supported: executable !== null });
    if (request.method !== 'POST') return send(405, { ok: false });
    if (!executable) return send(409, { ok: false, error: 'WCU_RESTART_UNSUPPORTED' });
    // One restart per host process: a second click while DSH quits is the same request.
    if (started) return send(200, { ok: true });
    try {
      await start(executable);
      started = true;
      logger?.info?.('dsh-computer-use-win: restarting DSH Desktop for the plugin update');
      send(200, { ok: true });
    } catch (error) {
      send(500, { ok: false, error: String(error?.message || error).slice(0, 300) });
    }
  };
}

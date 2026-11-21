// "Restart now" after an update on DSH Desktop. The plugin market restarts
// only a host nothing supervises, and DSH Desktop supervises its host, so the
// settings page asks the plugin instead: a helper started through WMI (outside
// DSH's process tree) quits DSH Desktop the way its installer does and opens it
// again (scripts/restart-dsh.ps1). Hosts that are not DSH Desktop report no
// support, and the page then says how to restart by hand.
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

// Win32_Process.Create makes the helper a child of the WMI provider in this
// user's interactive session, so quitting DSH does not end it with DSH's tree.
export function restartCommand(executable) {
  return `"${DEFAULT_POWERSHELL}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" -Executable "${executable}"`;
}
export function startRestart(executable, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(DEFAULT_POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
      '$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; ' +
      '$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:WCU_RESTART_COMMAND; ProcessStartupInformation = $startup }; ' +
      'exit [int]$result.ReturnValue'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WCU_RESTART_COMMAND: restartCommand(executable) } });
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

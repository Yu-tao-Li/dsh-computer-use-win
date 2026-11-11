// #79: DSH and this server can run inside WSL, where powershell.exe is reached
// through interop. Scripts must reach PowerShell as Windows paths, results must
// hand DSH's file tools Linux paths, and the server's variables must be listed
// in WSLENV. And when the stop listener (the takeover helper) cannot start,
// only real input is refused: reads and browser-lane calls need no listener.
// No desktop access; the listener's executable deliberately does not exist.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STOPPED, TakeoverControl, IN_WSL, linuxPath, windowsEnv, windowsPath } from '../mcp/takeover.mjs';

assert.equal(IN_WSL, false, 'This Windows run is not WSL');
const noWslpath = () => { throw new Error('wslpath unavailable'); };
const wsl = { wsl: true, distro: 'Ubuntu-24.04' };
assert.equal(windowsPath('/home/isee/.dsh/x.ps1', { ...wsl, convert: (flag, file) => flag === '-w' && file === '/home/isee/.dsh/x.ps1' ? '\\\\wsl.localhost\\Ubuntu-24.04\\home\\isee\\.dsh\\x.ps1' : '' }),
  '\\\\wsl.localhost\\Ubuntu-24.04\\home\\isee\\.dsh\\x.ps1', 'wslpath -w decides when it is there');
assert.equal(windowsPath('/home/isee/.dsh/x.ps1', { ...wsl, convert: noWslpath }), '\\\\wsl.localhost\\Ubuntu-24.04\\home\\isee\\.dsh\\x.ps1', 'A Linux file is reached through the distribution share');
assert.equal(windowsPath('/mnt/c/Users/ISee/x.ps1', { ...wsl, convert: noWslpath }), 'C:\\Users\\ISee\\x.ps1', 'A Windows drive mounted under /mnt is that drive');
assert.equal(windowsPath('/mnt/d', { ...wsl, convert: noWslpath }), 'D:\\');
assert.equal(windowsPath('/home/isee/x.ps1', { wsl: false }), '/home/isee/x.ps1', 'Outside WSL nothing changes');
assert.equal(windowsPath('C:\\x.ps1', wsl), 'C:\\x.ps1', 'A Windows path stays as it is');
assert.equal(linuxPath('D:\\AppData\\Temp\\windows-computer-use-1.png', { wsl: true, convert: noWslpath }), '/mnt/d/AppData/Temp/windows-computer-use-1.png', 'Screenshots are read through /mnt');
assert.equal(linuxPath('C:\\a b\\x.png', { wsl: true, convert: (flag, file) => flag === '-u' ? '/c/' + file.slice(3).replaceAll('\\', '/') : '' }), '/c/a b/x.png', 'wslpath -u decides when it is there (custom automount root)');
assert.equal(linuxPath('C:\\x.png', { wsl: false }), 'C:\\x.png');
assert.equal(linuxPath('/tmp/x.png', { wsl: true, convert: noWslpath }), '/tmp/x.png', 'A Linux path stays as it is');
const shared = windowsEnv({ WSLENV: 'USERPROFILE/p:WCU_BACKEND_TRACE', WCU_CANCEL_EVENT: 'Local\\DSH-WCU-x', WCU_BACKEND_TRACE: '1' }, ['WCU_CANCEL_EVENT', 'WCU_BACKEND_TRACE'], { wsl: true });
assert.equal(shared.WSLENV, 'USERPROFILE/p:WCU_BACKEND_TRACE:WCU_CANCEL_EVENT/w', 'Missing names are added once (/w: WSL starting Windows), listed ones kept');
assert.equal(shared.WCU_CANCEL_EVENT, 'Local\\DSH-WCU-x');
assert.equal(windowsEnv({ PATH: 'x' }, ['WCU_CANCEL_EVENT'], { wsl: false }).WSLENV, undefined, 'Outside WSL the environment is unchanged');
console.log('PASS WSL paths both ways and WSLENV for the backend variables');

// A stop listener that cannot start blocks real input only, for this series.
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-listener-failure-'));
const activityFile = path.join(root, 'activity.json'), stateFile = path.join(root, 'state.json');
await writeFile(activityFile, JSON.stringify({ active: true, sessionId: 's', turn: 1, indicator: true, expiresAt: Date.now() + 60000 }) + '\n');
const stops = [];
const control = new TakeoverControl({ powershell: path.join(root, 'no-such-powershell.exe'), activityFile, stateFile, testMode: true, onStop: error => stops.push(error.message) });
control.disabledForTest = false;
let starts = 0;
const start = control.start.bind(control);
control.start = () => { starts++; return start(); };
try {
  await assert.rejects(control.begin(), error => /^COMPUTER_USE_PAUSED: /.test(error.message) && /reading the screen and browser-lane calls still work/.test(error.message), 'Real input is refused with the reason');
  assert.equal(control.paused, true);
  assert.ok(stops.length >= 1, 'Calls in flight are cancelled');
  const tried = starts;
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(starts, tried, 'The overlay poll does not launch the helper again in this series');
  await control.begin({ quiet: true });
  assert.equal(control.active, 1, 'A read takes its quiet lease');
  await control.end({ quiet: true });
  await assert.rejects(control.begin(), error => /^COMPUTER_USE_PAUSED: /.test(error.message), 'Real input stays refused in this series');
  // A stop by the user still refuses everything.
  control.paused = false; control.blockedSeries.clear(); control.fail(new Error(STOPPED));
  await assert.rejects(control.begin({ quiet: true }), error => error.message === STOPPED, 'After Esc nothing runs in this series');
  console.log('PASS a stop listener that cannot start refuses real input only; Esc still stops everything');
} finally { await control.close(); }

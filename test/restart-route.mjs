// "Restart now" on DSH Desktop: the route answers only the settings page,
// reports support only inside DSH Desktop, starts the helper once, and the
// helper is started through WMI with the fixed script and the executable.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createRestartHandler, desktopExecutable, restartCommand, startRestart, RESTART_ROUTE } from '../mcp/restart.mjs';

assert.equal(RESTART_ROUTE, '/dsh-computer-use-win/api/restart');
const desktop = 'C:\\Users\\me\\AppData\\Local\\Programs\\DSH Desktop\\DSH Desktop.exe';
assert.equal(desktopExecutable(desktop, 'win32'), desktop);
assert.equal(desktopExecutable('C:\\Program Files\\nodejs\\node.exe', 'win32'), null, 'a dsh CLI or web host runs on node');
assert.equal(desktopExecutable(desktop, 'linux'), null);
const command = restartCommand(desktop);
assert.match(command, /-File "[^"]+[\\/]scripts[\\/]restart-dsh\.ps1" -Executable "C:\\Users\\me\\AppData\\Local\\Programs\\DSH Desktop\\DSH Desktop\.exe"$/);
assert.ok(command.includes('-NonInteractive') && command.includes('-WindowStyle Hidden'));

function response() {
  const result = { status: 0, body: null };
  result.writeHead = status => { result.status = status; };
  result.end = text => { result.body = JSON.parse(text); };
  return result;
}
const trusted = method => ({ method, headers: { host: '127.0.0.1:5173', 'x-wcu-request': '1', origin: 'http://127.0.0.1:5173' } });
async function ask(handler, request) { const res = response(); await handler(request, res); return res; }

let starts = 0;
const handler = createRestartHandler({ executable: desktop, start: async executable => { assert.equal(executable, desktop); starts++; } });
assert.equal((await ask(handler, { method: 'POST', headers: { host: '127.0.0.1:5173' } })).status, 403, 'a request without the page header is refused');
assert.equal((await ask(handler, { ...trusted('POST'), headers: { ...trusted('POST').headers, origin: 'http://evil.example' } })).status, 403);
assert.deepEqual((await ask(handler, trusted('GET'))).body, { supported: true });
assert.equal((await ask(handler, trusted('PUT'))).status, 405);
const first = await ask(handler, trusted('POST'));
assert.deepEqual([first.status, first.body], [200, { ok: true }]);
assert.deepEqual((await ask(handler, trusted('POST'))).body, { ok: true }, 'a second click while DSH quits is the same restart');
assert.equal(starts, 1);

const outside = createRestartHandler({ executable: null, start: async () => { throw new Error('must not start'); } });
assert.deepEqual((await ask(outside, trusted('GET'))).body, { supported: false });
const refused = await ask(outside, trusted('POST'));
assert.deepEqual([refused.status, refused.body.error], [409, 'WCU_RESTART_UNSUPPORTED']);

const failing = createRestartHandler({ executable: desktop, start: async () => { throw new Error('Windows did not start the restart helper (8).'); } });
const failed = await ask(failing, trusted('POST'));
assert.equal(failed.status, 500);
assert.match(failed.body.error, /restart helper/);

// The WMI call: Win32_Process.Create with the helper command in the environment.
let spawned;
const fakeSpawn = (file, args, options) => {
  spawned = { file, args, options };
  const child = new EventEmitter();
  setImmediate(() => child.emit('close', 0));
  return child;
};
await startRestart(desktop, fakeSpawn);
assert.match(path.basename(spawned.file).toLowerCase(), /^powershell\.exe$/);
assert.ok(spawned.args.at(-1).includes('Invoke-CimMethod -ClassName Win32_Process -MethodName Create'));
assert.equal(spawned.options.env.WCU_RESTART_COMMAND, command);
assert.equal(spawned.options.windowsHide, true);
const failSpawn = () => { const child = new EventEmitter(); setImmediate(() => child.emit('close', 9)); return child; };
await assert.rejects(startRestart(desktop, failSpawn), /restart helper \(9\)/);

console.log(JSON.stringify({ passed: true, trustedOnly: true, desktopOnly: true, oneRestart: true, wmiLaunch: true }));

// "Restart now" on DSH Desktop: the route answers only the settings page,
// reports support only inside DSH Desktop, starts the helper once, and the
// helper is started through Explorer with the fixed script and the executable.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRestartHandler, desktopExecutable, startRestart, RESTART_ROUTE } from '../mcp/restart.mjs';
import { DEFAULT_POWERSHELL } from '../mcp/takeover.mjs';

assert.equal(RESTART_ROUTE, '/dsh-computer-use-win/api/restart');
const desktop = 'C:\\Users\\me\\AppData\\Local\\Programs\\DSH Desktop\\DSH Desktop.exe';
assert.equal(desktopExecutable(desktop, 'win32'), desktop);
assert.equal(desktopExecutable('C:\\Program Files\\nodejs\\node.exe', 'win32'), null, 'a dsh CLI or web host runs on node');
assert.equal(desktopExecutable(desktop, 'linux'), null);

// Load the route as an installed copy, then replace its package path with a
// build that has no restart helper. A running host retains the original code.
const install = await mkdtemp(path.join(os.tmpdir(), 'wcu-restart-after-replace-'));
await cp(new URL('../mcp', import.meta.url), path.join(install,'mcp'), { recursive:true, filter:source=>!/(?:FILE_LOG|FILE_INDEX|FILE_HISTORY|file-log\.lock)/.test(path.basename(String(source))) });
await mkdir(path.join(install,'scripts'));
await cp(new URL('../scripts/restart-dsh.ps1', import.meta.url), path.join(install,'scripts/restart-dsh.ps1'));
const running = await import(pathToFileURL(path.join(install,'mcp/restart.mjs')).href);
await rename(path.join(install,'scripts/restart-dsh.ps1'),path.join(install,'previous-helper.ps1'));

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
const [first, concurrent] = await Promise.all([ask(handler, trusted('POST')), ask(handler, trusted('POST'))]);
assert.deepEqual([first.status, first.body], [200, { ok: true }]);
assert.deepEqual([concurrent.status, concurrent.body], [200, { ok: true }]);
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

// Explorer's desktop folder view starts the helper; its command line travels in the environment.
let spawned;
const fakeSpawn = (file, args, options) => {
  spawned = { file, args, options };
  const child = new EventEmitter();
  setImmediate(() => child.emit('close', 0));
  return child;
};
const quotedDesktop = "C:\\O'Brien\\DSH Desktop.exe";
await running.startRestart(quotedDesktop, fakeSpawn);
assert.match(path.basename(spawned.file).toLowerCase(), /^powershell\.exe$/);
assert.ok(spawned.args.at(-1).includes('FindWindowSW') && spawned.args.at(-1).includes('ShellExecute($env:WCU_RESTART_FILE, $env:WCU_RESTART_ARGUMENTS'));
assert.equal(spawned.options.env.WCU_RESTART_FILE, DEFAULT_POWERSHELL);
const command = spawned.options.env.WCU_RESTART_ARGUMENTS;
assert.ok(command.includes('-NonInteractive') && command.includes('-WindowStyle Hidden'));
assert.ok(command.endsWith(`-Executable "${quotedDesktop}"`));
const [, stagedHelper] = command.match(/-File "([^"]+)"/);
assert.ok(path.isAbsolute(stagedHelper));
assert.ok(!stagedHelper.startsWith(install));
const script = await readFile(stagedHelper, 'utf8');
assert.ok(script.includes('--dsh-installer-quit'), 'the staged helper still contains the original script');
assert.ok(script.includes('Remove-Item -LiteralPath $PSCommandPath'));
await unlink(stagedHelper);
await rmdir(path.dirname(stagedHelper));
assert.equal(spawned.options.windowsHide, true);
const failSpawn = () => { const child = new EventEmitter(); setImmediate(() => child.emit('close', 9)); return child; };
await assert.rejects(startRestart(desktop, failSpawn), /restart helper \(9\)/);

console.log(JSON.stringify({ passed: true, trustedOnly: true, desktopOnly: true, oneRestart: true, explorerLaunch: true }));

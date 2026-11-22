// The check the settings page runs before it asks the plugin market for an
// update (mcp/update-guard.mjs): the plugin's folder can be renamed away and
// back only when nothing holds it, and the market's folder swap needs exactly
// that. Then the plugin itself, installed under node_modules and running (a
// backend answering, the stop listener up), must not be what holds it: its
// processes start in the user's home folder. No keyboard or mouse input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createUpdateReadyHandler, probeReplaceable } from '../mcp/update-guard.mjs';
import { McpTestClient } from './mcp-test-client.mjs';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'wcu-update-guard-'));
const plugin = (name = 'dsh-computer-use-win') => {
  const root = path.join(mkdtempSync(path.join(temp, 'profile-')), 'node_modules', name);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{}');
  writeFileSync(path.join(root, 'scripts', 'a.txt'), 'x');
  return root;
};
const intact = root => existsSync(path.join(root, 'package.json')) && existsSync(path.join(root, 'scripts', 'a.txt'));
const checks = [];
const check = (value, name) => { assert.ok(value, name); checks.push(name); };

// Free: renamed away and back, nothing changed.
const free = plugin();
check((await probeReplaceable(free)).ready === true && intact(free), 'a folder nothing holds can be replaced, and stays as it was');
// Only a package the market installed is checked.
let renamed = 0;
const linked = path.join(temp, 'checkout');
mkdirSync(linked);
check(JSON.stringify(await probeReplaceable(linked, { rename: () => { renamed++; } })) === JSON.stringify({ ready: true, checked: false }) && renamed === 0, 'a folder outside node_modules is not touched');
// The way back is retried until it works.
const moves = [];
let refusals = 2, warned = 0;
const flaky = (from, to) => { moves.push([from, to]); if (from.includes('.wcu-update-check-') && refusals-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); renameSync(from, to); };
const retried = plugin();
check((await probeReplaceable(retried, { rename: flaky, wait: async () => {}, logger: { warn: () => warned++ } })).ready === true && intact(retried) && moves.length === 4 && warned === 1, 'a refused way back is retried, and logged once');
// A refusal going away leaves everything where it was.
const refused = plugin();
const denied = await probeReplaceable(refused, { rename: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } });
check(denied.ready === false && denied.code === 'EPERM' && intact(refused), 'a refused rename reports the folder as held and moves nothing');

if (process.platform === 'win32') {
  // What held the folder on 2026-11-22: a process working in one of its folders.
  const held = plugin();
  const sleeper = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 30'], { cwd: path.join(held, 'scripts'), windowsHide: true, stdio: 'ignore' });
  try {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const result = await probeReplaceable(held);
    check(result.ready === false && ['EPERM', 'EACCES', 'EBUSY'].includes(result.code) && intact(held), 'a process working inside the folder holds it; nothing moves');
  } finally { sleeper.kill(); }
  await new Promise(resolve => sleeper.once('exit', resolve));
  check((await probeReplaceable(held)).ready === true, 'and once it is gone the folder can be replaced');
  // An open file anywhere inside holds the folder too.
  const open = plugin();
  const fd = openSync(path.join(open, 'scripts', 'a.txt'), 'r');
  try { check((await probeReplaceable(open)).ready === false && intact(open), 'an open file inside holds the folder'); }
  finally { closeSync(fd); }
}

// The route: this plugin's header, POST only, the probe's answer as JSON.
const answer = async (handler, { method = 'POST', headers = { host: '127.0.0.1:5140', 'x-wcu-request': '1' } } = {}) => {
  const response = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await handler({ method, headers }, response);
  return { status: response.status, data: response.body ? JSON.parse(response.body) : null };
};
const routed = createUpdateReadyHandler({ probe: async () => ({ ready: false, checked: true, code: 'EPERM' }) });
check((await answer(routed, { headers: { host: '127.0.0.1:5140' } })).status === 403, 'the route refuses a request without the plugin header');
check((await answer(routed, { method: 'GET' })).status === 405, 'the route takes POST only');
const held = await answer(routed);
check(held.status === 200 && held.data.ok === true && held.data.ready === false && held.data.code === 'EPERM', 'the route answers what the probe found');
const broken = await answer(createUpdateReadyHandler({ probe: async () => { throw new Error('could not move back'); } }));
check(broken.status === 500 && broken.data.ok === false, 'a probe that cannot finish is a 500');

// The plugin as the market installs it, running: a backend answering a call
// and the stop listener up. Neither may hold its folder.
let live = { skipped: 'Windows only' };
if (process.platform === 'win32') {
  const installed = path.join(temp, 'live-profile', 'node_modules', 'dsh-computer-use-win');
  for (const file of JSON.parse(readFileSync(path.join(checkout, 'package.json'), 'utf8')).files.concat('package.json')) {
    mkdirSync(path.dirname(path.join(installed, file)), { recursive: true });
    cpSync(path.join(checkout, file), path.join(installed, file));
  }
  const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
  const client = new McpTestClient(process.execPath, [path.join(installed, 'mcp', 'server.mjs')], {
    cwd: temp,
    env: { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_BROWSER_LANE: 'off', WCU_INDICATOR: '0', WINDOWS_CU_POWERSHELL: powershell },
  });
  const { TakeoverControl } = await import(pathToFileURL(path.join(installed, 'mcp', 'takeover.mjs')).href);
  const control = new TakeoverControl({ powershell, stateFile: path.join(temp, 'takeover-state.json'), testMode: true });
  control.disabledForTest = false;
  try {
    await client.init();
    const listed = await client.call('windows_computer_use_list_windows', {});
    assert.ok(!listed.isError, 'the installed copy answers: ' + JSON.stringify(listed.content?.[0]?.text ?? '').slice(0, 300));
    await control.command('status');
    const { probeReplaceable: probeInstalled } = await import(pathToFileURL(path.join(installed, 'mcp', 'update-guard.mjs')).href);
    const result = await probeInstalled(installed);
    check(result.ready === true && result.checked === true, 'the running plugin (a backend and the stop listener) does not hold its own folder: ' + JSON.stringify(result));
    live = { backend: true, stopListener: true, ready: result.ready };
  } finally {
    await control.close().catch(() => {});
    client.close();
  }
}
console.log(JSON.stringify({ passed: true, checks: checks.length, live }));

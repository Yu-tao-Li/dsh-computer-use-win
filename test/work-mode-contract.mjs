// What each work mode sends the backend, with a recording fake backend: Low
// disruption borrows real input right away, marks its calls so the backend
// holds and replays the user's own input, waits only while the user holds a
// key or button or is in a full-screen app, and never keeps a window in
// front; Foreground keeps it in front for input; a server without DSH
// settings behaves as before; old desktop choices read as Low disruption.
// No desktop input.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpTestClient } from './mcp-test-client.mjs';
import { normalizeSettings, repairStaleSettings, toolSelectionKey } from '../mcp/settings.mjs';

// Settings: the old choices carry over silently, the mode switch needs no new server.
assert.equal(normalizeSettings({}).desktopTarget, 'quiet');
assert.equal(normalizeSettings({ desktopTarget: 'current' }).desktopTarget, 'quiet');
assert.equal(normalizeSettings({ desktopTarget: 'background' }).desktopTarget, 'quiet');
assert.deepEqual(repairStaleSettings({ desktopTarget: 'background' }), { value: { desktopTarget: 'quiet' }, repaired: [], migrated: true });
assert.equal(repairStaleSettings({ desktopTarget: 'fast' }).migrated, false);
assert.equal(toolSelectionKey({ desktopTarget: 'quiet' }), toolSelectionKey({ desktopTarget: 'fast' }));
assert.notEqual(toolSelectionKey({ desktopTarget: 'quiet' }), toolSelectionKey({ desktopTarget: 'hyperv', hypervVm: 'vm' }));
assert.equal(normalizeSettings({ desktopTarget: 'fast', browserAttachUser: true }).browserAttachUser, true);
assert.equal(normalizeSettings({ desktopTarget: 'hyperv', browserAttachUser: true }).browserAttachUser, false);

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-work-mode-'));
await cp(new URL('../mcp', import.meta.url), path.join(root, 'mcp'), { recursive: true, filter: source => !/^FILE_(LOG|INDEX|HISTORY)\./.test(path.basename(String(source))) && !String(source).endsWith('.file-log.lock') });
await mkdir(path.join(root, 'scripts'));
const log = path.join(root, 'requests.jsonl');
await writeFile(path.join(root, 'scripts/windows-uia.ps1'), `param([switch]$Persistent)
[Console]::WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress))
while($null -ne ($line=[Console]::In.ReadLine())) {
  [IO.File]::AppendAllText($env:WCU_FAKE_LOG, $line + [char]10)
  $r=$line | ConvertFrom-Json
  if ($r.action -eq 'input_state') { [Console]::WriteLine((@{id=$r.id;ok=$true;action='input_state';held=($env:WCU_FAKE_HELD -eq '1');fullscreen=($env:WCU_FAKE_FULLSCREEN -eq '1');notification=5;foreground=[long]$env:WCU_FAKE_FOREGROUND} | ConvertTo-Json -Compress)); continue }
  [Console]::WriteLine((@{id=$r.id;ok=$true;action=$r.action;verification='sent';windows=@()} | ConvertTo-Json -Depth 20 -Compress))
}
`);

async function session(env, run) {
  await rm(log, { force: true });
  const client = new McpTestClient(process.execPath, [path.join(root, 'mcp/server.mjs')], {
    env: { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_BROWSER_LANE: 'off', WCU_FAKE_LOG: log, WCU_FAKE_HELD: '0', WCU_FAKE_FULLSCREEN: '0', WCU_FAKE_FOREGROUND: '1', WCU_SETTINGS_JSON: undefined, WCU_WORK_MODE: undefined, ...env },
  });
  try {
    await client.init();
    await run(async (name, args) => client.call('windows_computer_use_' + name, args));
  } finally { client.close(); }
}
const sent = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const data = result => JSON.parse(result.content[0].text);

// Low disruption: one look at the user's state (no idle wait), then the click,
// marked so the backend holds the user's input, and not kept in front.
await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget: 'quiet' }) }, async call => {
  assert.equal(data(await call('health', {})).workMode, 'quiet');
  await rm(log, { force: true });
  const started = Date.now();
  assert.ok(!(await call('click', { x: 5, y: 5, activate: true })).isError);
  assert.ok(Date.now() - started < 1500, 'no pause before real input');
  const requests = await sent();
  assert.deepEqual(requests.map(request => request.action), ['input_state', 'click']);
  assert.equal(requests[1].args.activate, false);
  assert.equal(requests[1].args._wcuLowDisruption, true);
  // A background-first element action checks nothing first; it is marked, so a
  // window its app keeps in front is guarded.
  await rm(log, { force: true });
  assert.ok(!(await call('invoke', { elementId: 'uia:rt:1.2.3' })).isError);
  const background = await sent();
  assert.deepEqual(background.map(request => request.action), ['invoke']);
  assert.equal(background[0].args._wcuLowDisruption, true);
  // activate_window stays an explicit request to bring a window forward.
  await rm(log, { force: true });
  assert.ok(!(await call('activate_window', { nativeWindowHandle: 4242 })).isError);
  assert.deepEqual((await sent()).map(request => request.action), ['input_state', 'activate_window']);
});

// Old saved choices are Low disruption.
for (const desktopTarget of ['current', 'background']) {
  await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget }) }, async call => {
    assert.equal(data(await call('health', {})).workMode, 'quiet');
  });
}

// A key or button the user keeps holding: nothing is sent, and the agent is told why.
await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget: 'quiet' }), WCU_FAKE_HELD: '1', WCU_TEST_HELD_LIMIT_MS: '700' }, async call => {
  const result = await call('click', { x: 5, y: 5 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /WCU_USER_INPUT_HELD/);
  assert.ok(!(await sent()).some(request => request.action === 'click'), 'no input while the user holds a key');
});

// A full-screen app or presentation in front: real input waits, then gives up;
// in the full-screen window DSH works in itself, it goes ahead.
await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget: 'quiet' }), WCU_FAKE_FULLSCREEN: '1', WCU_FAKE_FOREGROUND: '4242', WCU_TEST_FULLSCREEN_LIMIT_MS: '700' }, async call => {
  const result = await call('click', { x: 5, y: 5 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /WCU_USER_FULLSCREEN/);
  assert.ok(!(await sent()).some(request => request.action === 'click'), 'no input over the user\'s full-screen app');
  await rm(log, { force: true });
  assert.ok(!(await call('click', { x: 5, y: 5, nativeWindowHandle: 4242 })).isError);
  assert.deepEqual((await sent()).map(request => request.action), ['input_state', 'click']);
});

// Foreground: input keeps its window in front; reads do not; nothing is checked first.
await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget: 'fast' }) }, async call => {
  assert.equal(data(await call('health', {})).workMode, 'fast');
  await rm(log, { force: true });
  assert.ok(!(await call('click', { x: 5, y: 5 })).isError);
  assert.ok(!(await call('invoke', { elementId: 'uia:rt:1.2.3', nativeWindowHandle: 4242 })).isError);
  assert.ok(!(await call('find', { query: 'Save', nativeWindowHandle: 4242, ocrFallback: false })).isError);
  const requests = await sent();
  assert.deepEqual(requests.map(request => request.action), ['click', 'invoke', 'find']);
  assert.equal(requests[0].args.activate, true);
  assert.equal(requests[1].args.activate, true);
  assert.equal(requests[2].args.activate, false);
  assert.ok(requests.every(request => request.args._wcuLowDisruption === undefined));
});

// Without DSH settings the server behaves as before.
await session({}, async call => {
  assert.equal(data(await call('health', {})).workMode, 'direct');
  await rm(log, { force: true });
  assert.ok(!(await call('click', { x: 5, y: 5, activate: true })).isError);
  assert.ok(!(await call('click', { x: 5, y: 5 })).isError);
  const requests = await sent();
  assert.deepEqual(requests.map(request => request.action), ['click', 'click']);
  assert.equal(requests[0].args.activate, true);
  assert.equal(requests[1].args.activate, false);
  assert.ok(requests.every(request => request.args._wcuLowDisruption === undefined));
});

console.log(JSON.stringify({ passed: true, quietBorrowsAtOnce: true, quietMarksHold: true, heldKeyRefused: true, fullscreenRefused: true, foregroundKeepsFront: true, directUnchanged: true, legacyChoicesMigrated: true }));

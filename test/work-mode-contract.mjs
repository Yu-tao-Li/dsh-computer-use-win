// What each work mode sends the backend, with a recording fake backend: Low
// disruption reads the user's idle time before real input and never keeps a
// window in front, Full speed keeps it in front for input, a server without
// DSH settings behaves as before, and old desktop choices read as Low
// disruption. No desktop input.
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
  if ($r.action -eq 'input_idle') { [Console]::WriteLine((@{id=$r.id;ok=$true;action='input_idle';idleMs=[int]$env:WCU_FAKE_IDLE_MS} | ConvertTo-Json -Compress)); continue }
  [Console]::WriteLine((@{id=$r.id;ok=$true;action=$r.action;verification='sent';windows=@()} | ConvertTo-Json -Depth 20 -Compress))
}
`);

async function session(env, run) {
  await rm(log, { force: true });
  const client = new McpTestClient(process.execPath, [path.join(root, 'mcp/server.mjs')], {
    env: { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_BROWSER_LANE: 'off', WCU_FAKE_LOG: log, WCU_FAKE_IDLE_MS: '5000', WCU_SETTINGS_JSON: undefined, WCU_WORK_MODE: undefined, ...env },
  });
  try {
    await client.init();
    await run(async (name, args) => client.call('windows_computer_use_' + name, args));
  } finally { client.close(); }
}
const sent = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const data = result => JSON.parse(result.content[0].text);

// Low disruption: the idle time first, then the click, which is not kept in front.
await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget: 'quiet' }) }, async call => {
  assert.equal(data(await call('health', {})).workMode, 'quiet');
  await rm(log, { force: true });
  assert.ok(!(await call('click', { x: 5, y: 5, activate: true })).isError);
  const requests = await sent();
  assert.deepEqual(requests.map(request => request.action), ['input_idle', 'click']);
  assert.equal(requests[1].args.activate, false);
  // A background-first element action reads no idle time.
  await rm(log, { force: true });
  assert.ok(!(await call('invoke', { elementId: 'uia:rt:1.2.3' })).isError);
  assert.deepEqual((await sent()).map(request => request.action), ['invoke']);
  // activate_window stays an explicit request to bring a window forward.
  await rm(log, { force: true });
  assert.ok(!(await call('activate_window', { nativeWindowHandle: 4242 })).isError);
  assert.deepEqual((await sent()).map(request => request.action), ['input_idle', 'activate_window']);
});

// Old saved choices are Low disruption.
for (const desktopTarget of ['current', 'background']) {
  await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget }) }, async call => {
    assert.equal(data(await call('health', {})).workMode, 'quiet');
  });
}

// A user who keeps working: nothing is sent, and the agent is told why.
await session({ WCU_SETTINGS_JSON: JSON.stringify({ desktopTarget: 'quiet' }), WCU_FAKE_IDLE_MS: '0', WCU_TEST_USER_PAUSE_LIMIT_MS: '700' }, async call => {
  const result = await call('click', { x: 5, y: 5 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /WCU_USER_ACTIVE/);
  assert.ok(!(await sent()).some(request => request.action === 'click'), 'no input after an unbroken stream of user input');
});

// Full speed: input keeps its window in front; reads do not; no idle reading.
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
});

console.log(JSON.stringify({ passed: true, quietWaitsAndKeepsForeground: true, userActiveRefused: true, fastKeepsFront: true, directUnchanged: true, legacyChoicesMigrated: true }));

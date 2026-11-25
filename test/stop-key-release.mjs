// The stop listener swallows Esc (or the custom stop key) while DSH controls
// the desktop. The release must still reach Windows whenever Windows saw the
// press: a hook call that runs past LowLevelHooksTimeout is passed on, and
// swallowing the release would leave the key down for every app; a stuck Esc
// cancels each drag and drop (#99). Arming a series also installs a fresh hook,
// because Windows drops a hook that overran its timeout without saying so.
// Keys go through the helper's test seam; no input is sent and nothing is shown.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TakeoverControl } from '../mcp/takeover.mjs';

const ESC = 0x1B, F8 = 0x77, A = 0x41;
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-stop-key-release-'));
const control = new TakeoverControl({ powershell: process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe', stateFile: path.join(root, 'state.json'), testMode: true });
control.disabledForTest = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = (vk, down, extra = {}) => control.command('test_key', { vk, down, injected: false, ...extra });
const begin = () => control.command('begin', { indicatorEnabled: false, cursorIndicatorEnabled: false, stopShortcut: 'F8' });
const installs = async () => (await control.command('status')).keyboardInstalls;
async function rearm() {
  const before = await installs();
  await control.command('resume');
  await begin();
  let now = before;
  for (let i = 0; i < 80 && now <= before; i++) { await sleep(25); now = await installs(); }
  return { before, now };
}
try {
  assert.ok(await installs() >= 1, 'the listener starts with its hook installed');
  let hooks = await rearm();
  assert.ok(hooks.now > hooks.before, `arming a series installs a fresh hook (${hooks.before} -> ${hooks.now})`);

  let reply = await key(ESC, true);
  assert.equal(reply.consumed, true, 'Esc stops the series and is swallowed');
  assert.equal(reply.paused, true);
  reply = await key(ESC, false, { systemDown: false });
  assert.equal(reply.consumed, true, 'a release whose press never reached Windows stays swallowed');

  hooks = await rearm();
  assert.ok(hooks.now > hooks.before, 'every new series installs a fresh hook');
  reply = await key(ESC, true);
  assert.equal(reply.consumed, true);
  reply = await key(ESC, false, { systemDown: true });
  assert.equal(reply.consumed, false, 'Windows saw Esc go down, so it must see Esc go up');

  await rearm();
  reply = await key(F8, true);
  assert.equal(reply.consumed, true, 'the custom stop key stops the series');
  assert.equal(reply.paused, true);
  reply = await key(F8, false, { systemDown: true });
  assert.equal(reply.consumed, false, 'the custom stop key follows the same rule');

  await rearm();
  assert.equal((await key(A, true)).consumed, false, 'other keys pass');
  assert.equal((await key(A, false, { systemDown: true })).consumed, false);
  await control.command('stop');
  assert.equal((await key(ESC, true)).consumed, false, 'a stopped listener lets Esc through');
  assert.equal((await key(ESC, false, { systemDown: true })).consumed, false);
} finally { await control.close(); }
console.log(JSON.stringify({ passed: true, releaseKeptWhenPressSwallowed: true, releasePassesWhenWindowsSawPress: true, customStopKey: true, otherKeysPass: true, hookReinstalledOnArm: true, physicalInputSent: false }));

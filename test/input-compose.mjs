// Low disruption waits while the user is in the middle of input-method text:
// the stop listener's keyboard hook notes letters and the keys that commit
// them. Keys go through the helper's test seam; no input is sent.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TakeoverControl } from '../mcp/takeover.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-input-compose-'));
const control = new TakeoverControl({ powershell: process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe', stateFile: path.join(root, 'state.json'), testMode: true });
control.disabledForTest = false;
const press = async (...keys) => {
  for (const vk of keys) await control.command('test_key', { vk, down: true, injected: false });
  for (const vk of keys.reverse()) await control.command('test_key', { vk, down: false, injected: false });
};
try {
  assert.equal(await control.composing(), null, 'without the helper nothing is known');
  await control.command('status');
  await control.command('test_ime', { native: true });
  assert.equal(await control.composing(), false, 'nothing typed yet');
  await press(0x4E); await press(0x49);
  assert.equal(await control.composing(), true, 'pinyin typed, not committed');
  await press(0x20);
  assert.equal(await control.composing(), false, 'space commits');
  await press(0x48);
  assert.equal(await control.composing(), true);
  await press(0x31);
  assert.equal(await control.composing(), false, 'a digit picks a candidate');
  await press(0xA2, 0x53);
  assert.equal(await control.composing(), false, 'Ctrl+S is a shortcut');
  await press(0xA0, 0x41);
  assert.equal(await control.composing(), false, 'Shift+A types a Latin capital');
  await control.command('test_ime', { native: false });
  await press(0x41);
  assert.equal(await control.composing(), false, 'an input method in Latin mode');
  await control.command('test_ime', { native: true });
  assert.equal(await control.composing(), true);
  await new Promise(resolve => setTimeout(resolve, 4300));
  assert.equal(await control.composing(), false, 'text left alone for 4 s no longer holds DSH up');
  await control.command('test_key', { vk: 0x41, injected: true });
  assert.equal(await control.composing(), false, 'DSH\'s own keys are not the user\'s');
} finally { await control.close(); }
console.log(JSON.stringify({ passed: true, composingTracked: true, commitKeys: true, shortcutsIgnored: true, latinModeIgnored: true, staleAfter4s: true, ownKeysIgnored: true }));

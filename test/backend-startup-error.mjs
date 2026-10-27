// #54: a backend that cannot start must say why, and the shipped backend must
// start from a helper cache that .NET Framework treats as remote. No input.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-startup-error-'));
const clients = [];
const baseEnv = { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_INDICATOR: '0', WINDOWS_CU_POWERSHELL: process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe' };
const text = result => (result.content || []).map(part => part.text || '').join('\n');

async function server(name, { script, temp } = {}) {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, 'mcp'), { recursive: true }); await mkdir(path.join(dir, 'scripts'));
  for (const file of ['server.mjs', 'settings.mjs', 'takeover.mjs', 'browser.mjs']) await copyFile(path.join(source, 'mcp', file), path.join(dir, 'mcp', file));
  await copyFile(path.join(source, 'package.json'), path.join(dir, 'package.json'));
  if (script) await writeFile(path.join(dir, 'scripts/windows-uia.ps1'), script);
  else await copyFile(path.join(source, 'scripts/windows-uia.ps1'), path.join(dir, 'scripts/windows-uia.ps1'));
  const env = temp ? { ...baseEnv, TEMP: temp, TMP: temp } : baseEnv;
  const client = new McpTestClient(process.execPath, [path.join(dir, 'mcp/server.mjs')], { env });
  clients.push(client); await client.init(); return client;
}
const health = client => client.request('tools/call', { name: 'windows_computer_use_health', arguments: {} }, 90000);
async function stop(client) {
  client.child.stdin.end();
  for (let i = 0; i < 50 && client.child.exitCode === null; i++) await delay(100);
  if (client.child.exitCode === null) { client.child.kill(); await new Promise(resolve => client.child.once('exit', resolve)); }
}

try {
  // 1. The backend's own startup line reaches the model, with the exit code.
  const quoted = await server('startup-line', { script: `[Console]::Error.WriteLine('WCU_BACKEND_STARTUP_FAILED stage=native-load-start: fixture reason (HRESULT 0x80131515)')\nexit 3\n` });
  let result = await health(quoted);
  assert.equal(result.isError, true, text(result));
  assert.match(text(result), /Backend process exited \(exit code 3\): WCU_BACKEND_STARTUP_FAILED stage=native-load-start: fixture reason \(HRESULT 0x80131515\)/);
  result = await health(quoted);
  assert.match(text(result), /fixture reason/, 'A respawned backend that fails again is explained again');
  console.log('PASS startup failure line and exit code reach the tool result, on every respawn');

  // 2. Without that line, the last meaningful error lines, not PowerShell's position markers.
  const record = await server('error-record', { script: `[Console]::Error.WriteLine('Exception calling "Load" with "1" argument(s): "fixture failure"')\n[Console]::Error.WriteLine('At C:\\\\fixture.ps1:1 char:1')\n[Console]::Error.WriteLine('+ [void][Reflection.Assembly]::Load($x)')\n[Console]::Error.WriteLine('+ ~~~~~~~~~~~~~~~~~~')\nexit 1\n` });
  result = await health(record);
  assert.equal(result.isError, true);
  assert.match(text(result), /Backend process exited \(exit code 1\): Exception calling "Load" with "1" argument\(s\): "fixture failure"/);
  assert.doesNotMatch(text(result), /~~~|char:1/);
  console.log('PASS PowerShell error records are reduced to their message');

  // 3. The shipped backend names its stage when its helper cannot be built
  // (TEMP is a file here, so nothing can be written below it).
  const blocked = path.join(root, 'temp-is-a-file'); await writeFile(blocked, 'not a directory');
  const missing = await server('blocked-temp', { temp: blocked });
  result = await health(missing);
  assert.equal(result.isError, true, text(result));
  assert.match(text(result), /Backend process exited \(exit code 3\): WCU_BACKEND_STARTUP_FAILED stage=native-load-start: /);
  console.log(`PASS real startup failure explained: ${text(result).slice(0, 220)}`);

  // 4. The shipped backend starts from an Internet-zone helper cache (#54).
  const cache = path.join(root, 'zone-cache'); await mkdir(cache);
  let client = await server('zone-first', { temp: cache });
  result = await health(client);
  assert.equal(result.isError, undefined, text(result));
  await stop(client);
  const dlls = (await readdir(cache)).filter(name => /^wcu-native-[0-9a-f]{16}\.dll$/.test(name));
  assert.equal(dlls.length, 1, 'The first start caches the native helper');
  for (const name of dlls) await writeFile(path.join(cache, name + ':Zone.Identifier'), '[ZoneTransfer]\r\nZoneId=3\r\n');
  assert.match(await readFile(path.join(cache, dlls[0] + ':Zone.Identifier'), 'utf8'), /ZoneId=3/);
  client = await server('zone-second', { temp: cache });
  result = await health(client);
  assert.equal(result.isError, undefined, text(result));
  assert.equal(JSON.parse(result.content[0].text).ok, true);
  console.log('PASS the shipped backend starts from an Internet-zone helper cache');
} finally {
  await Promise.all(clients.map(stop));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('wcu-startup-error-'));
  await rm(root, { recursive: true, force: true });
}

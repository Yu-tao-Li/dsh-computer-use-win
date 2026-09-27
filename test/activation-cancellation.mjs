// Exercise cancellation of reads that can activate a window, without user32/input.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-activation-test-'));
await mkdir(path.join(root, 'mcp'));
await mkdir(path.join(root, 'scripts'));
await writeFile(path.join(root, 'mcp/server.mjs'), await readFile(new URL('../mcp/server.mjs', import.meta.url)));
const fixturePath = root.replaceAll("'", "''");
await writeFile(path.join(root, 'scripts/windows-uia.ps1'), `
param([switch]$Persistent)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $r = $line | ConvertFrom-Json
  if ($r.args.activate) {
    [IO.File]::WriteAllText((Join-Path '${fixturePath}' ($r.action + '.started')), 'started')
    try { Start-Sleep -Milliseconds 600 }
    finally { [IO.File]::WriteAllText((Join-Path '${fixturePath}' ($r.action + '.released')), 'released') }
  }
  [Console]::WriteLine((@{id=$r.id;ok=$true} | ConvertTo-Json -Compress))
}
`);
const client = new McpTestClient(process.execPath, [path.join(root, 'mcp/server.mjs')], {
  env: { ...process.env, WINDOWS_CU_POWERSHELL: process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe' }
});
const call = (tool, args = {}) => client.request('tools/call', { name: 'windows_computer_use_' + tool, arguments: args });
const exists = file => access(file).then(() => true, () => false);

try {
  await client.init();
  const cases = [['snapshot', 'snapshot'], ['accessibility_tree', 'tree'], ['find', 'find'], ['element_info', 'element_info'], ['ocr', 'ocr']];
  for (const [tool, action] of cases) {
    assert.equal((await call('wait', { milliseconds: 1 })).isError, undefined);
    const id = client.next;
    const active = call(tool, { activate: true, windowTitle: 'synthetic', includeScreenshot: false });
    const started = path.join(root, action + '.started');
    for (let i = 0; i < 500 && !await exists(started); i++) await delay(10);
    assert.ok(await exists(started), `${tool} did not start`);
    const queued = call('wait', { milliseconds: 1 });
    client.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } }) + '\n');
    assert.equal((await queued).isError, true);
    // Retirement blocks new calls while the activation cleanup still owns input.
    const stopping = await call('wait', { milliseconds: 1 });
    assert.equal(stopping.content[0].text, 'COMPUTER_USE_STOPPING');
    const cancelled = await active;
    assert.equal(cancelled.content[0].text, 'COMPUTER_USE_CANCELLED_AFTER_CURRENT_ACTION');
    assert.equal(await readFile(path.join(root, action + '.released'), 'utf8'), 'released');
    assert.equal((await call('wait', { milliseconds: 1 })).isError, undefined);
  }
  console.log('PASS activation-aware cancellation, queue rejection, cleanup and replacement for five read tools (synthetic input only)');
} finally {
  client.child.stdin.end();
  const timer = setTimeout(() => client.child.kill(), 5000);
  if (client.child.exitCode === null) await new Promise(resolve => client.child.once('exit', resolve));
  clearTimeout(timer);
  // Retain isolated fixture markers for diagnosing a failed run.
}

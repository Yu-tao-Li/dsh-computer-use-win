// Temporary audit: same-runner controls for the synthetic worker's first cmdlet.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { makeProfile, hostConfig, probe } from './bundle-startup.mjs';
import electron from 'electron';

const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-worker-autoload-audit-'));
const results = [];
const variants = [
  ['baseline', '', 'ConvertFrom-Json', 'ConvertTo-Json'],
  ['qualified', '', 'Microsoft.PowerShell.Utility\\ConvertFrom-Json', 'Microsoft.PowerShell.Utility\\ConvertTo-Json'],
  ['explicit-import', 'Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop', 'ConvertFrom-Json', 'ConvertTo-Json']
];
function workerSource(prelude, decode, encode) {
  return `param([switch]$Persistent)
$clock = [Diagnostics.Stopwatch]::StartNew()
[Console]::Error.WriteLine('entry ' + $clock.ElapsedMilliseconds)
[Console]::Error.WriteLine('PSModulePath=' + $env:PSModulePath)
[Console]::Error.WriteLine('utilityBefore=' + (Get-Module Microsoft.PowerShell.Utility).Count)
${prelude}
[Console]::Error.WriteLine('preludeDone ' + $clock.ElapsedMilliseconds)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  [Console]::Error.WriteLine('read ' + $clock.ElapsedMilliseconds)
  $request = $line | ${decode}
  [Console]::Error.WriteLine('decoded ' + $clock.ElapsedMilliseconds)
  [Console]::Error.WriteLine('utilityPath=' + (Get-Command ${decode}).Module.Path)
  if ($request.action -notin @('health', 'wait')) { throw 'Unexpected fixture action' }
  if ($request.action -eq 'wait') { Start-Sleep -Milliseconds 1 }
  [Console]::WriteLine((@{id=$request.id;ok=$true;action=$request.action;testFixture=$true} | ${encode} -Compress))
  [Console]::Error.WriteLine('replied ' + $clock.ElapsedMilliseconds)
}
[Console]::Error.WriteLine('eof ' + $clock.ElapsedMilliseconds)
`;
}
for (const [name, prelude, decode, encode] of variants) {
  const temp = path.join(root, name);
  await mkdir(temp);
  const file = path.join(temp, 'worker.ps1');
  await writeFile(file, workerSource(prelude, decode, encode));
  const start = performance.now();
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', file, '-Persistent'], {
    env: { ...getDefaultEnvironment(), TEMP: temp, TMP: temp }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '', responseMs = null, exitMs = null;
  const timer = setTimeout(() => child.kill(), 65000);
  child.stdout.on('data', bytes => { stdout += bytes; responseMs ??= Math.round(performance.now() - start); });
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.on('exit', () => { exitMs = Math.round(performance.now() - start); });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  child.stdin.end('{"id":1,"action":"health","args":{}}\n');
  await done;
  clearTimeout(timer);
  const result = { kind: 'raw-worker', name, powershell, responseMs, exitMs, closeMs: Math.round(performance.now() - start), exitCode: child.exitCode, stdout, stderr };
  results.push(result);
  console.log('AUDIT ' + JSON.stringify(result));
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
}
// Test targeted module loading with the actual shipped bundle and SDK too.
const fixture = await makeProfile();
await writeFile(path.join(fixture.installed, 'scripts/windows-uia.ps1'), workerSource(...variants[2].slice(1)));
for (const [name, command, isElectron] of [['node', process.execPath, false], ['electron', electron, true]]) {
  const host = hostConfig(command, fixture, isElectron);
  const temp = path.join(fixture.root, name + '-temp');
  await mkdir(temp);
  const result = await probe(host.config, { TEMP: temp, TMP: temp });
  console.log('AUDIT ' + JSON.stringify({ kind: 'bundle', name, powershell, ...result }));
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.healthOk, true);
  assert.equal(result.waitOk, true);
  assert.equal(result.toolCount, 22);
  assert.equal(result.resourceCount, 6);
}

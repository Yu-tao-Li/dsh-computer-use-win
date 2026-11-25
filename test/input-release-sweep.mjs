// Release sweep after a backend dies during real input (#99).
// Uses a fake PowerShell backend and sends zero real input.
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-wincu-release-sweep-'));
const clients = [];
const env = {
  ...process.env,
  NODE_ENV: 'test',
  WCU_TEST_NO_TAKEOVER: '1',
  WCU_INDICATOR: '0',
  WINDOWS_CU_POWERSHELL: process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe',
};

async function fixture(name, crashOnClick = false) {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, 'mcp'), { recursive: true });
  await mkdir(path.join(dir, 'scripts'));
  await cp(path.join(source, 'mcp'), path.join(dir, 'mcp'), { recursive: true });

  const signature = 'function runBackend(action, args = {}, timeoutMs = 30000, request) {';
  let server = await readFile(path.join(source, 'mcp/server.mjs'), 'utf8');
  assert.ok(server.includes(signature), 'Expected runBackend signature in mcp/server.mjs');
  server = server.replace(
    signature,
    signature + ' timeoutMs = (action === "click" || (action === "wait" && args.milliseconds === 5000)) ? 1500 : 15000;',
  );
  await writeFile(path.join(dir, 'mcp/server.mjs'), server);

  const logFile = path.join(dir, 'actions.log');
  const fakeBackend = [
    'param([switch]$Persistent)',
    `\$log = '${logFile.replaceAll("'", "''")}'`,
    "[Console]::WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress))",
    'while($null -ne ($line=[Console]::In.ReadLine())){',
    '  if([string]::IsNullOrWhiteSpace($line)){continue}',
    '  $r=$line|ConvertFrom-Json',
    '  [IO.File]::AppendAllText($log, "$PID $($r.action)`n")',
    "  if($r.action -eq 'click'){[IO.File]::WriteAllText($env:WCU_INPUT_RECOVERY_FILE,'1');" +
      (crashOnClick ? 'exit 47}' : 'Start-Sleep -Milliseconds 5000}'),
    "  elseif($r.action -eq 'release_input'){if([IO.File]::ReadAllText($env:WCU_INPUT_RECOVERY_FILE) -ne '1'){throw 'Missing journal'};[IO.File]::Delete($env:WCU_INPUT_RECOVERY_FILE)}",
    "  elseif($r.action -eq 'wait'){Start-Sleep -Milliseconds ([int]$r.args.milliseconds)}",
    '  [Console]::WriteLine((@{id=$r.id;ok=$true;held=$false;fullscreen=$false;notification=5;foreground=0;released=@()}|ConvertTo-Json -Compress))',
    '}',
    '',
  ].join('\n');
  await writeFile(path.join(dir, 'scripts/windows-uia.ps1'), fakeBackend, 'utf8');

  const client = new McpTestClient(process.execPath, [path.join(dir, 'mcp/server.mjs')], { env });
  clients.push(client);
  await client.init();
  return { client, logFile };
}

const call = (client, name, args = {}) => client.request('tools/call', { name: 'windows_computer_use_' + name, arguments: args });

async function readLog(logFile) {
  const text = await readFile(logFile, 'utf8').catch(() => '');
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [pid, action] = l.split(/\s+/);
    return { pid, action };
  });
}

try {
  // Scenario A: timeout during real input (`click`) triggers `release_input` on the replacement backend.
  const a = await fixture('real-input-timeout');
  assert.equal((await call(a.client, 'wait', { milliseconds: 1 })).isError, undefined);
  const before = await readLog(a.logFile);
  assert.ok(before.length >= 1);
  const firstPid = before[0].pid;

  const timedOut = await call(a.client, 'click', { x: 1, y: 2 });
  assert.equal(timedOut.isError, true);
  assert.match(timedOut.content[0].text, /timed out after 1500ms/);

  // Send immediately so the test exercises the recovery gate rather than
  // waiting for the new backend's first action before issuing another call.
  assert.equal((await call(a.client, 'wait', { milliseconds: 1 })).isError, undefined);
  const newPidEntries = (await readLog(a.logFile)).filter(e => e.pid !== firstPid);
  assert.ok(newPidEntries.length > 0, 'Replacement backend never started after click timeout');
  assert.equal(newPidEntries[0].action, 'release_input', 'First action on replacement backend must be release_input');
  assert.equal(newPidEntries[1].action, 'wait');
  assert.doesNotMatch(a.client.stderr, /Missing journal|release sweep failed/);

  // Scenario B: timeout during non-input (`wait`) must NOT trigger `release_input`.
  const b = await fixture('non-input-timeout');
  const waitTimedOut = await call(b.client, 'wait', { milliseconds: 5000 });
  assert.equal(waitTimedOut.isError, true);
  assert.match(waitTimedOut.content[0].text, /timed out after 1500ms/);
  const bBefore = await readLog(b.logFile);
  assert.equal(bBefore.length, 1);
  const bFirstPid = bBefore[0].pid;

  assert.equal((await call(b.client, 'wait', { milliseconds: 1 })).isError, undefined);
  const bNewEntries = (await readLog(b.logFile)).filter(e => e.pid !== bFirstPid);
  assert.ok(bNewEntries.length >= 1, 'Replacement backend did not log follow-up wait');
  assert.equal(bNewEntries[0].action, 'wait', 'Non-input timeout must not run release_input');

  const c = await fixture('real-input-crash', true);
  const crash = await call(c.client, 'click', { x: 1, y: 2 });
  assert.equal(crash.isError, true);
  assert.match(crash.content[0].text, /Backend process exited \(exit code 47\)/);
  assert.equal((await call(c.client, 'wait', { milliseconds: 1 })).isError, undefined);
  const crashedActions = await readLog(c.logFile);
  const afterCrash = crashedActions.filter(entry => entry.pid !== crashedActions[0].pid);
  assert.deepEqual(afterCrash.map(entry => entry.action), ['release_input', 'wait']);
  assert.doesNotMatch(c.client.stderr, /Missing journal|release sweep failed/);

  console.log('PASS release sweep runs after real-input timeout and crash, skips non-input timeout; no physical input');
} finally {
  for (const client of clients) client.child.stdin.end();
  await Promise.all(clients.map(async client => {
    for (let i = 0; i < 50 && client.child.exitCode === null; i++) await delay(100);
    if (client.child.exitCode === null) {
      client.child.kill();
      await new Promise(resolve => client.child.once('exit', resolve));
    }
  }));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('dsh-wincu-release-sweep-'));
  await rm(root, { recursive: true, force: true });
}

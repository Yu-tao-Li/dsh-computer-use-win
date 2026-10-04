// Parse and evaluate the shipped DSH bundle in real Node/Electron hosts, then
// launch its configured child through the official MCP SDK. A deterministic
// PowerShell protocol fixture keeps this transport test independent of UIA.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import electron from 'electron';
import yaml from 'js-yaml';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const script = fileURLToPath(import.meta.url);
const checkout = fileURLToPath(new URL('../', import.meta.url));

export async function makeProfile() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-bundle-startup-'));
  const profile = path.join(root, 'profile with spaces');
  const installed = path.join(profile, 'node_modules', 'dsh-computer-use-win');
  await mkdir(installed, { recursive: true });
  await writeFile(path.join(profile, 'package.json'), '{"name":"startup-fixture","private":true}\n');
  for (const entry of ['package.json', 'cordis.patch.yml', 'mcp', 'scripts', 'docs']) {
    await cp(path.join(checkout, entry), path.join(installed, entry), { recursive: true });
  }
  return { root, profile, installed };
}

async function evaluateBundle(profile, patchPath) {
  const baseUrl = pathToFileURL(path.join(profile, 'cordis.yml')).href;
  const js = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    construct: source => vm.runInNewContext(source, { process, baseUrl, URL })
  });
  const patch = yaml.load(await readFile(patchPath, 'utf8'), {
    schema: yaml.DEFAULT_SCHEMA.extend([js])
  });
  const rows = patch.flatMap(layer => layer.insert || []);
  const entries = rows.filter(row => row.id === 'mcp-dsh-computer-use-win');
  assert.equal(entries.length, 1, 'Expected one wincu bundle entry');
  return {
    config: entries[0].config,
    runtime: { execPath: process.execPath, node: process.versions.node, electron: process.versions.electron || null }
  };
}

export function hostConfig(command, fixture, isElectron = false) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (isElectron) env.ELECTRON_RUN_AS_NODE = '1';
  const result = spawnSync(command, [script, '--host', fixture.profile, path.join(fixture.installed, 'cordis.patch.yml')], {
    env, windowsHide: true, encoding: 'utf8', timeout: 15000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export async function probe(config, extraEnv = {}) {
  const started = performance.now();
  const stagesMs = {};
  async function timed(name, operation) {
    const start = performance.now();
    try { return await operation(); }
    finally {
      stagesMs[name] = Math.round((performance.now() - start) * 100) / 100;
    }
  }
  const env = { ...getDefaultEnvironment() };
  // Do not let the host's Node-mode flag mask a missing bundle environment.
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    TEMP: process.env.TEMP || os.tmpdir(), TMP: process.env.TMP || os.tmpdir(),
    WINDOWS_CU_POWERSHELL: process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe',
    WCU_INDICATOR: '0'
  }, config.env || {}, extraEnv);
  const transport = new StdioClientTransport({
    command: config.command, args: config.args, env, stderr: 'pipe'
  });
  const client = new Client({ name: 'wcu-bundle-startup-test', version: '1.0.0' }, {
    capabilities: {}, versionNegotiation: { mode: 'auto' }
  });
  let stderr = '';
  transport.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('MCP startup timeout (15000ms)')), 15000);
  });
  let result = { connected: false };
  try {
    await timed('connect', () => Promise.race([client.connect(transport), deadline]));
    clearTimeout(timer);
    result = { connected: true, serverInfo: client.getServerVersion() };
    const list = await timed('listTools', () => client.listTools());
    result.toolCount = list.tools.length;
    const reply = await timed('health', () => client.callTool({ name: 'windows_computer_use_health', arguments: {} }));
    const healthText = reply.content.find(item => item.type === 'text').text;
    if (reply.isError) throw new Error(healthText);
    const health = JSON.parse(healthText);
    const wait = await timed('wait', () => client.callTool({ name: 'windows_computer_use_wait', arguments: { milliseconds: 1 } }));
    const resources = await timed('listResources', () => client.listResources());
    result = {
      ...result,
      healthOk: health.ok === true && reply.isError !== true,
      waitOk: wait.isError !== true, resourceCount: resources.resources.length
    };
  } catch (error) {
    result = { ...result, error: String(error) };
  } finally {
    clearTimeout(timer);
    await timed('clientClose', () => client.close().catch(() => {}));
    await timed('transportClose', () => transport.close().catch(() => {}));
  }
  return { ...result, elapsedMs: Math.round(performance.now() - started), stagesMs, stderr };
}

async function main() {
  const suiteStarted = performance.now();
  const fixture = await makeProfile();
  // Only this test-created copy is replaced. Real backend coverage lives in
  // selftest and native-window-discovery; package smoke uses the shipped file.
  // An unqualified first cmdlet can make Windows PowerShell 5.1 discover the
  // runner's unrelated modules for tens of seconds. Load only the built-in
  // module used by this fixture; keep the shipped backend and environment intact.
  await writeFile(path.join(fixture.installed, 'scripts', 'windows-uia.ps1'), `param([switch]$Persistent)
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $request = $line | ConvertFrom-Json
  if ($request.action -notin @('health', 'wait')) { throw 'Unexpected fixture action' }
  if ($request.action -eq 'wait') { Start-Sleep -Milliseconds 1 }
  [Console]::WriteLine((@{id=$request.id;ok=$true;action=$request.action;testFixture=$true} | ConvertTo-Json -Compress))
}
`);
  const expectedVersion = JSON.parse(await readFile(path.join(fixture.installed, 'package.json'), 'utf8')).version;
  const results = [];
  console.log(`Bundle startup artifacts: ${fixture.root}`);
  const setupMs = Math.round(performance.now() - suiteStarted);
  console.log(`BUNDLE_TIMING ${JSON.stringify({ phase: 'setup', durationMs: setupMs })}`);
  for (const [name, command, isElectron] of [['node', process.execPath, false], ['electron', electron, true]]) {
    const hostStarted = performance.now();
    const host = hostConfig(command, fixture, isElectron);
    const hostEvaluationMs = Math.round(performance.now() - hostStarted);
    assert.equal(host.config.command, command);
    assert.equal(host.config.transport, 'stdio');
    assert.equal(host.config.serverName, 'wincu');
    assert.equal(host.config.env?.ELECTRON_RUN_AS_NODE, '1', 'Bundle must explicitly set the child Node-mode flag');
    const temp = path.join(fixture.root, name + '-temp');
    await mkdir(temp);
    const result = await probe(host.config, { TEMP: temp, TMP: temp });
    results.push({ name, runtime: host.runtime, hostEvaluationMs, ...result });
    console.log(`BUNDLE_TIMING ${JSON.stringify({ powershell: process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe', ...results.at(-1) })}`);
    await writeFile(path.join(fixture.root, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.connected, true, result.error || result.stderr);
    assert.equal(result.serverInfo.name, 'windows-computer-use');
    assert.equal(result.serverInfo.version, expectedVersion);
    assert.equal(result.toolCount, 22);
    assert.equal(result.healthOk, true);
    // Catch the old 12-30 second synthetic-worker stall even when it succeeds.
    // This is a test budget with ample runner headroom, not a production timeout.
    assert.ok(result.stagesMs.health < 10000, `Synthetic health exceeded 10000ms: ${JSON.stringify(result)}`);
    assert.equal(result.waitOk, true);
    assert.equal(result.resourceCount, 6);
    console.log(`PASS ${name} bundle -> MCP initialize / 22 tools / health / wait / 6 resources (synthetic PowerShell worker)`);
  }
  console.log(`BUNDLE_TIMING ${JSON.stringify({ phase: 'suite', durationMs: Math.round(performance.now() - suiteStarted) })}`);
}

if (process.argv[2] === '--host') {
  console.log(JSON.stringify(await evaluateBundle(process.argv[3], process.argv[4])));
} else if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}

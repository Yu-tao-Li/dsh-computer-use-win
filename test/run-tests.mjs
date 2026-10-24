// Each suite gets a separate process and TEMP/TMP directory. No physical input.
// Live UIA suites open and close only dedicated fixture windows.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('These backend regression tests require Windows.');
const checkout = fileURLToPath(new URL('../', import.meta.url));
const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-isolated-tests-'));
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `artifactRoot=${root}\n`);
const suites = [
  ['source-encoding', process.execPath, ['test/source-encoding.mjs']],
  ['tool-context', process.execPath, ['test/tool-context.mjs']],
  ['lazy-tools', process.execPath, ['test/lazy-tools.mjs']],
  ['client-settings-contract', process.execPath, ['test/client-settings-contract.mjs']],
  ['schema-compatibility',process.execPath,['test/schema-compatibility.mjs']],
  ['takeover-native', process.execPath, ['test/takeover-native.mjs']],
  ['activity-series',process.execPath,['test/activity-series.mjs']],
  ['atomic-json', process.execPath, ['test/atomic-json.mjs']],
  ['takeover-cancellation', powershell, ['-NoProfile', '-File', 'test/takeover-cancellation.ps1']],
  ['selftest', process.execPath, ['mcp/server.mjs', '--self-test']],
  ['mcp-roundtrip', process.execPath, ['test/mcp-test.mjs', 'mcp/server.mjs', 'windows_computer_use_wait', '{"milliseconds":1}']],
  ['profile-resolution', process.execPath, ['test/profile-resolution.mjs']],
  ['bundle-startup', process.execPath, ['test/bundle-startup.mjs']],
  ['backend-lifecycle', process.execPath, ['test/backend-lifecycle.mjs']],
  ['observation-contract', process.execPath, ['test/observation-contract.mjs']],
  ['activation-cancellation', process.execPath, ['test/activation-cancellation.mjs']],
  ['native-window-discovery', process.execPath, ['test/native-window-discovery.mjs']],
  ['native-window-contract', powershell, ['-NoProfile', '-File', 'test/native-window-contract.ps1']],
  ['native-health-contract', powershell, ['-NoProfile', '-File', 'test/native-health-contract.ps1']],
  ['window-capture-contract', powershell, ['-NoProfile', '-File', 'test/window-capture-contract.ps1']],
  ['uia-cache-contract', powershell, ['-NoProfile', '-File', 'test/uia-cache-contract.ps1']],
  ['uia-native-smoke', process.execPath, ['test/uia-native-smoke.mjs', path.join(root, 'uia-native-smoke')]],
  ['uia-chromium-smoke', process.execPath, ['test/uia-chromium-smoke.mjs', path.join(root, 'uia-chromium-smoke')]],
  ['sparse-canvas-smoke', process.execPath, ['test/sparse-canvas-smoke.mjs', path.join(root, 'sparse-canvas-smoke')]],
  ['ocr-query-contract', powershell, ['-NoProfile', '-File', 'test/ocr-query-contract.ps1']],
  ['native-input-errors', powershell, ['-NoProfile', '-File', 'test/native-input-errors.ps1']],
  ['input-upgrade-contract', powershell, ['-NoProfile', '-File', 'test/input-upgrade-contract.ps1']]
];
const results = [];
console.log(`Isolated test artifacts: ${root}`);
for (const [name, command, args] of suites) {
  const temp = path.join(root, name);
  await mkdir(temp);
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd: checkout,
    env: { ...process.env, TEMP: temp, TMP: temp, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_INDICATOR: '0', WINDOWS_CU_POWERSHELL: powershell },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024
  });
  await writeFile(path.join(temp, 'stdout.log'), result.stdout || '');
  await writeFile(path.join(temp, 'stderr.log'), (result.stderr || '') + (result.error ? '\n' + result.error.message : ''));
  // Keep stage timings visible in successful CI jobs as well as failures.
  if (['bundle-startup','uia-native-smoke','uia-chromium-smoke'].includes(name) && result.stdout) console.log(result.stdout.trimEnd());
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, exitCode: result.status, durationMs: Date.now() - start });
  await writeFile(path.join(root, 'results.json'), JSON.stringify({ powershell, node: process.version, results }, null, 2) + '\n');
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} (${Date.now() - start} ms)`);
  if (!passed) {
    if (result.stderr) console.error(result.stderr);
    if (result.error) console.error(result.error.message);
    console.error(`Diagnostics retained in ${temp}`);
    process.exitCode = 1;
    break;
  }
}

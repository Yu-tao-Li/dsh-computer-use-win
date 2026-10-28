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
const root = await mkdtemp(path.join(process.env.WCU_TEST_OUTPUT || os.tmpdir(), 'wcu-isolated-tests-'));
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
  ['backend-startup-error', process.execPath, ['test/backend-startup-error.mjs']],
  ['helper-assembly-load', powershell, ['-NoProfile', '-File', 'test/helper-assembly-load.ps1']],
  ['helper-assembly-concurrency', process.execPath, ['test/helper-assembly-concurrency.mjs']],
  ['launch-app', process.execPath, ['test/launch-app.mjs']],
  ['observation-contract', process.execPath, ['test/observation-contract.mjs']],
  ['activation-cancellation', process.execPath, ['test/activation-cancellation.mjs']],
  ['native-window-discovery', process.execPath, ['test/native-window-discovery.mjs']],
  ['native-window-contract', powershell, ['-NoProfile', '-File', 'test/native-window-contract.ps1']],
  ['native-health-contract', powershell, ['-NoProfile', '-File', 'test/native-health-contract.ps1']],
  ['window-capture-contract', powershell, ['-NoProfile', '-File', 'test/window-capture-contract.ps1']],
  ['uia-cache-contract', powershell, ['-NoProfile', '-File', 'test/uia-cache-contract.ps1']],
  ['uia-native-smoke', process.execPath, ['test/uia-native-smoke.mjs', path.join(root, 'uia-native-smoke')]],
  ['quiet-native-mcp', process.execPath, ['test/quiet-native-mcp.mjs']],
  ['uia-chromium-smoke', process.execPath, ['test/uia-chromium-smoke.mjs', path.join(root, 'uia-chromium-smoke')]],
  ['uia-chromium-lazy-smoke', process.execPath, ['test/uia-chromium-lazy-smoke.mjs', path.join(root, 'uia-chromium-lazy-smoke')]],
  ['uia-gecko-smoke', process.execPath, ['test/uia-gecko-smoke.mjs', path.join(root, 'uia-gecko-smoke')]],
  ['sparse-canvas-smoke', process.execPath, ['test/sparse-canvas-smoke.mjs', path.join(root, 'sparse-canvas-smoke')]],
  ['browser-namespace', process.execPath, ['test/browser-namespace.mjs']],
  ['browser-transport', process.execPath, ['test/browser-transport.mjs']],
  ['browser-bidi-offline', process.execPath, ['test/browser-bidi.mjs']],
  ['browser-lane', process.execPath, ['test/browser-lane.mjs']],
  ['browser-visible', process.execPath, ['test/browser-visible.mjs']],
  ['browser-reconnect', process.execPath, ['test/browser-reconnect.mjs']],
  ['browser-signin', process.execPath, ['test/browser-signin.mjs']],
  // 22 real Chrome/Edge restarts: 90-140 s on CI runners, past 180 s on a slow one.
  ['browser-profile-lifecycle', process.execPath, ['test/browser-profile-lifecycle.mjs', path.join(root, 'browser-profile-lifecycle')], 360000],
  ['ocr-query-contract', powershell, ['-NoProfile', '-File', 'test/ocr-query-contract.ps1']],
  ['native-input-errors', powershell, ['-NoProfile', '-File', 'test/native-input-errors.ps1']],
  ['input-upgrade-contract', powershell, ['-NoProfile', '-File', 'test/input-upgrade-contract.ps1']],
  ['less-takeover-contract', powershell, ['-NoProfile', '-File', 'test/less-takeover-contract.ps1']]
];
const results = [];
const selected = process.env.WCU_TEST_SUITES?.split(',').filter(Boolean);
if (selected?.some(name => !suites.some(suite => suite[0] === name))) throw new Error('Unknown WCU_TEST_SUITES selection');
console.log(`Isolated test artifacts: ${root}`);
// CI runners differ a lot in speed, and the live suites drive real browsers
// and UIA providers. On CI a failed suite runs once more in a fresh directory;
// both attempts keep their diagnostics, and only a repeated failure fails the
// run. Local runs never retry.
const attempts = process.env.CI ? 2 : 1;
for (const [name, command, args, timeout = 180000] of suites) {
  if (selected && !selected.includes(name)) continue;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const temp = path.join(root, attempt === 1 ? name : `${name}-retry`);
    await mkdir(temp);
    const start = Date.now();
    const result = spawnSync(command, args.map(arg => arg === path.join(root, name) ? temp : arg), {
      cwd: checkout,
      env: { ...process.env, TEMP: temp, TMP: temp, NODE_ENV: 'test', WCU_BROWSER_HEADLESS: '1', WCU_TEST_NO_TAKEOVER: '1', WCU_INDICATOR: '0', WINDOWS_CU_POWERSHELL: powershell },
      windowsHide: true,
      encoding: 'utf8',
      timeout,
      maxBuffer: 4 * 1024 * 1024
    });
    await writeFile(path.join(temp, 'stdout.log'), result.stdout || '');
    await writeFile(path.join(temp, 'stderr.log'), (result.stderr || '') + (result.error ? '\n' + result.error.message : ''));
    // Keep stage timings visible in successful CI jobs as well as failures.
    if (['bundle-startup','uia-native-smoke','uia-chromium-smoke','uia-chromium-lazy-smoke','uia-gecko-smoke','browser-lane'].includes(name) && result.stdout) console.log(result.stdout.trimEnd());
    const passed = result.status === 0 && !result.error;
    results.push({ name, attempt, passed, exitCode: result.status, durationMs: Date.now() - start });
    await writeFile(path.join(root, 'results.json'), JSON.stringify({ powershell, node: process.version, results }, null, 2) + '\n');
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${attempt > 1 ? ' (retry)' : ''} (${Date.now() - start} ms)`);
    if (passed) {
      if (attempt > 1) console.log(`::warning title=${name} passed on retry::${name} failed once on this runner; the first attempt's diagnostics are in the ${name} folder of the regression artifact`);
      break;
    }
    if (result.stderr) console.error(result.stderr);
    if (result.error) console.error(result.error.message);
    console.error(`Diagnostics retained in ${temp}`);
    // Continue independent suites so one failure does not hide later results.
    if (attempt === attempts) process.exitCode = 1;
  }
}

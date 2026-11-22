// Each suite gets a separate process and TEMP/TMP directory. No physical input.
// Live UIA suites open and close only dedicated fixture windows.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePrivateTemp } from './private-temp.mjs';

if (process.platform !== 'win32') throw new Error('These backend regression tests require Windows.');
const checkout = fileURLToPath(new URL('../', import.meta.url));
const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
const root = await mkdtemp(path.join(process.env.WCU_TEST_OUTPUT || os.tmpdir(), 'wcu-isolated-tests-'));
makePrivateTemp(root);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `artifactRoot=${root}\n`);
const suites = [
  ['background-desktop',process.execPath,['test/background-desktop.mjs']],
  ['work-modes-live',process.execPath,['test/work-modes-live.mjs']],
  ['work-mode-contract',process.execPath,['test/work-mode-contract.mjs']],
  ['input-hold',powershell,['-NoProfile','-File','test/input-hold.ps1']],
  ['input-compose',process.execPath,['test/input-compose.mjs']],
  ['restart-route',process.execPath,['test/restart-route.mjs']],
  ['update-guard',process.execPath,['test/update-guard.mjs']],
  ['observation-budget',process.execPath,['test/observation-budget.mjs']],
  ['input-mutex',process.execPath,['test/input-mutex.mjs']],
  ['shared-stop',process.execPath,['test/shared-stop.mjs']],
  ['native-key-chord',powershell,['-NoProfile','-File','test/native-key-chord.ps1']],
  ['takeover-remote',process.execPath,['test/takeover-remote.mjs']],
  ['activity-unicode',process.execPath,['test/activity-unicode.mjs']],
  ['ocr-memory-live',process.execPath,['test/ocr-memory-live.mjs']],
  ['clipboard-chromium',process.execPath,['test/clipboard-chromium.mjs']],
  ['precompiled-native',process.execPath,['test/precompiled-native.mjs']],
  ['browser-private-transport',process.execPath,['test/browser-private-transport.mjs']],
  ['browser-frames',process.execPath,['test/browser-frames.mjs']],
  ['browser-observation',process.execPath,['test/browser-observation.mjs']],
  ['settings-schema',process.execPath,['test/settings-schema.mjs']],
  ['backend-ready',process.execPath,['test/backend-ready.mjs']],
  ['rpc-protocol',process.execPath,['test/rpc-protocol.mjs']],
  ['catalog-contract',process.execPath,['test/catalog-contract.mjs']],
  ['printwindow-alignment',powershell,['-NoProfile','-File','test/printwindow-alignment.ps1']],
  ['native-host-guard',process.execPath,['test/native-host-guard.mjs']],
  ['input-safety-contract',powershell,['-NoProfile','-File','test/input-safety-contract.ps1']],
  ['native-click-packet',powershell,['-NoProfile','-File','test/native-click-packet.ps1']],
  ['policy',process.execPath,['test/policy.mjs']],
  ['security-regressions',process.execPath,['test/security-regressions.mjs']],
  ['protocol-validation',process.execPath,['test/protocol-validation.mjs']],
  ['cancellation-event-mcp',process.execPath,['test/cancellation-event-mcp.mjs']],
  ['capture-isolation',process.execPath,['test/capture-isolation.mjs']],
  ['peer-compatibility',process.execPath,['test/peer-compatibility.mjs']],
  ['takeover-restart',process.execPath,['test/takeover-restart.mjs']],
  ['host-compatibility',process.execPath,['test/host-compatibility.mjs']],
  ['clipboard-requester',powershell,['-NoProfile','-STA','-File','test/clipboard-requester.ps1']],
  ['clipboard-focus-contract',powershell,['-NoProfile','-File','test/clipboard-focus-contract.ps1']],
  ['presentation-failure',process.execPath,['test/presentation-failure.mjs']],
  ['ui-copy',process.execPath,['test/ui-copy.mjs']],
  ['diagnostics',process.execPath,['test/diagnostics.mjs']],
  ['clipboard-delayed',powershell,['-NoProfile','-STA','-File','test/clipboard-delayed.ps1']],
  ['browser-policy',process.execPath,['test/browser-policy.mjs']],
  ['source-encoding', process.execPath, ['test/source-encoding.mjs']],
  ['tool-context', process.execPath, ['test/tool-context.mjs']],
  ['lazy-tools', process.execPath, ['test/lazy-tools.mjs']],
  ['client-settings-contract', process.execPath, ['test/client-settings-contract.mjs']],
  ['schema-compatibility',process.execPath,['test/schema-compatibility.mjs']],
  ['series-results',process.execPath,['test/series-results.mjs']],
  ['takeover-native', process.execPath, ['test/takeover-native.mjs']],
  ['wsl-interop', process.execPath, ['test/wsl-interop.mjs']],
  ['activity-series',process.execPath,['test/activity-series.mjs']],
  ['overlay-strings',process.execPath,['test/overlay-strings.mjs']],
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
  ['screenshot-output', process.execPath, ['test/screenshot-output.mjs']],
  ['batch-actions', process.execPath, ['test/batch-actions.mjs']],
  ['batch-browser', process.execPath, ['test/batch-browser.mjs']],
  ['browser-attach-user', process.execPath, ['test/browser-attach-user.mjs']],
  ['progress-overlay', process.execPath, ['test/progress-overlay.mjs']],
  ['progress-summary', process.execPath, ['test/progress-summary.mjs']],
  ['progress-reading', process.execPath, ['test/progress-reading.mjs']],
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
  ['ocr-reading', powershell, ['-NoProfile', '-File', 'test/ocr-reading.ps1']],
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

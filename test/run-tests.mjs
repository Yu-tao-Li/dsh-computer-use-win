// Each suite gets a separate process and TEMP/TMP directory. No physical input.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('These backend regression tests require Windows.');
const checkout = fileURLToPath(new URL('../', import.meta.url));
const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-isolated-tests-'));
const suites = [
  ['source-encoding', process.execPath, ['test/source-encoding.mjs']],
  ['selftest', process.execPath, ['mcp/server.mjs', '--self-test']],
  ['mcp-roundtrip', process.execPath, ['test/mcp-test.mjs', 'mcp/server.mjs', 'windows_computer_use_wait', '{"milliseconds":1}']],
  ['profile-resolution', process.execPath, ['test/profile-resolution.mjs']],
  ['backend-lifecycle', process.execPath, ['test/backend-lifecycle.mjs']],
  ['activation-cancellation', process.execPath, ['test/activation-cancellation.mjs']],
  ['native-window-discovery', process.execPath, ['test/native-window-discovery.mjs']],
  ['native-window-contract', powershell, ['-NoProfile', '-File', 'test/native-window-contract.ps1']],
  ['native-input-errors', powershell, ['-NoProfile', '-File', 'test/native-input-errors.ps1']]
];
const results = [];
console.log(`Isolated test artifacts: ${root}`);
for (const [name, command, args] of suites) {
  const temp = path.join(root, name);
  await mkdir(temp);
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd: checkout,
    env: { ...process.env, TEMP: temp, TMP: temp, WCU_INDICATOR: '0', WINDOWS_CU_POWERSHELL: powershell },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024
  });
  await writeFile(path.join(temp, 'stdout.log'), result.stdout || '');
  await writeFile(path.join(temp, 'stderr.log'), (result.stderr || '') + (result.error ? '\n' + result.error.message : ''));
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

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildClient } from './build-client.mjs';

const client = await buildClient({ check: true });
const shell = path.win32.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const native = spawnSync(shell, ['-NoProfile', '-File', path.join(import.meta.dirname, 'build-native.ps1'), '-Check'], { windowsHide: true, encoding: 'utf8' });
if (native.error || native.status !== 0) throw new Error(native.error?.message || native.stderr);

let packAudit;
if (process.argv.includes('--pack')) {
  const cmd = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const cmdArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts']
    : ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const pack = spawnSync(cmd, cmdArgs, {
    cwd: path.resolve(import.meta.dirname, '..'),
    windowsHide: true,
    encoding: 'utf8'
  });
  if (pack.error || pack.status !== 0) throw new Error(pack.error?.message || pack.stderr || 'npm pack --dry-run failed');
  const parsed = JSON.parse(pack.stdout);
  const files = (Array.isArray(parsed) ? parsed[0]?.files : parsed?.files) ?? [];
  const names = files.map(entry => entry.path);
  const forbidden = names.filter(name => /fable5p2|FILE_LOG|FILE_ORGANIZE|^test\/|^docs\/|\.log$/i.test(name));
  if (forbidden.length) throw new Error(`Forbidden files in npm package: ${forbidden.join(', ')}`);
  const root = path.resolve(import.meta.dirname, '..');
  for (const rel of ['README.md', 'README.en.md', 'CHANGELOG.md', 'PUBLISH.md', 'docs/computer-use-settings.md', 'mcp/client.js', 'package.json']) {
    const content = await readFile(path.join(root, rel), 'utf8');
    // The internal plan file name stays private; the changelog names the
    // models that worked on a release on purpose.
    if (/fable5p2/i.test(content)) throw new Error(`Internal codename leaked in ${rel}`);
    if (/[CD]:\\Users\\(?!XXX)|[CD]:\\Downloads\\|Documents\\Codex|\.gemini\\antigravity/i.test(content)) throw new Error(`Local path leaked in ${rel}`);
  }
  packAudit = { checked: true, fileCount: names.length, totalBytes: (Array.isArray(parsed) ? parsed[0]?.size : parsed?.size) ?? 0 };
}

console.log(JSON.stringify({ client, native: JSON.parse(native.stdout), ...(packAudit ? { packAudit } : {}) }));

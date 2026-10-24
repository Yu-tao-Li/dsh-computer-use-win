// Windows refuses to replace a file another process holds open without delete
// sharing. atomicJson must wait out a brief hold instead of failing with EPERM.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicJson } from '../mcp/takeover.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-atomic-json-'));
const file = path.join(root, 'activity.json');
atomicJson(file, { version: 1 });
// Read sharing only, like a reader that omits FILE_SHARE_DELETE.
const hold = `$f=[IO.File]::Open('${file.replace(/'/g, "''")}','Open','Read','Read');[Console]::Out.WriteLine('held');[Console]::Out.Flush();Start-Sleep -Milliseconds 300;$f.Dispose()`;
const holder = spawn(process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe', ['-NoProfile', '-Command', hold], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
const exited = new Promise(resolve => holder.on('exit', resolve));
await new Promise((resolve, reject) => {
  holder.stdout.on('data', data => { if (String(data).includes('held')) resolve(); });
  holder.on('exit', code => reject(new Error('The holder exited before holding the file: ' + code)));
});
const started = Date.now();
atomicJson(file, { version: 2 });
const waitedMs = Date.now() - started;
assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 2 }, 'The replace must land once the hold is released');
assert.ok(waitedMs >= 100, `The replace should have waited for the hold, waited ${waitedMs} ms`);
assert.equal(await exited, 0);
console.log(JSON.stringify({ passed: true, waitedMs }));

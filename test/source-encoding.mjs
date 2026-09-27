import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/windows-uia.ps1', import.meta.url));
// Windows PowerShell 5.1 treats a BOM-less script as the system ANSI codepage.
// UTF-8 punctuation can then decode into quote characters and break parsing.
assert.deepEqual([...source.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'The backend must retain its UTF-8 BOM for Windows PowerShell 5.1.');
new TextDecoder('utf-8', { fatal: true }).decode(source);
console.log('PASS UTF-8 source and Windows PowerShell 5.1 BOM contract');

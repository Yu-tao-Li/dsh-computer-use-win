// #64: inspect the complete MCP result, since a text-only preview can hide
// multi-megabyte image blocks that a host later serializes into model context.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpTestClient } from './mcp-test-client.mjs';
import { bridgeConfig } from '../mcp/dsh-plugin.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-screenshot-output-'));
await cp(new URL('../mcp', import.meta.url), path.join(root, 'mcp'), { recursive: true,
  filter: source => !/^FILE_(LOG|INDEX|HISTORY)\./.test(path.basename(String(source))) && !String(source).endsWith('.file-log.lock') });
await mkdir(path.join(root, 'scripts'));
const serverPath = path.join(root, 'mcp/server.mjs');
const server = await readFile(serverPath, 'utf8');
await writeFile(serverPath, server.replace('function runBackend(action, args = {}, timeoutMs = 30000, request) {',
  'function runBackend(action, args = {}, timeoutMs = 30000, request) { timeoutMs = Math.min(timeoutMs, 1400);'));
// A PNG with trailing bytes makes a large, deterministic transport fixture.
const png = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64'), Buffer.alloc(2 * 1024 * 1024, 0x5a)]);
const image = path.join(root, 'fixture.png');
await writeFile(image, png);
await writeFile(path.join(root, 'scripts/windows-uia.ps1'), `param([switch]$Persistent)
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
while($null -ne ($line=[Console]::In.ReadLine())) {
  $r=$line | ConvertFrom-Json
  $result=@{id=$r.id;ok=$true;action=$r.action;nodeCount=30;tree=@{name='Fixture'}}
  if($r.args.query -eq 'failed'){$result.ok=$false}
  if($r.action -eq 'find' -and $r.args.query -eq 'timeout'){Start-Sleep -Seconds 8}
  if($r.action -eq 'screenshot' -or $r.args.includeScreenshot -or $r.args.query -eq 'failed'){
    $bytes=[IO.File]::ReadAllBytes($env:WCU_IMAGE_FIXTURE)
    $result.screenshot=@{path=$env:WCU_IMAGE_FIXTURE;base64=[Convert]::ToBase64String($bytes);mimeType='image/png';bytes=$bytes.Length;bounds=@{x=100;y=200;width=800;height=600};imageScale=0.5}
  }
  [Console]::WriteLine(($result | ConvertTo-Json -Depth 20 -Compress))
}
`, 'utf8');
// Deterministic browser-lane output; transport serialization is shared by CDP
// and BiDi. Neither a real browser nor physical input is needed for this suite.
await writeFile(path.join(root, 'mcp/browser.mjs'), `
import {readFileSync} from 'node:fs';
export const BACKGROUND_FIRST=new Set();
export const isBrowserCall=args=>Boolean(args?.browserTab);
export const isQuietCall=()=>true;
export class BrowserLane {
  async run(action,args){return {meta:{ok:args.browserTab!=='failed',action,channel:'browser'},text:'[fixture:1] heading "Fixture"',
    ...(args.includeScreenshot===false?{}:{screenshot:{base64:readFileSync(process.env.WCU_IMAGE_FIXTURE).toString('base64'),mimeType:'image/png',width:1,height:1}})};}
  close(){} async shutdown(){} async health(){return {}} async annotateWindows(result){return result}
}
`);

const reports = [];
for (const mode of ['file', 'inline', 'default']) {
  const env = { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_INDICATOR: '0', WCU_IMAGE_FIXTURE: image };
  if (mode === 'default') delete env.WCU_IMAGE_MODE;
  else env.WCU_IMAGE_MODE = mode;
  const client = new McpTestClient(process.execPath, [path.join(root, 'mcp/server.mjs')], { env });
  const call = (name, args = {}) => client.call('windows_computer_use_' + name, args);
  const data = result => JSON.parse(result.content[0].text);
  async function check(name, args = {}) {
    const result = await call(name, args);
    const shot = data(result).screenshot;
    assert.ok(shot, name + ' screenshot metadata missing');
    const wire = JSON.stringify(result);
    if (mode === 'file') {
      assert.ok(result.content.every(block => block.type === 'text'), 'File mode must never leak an image block');
      assert.equal(shot.base64, undefined);
      assert.ok(wire.length < 3000, 'File mode must stay compact for a large screenshot');
      assert.ok(path.isAbsolute(shot.path));
      assert.deepEqual(await readFile(shot.path), png, 'The referenced image must retain the exact bytes');
      assert.equal(shot.delivery, 'file');
      assert.match(shot.readHint, /image-viewing tool/);
      if (!args.browserTab) { assert.equal(shot.imageScale, 0.5); assert.equal(shot.bounds.x, 100); }
    } else {
      const block = result.content.find(block => block.type === 'image');
      assert.deepEqual(Buffer.from(block.data, 'base64'), png, 'Standalone clients retain inline MCP images');
      assert.ok(data(result).screenshot.base64.includes('omitted'));
    }
    reports.push({ mode, name, browser: !!args.browserTab, bytes: Buffer.byteLength(wire), error: result.isError === true });
    return result;
  }
  try {
    await client.init();
    for (let i = 0; i < 3; i++) await check('screenshot');
    await check('snapshot');
    await check('ocr', { includeScreenshot: true });
    assert.equal((await check('find', { query: 'timeout', ocrFallback: false, treeTimeoutMs: 100 })).isError, true);
    const failed = await call('find', { query: 'failed', ocrFallback: false });
    assert.equal(failed.isError, true);
    assert.ok(JSON.stringify(failed).length < 3000);
    await check('screenshot', { browserTab: 'fixture' });
    await check('snapshot', { browserTab: 'fixture' });
    assert.equal((await check('snapshot', { browserTab: 'failed' })).isError, true);
    for (const args of [{ includeScreenshot: false }, { includeScreenshot: false, browserTab: 'fixture' }]) {
      const result = await call('snapshot', args);
      assert.equal(data(result).screenshot, undefined);
      assert.ok(result.content.every(block => block.type === 'text'));
    }
    if (mode === 'file') {
      const saved = data(await check('screenshot', { browserTab: 'fixture' })).screenshot.path;
      const old = new Date(Date.now() - 31 * 60 * 1000);
      await utimes(saved, old, old);
      const unrelated = path.join(path.dirname(saved), 'keep.png');
      await writeFile(unrelated, png);
      await utimes(unrelated, old, old);
      await check('screenshot', { browserTab: 'fixture' });
      assert.equal(await stat(saved).then(() => true, () => false), false, 'Expired plugin screenshots are removed');
      assert.ok((await stat(unrelated)).isFile(), 'Unrelated files must remain untouched');
    }
  } finally {
    client.child.stdin.end();
    const timer = setTimeout(() => client.child.kill(), 5000);
    if (client.child.exitCode === null) await new Promise(resolve => client.child.once('exit', resolve));
    clearTimeout(timer);
  }
}
assert.equal(bridgeConfig({}).env.WCU_IMAGE_MODE, 'file', 'Every DSH adapter must opt out of inline image payloads');
await writeFile(path.join(root, 'results.json'), JSON.stringify(reports, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, reports, artifactRoot: root }, null, 2));

// Public MCP batch contract against a deterministic desktop worker. No input.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { McpTestClient } from './mcp-test-client.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-batch-contract-'));
await cp(new URL('../mcp', import.meta.url), path.join(root, 'mcp'), { recursive: true, filter: source => !/^FILE_(LOG|INDEX|HISTORY)\./.test(path.basename(String(source))) && !String(source).endsWith('.file-log.lock') });
await mkdir(path.join(root, 'scripts'));
await writeFile(path.join(root, 'scripts/windows-uia.ps1'), `param([switch]$Persistent)
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
$title='Fixture';$extra=@();$dialog=$false;$closed=$false
$targetClass=if($env:WCU_FIXTURE_CLASS){$env:WCU_FIXTURE_CLASS}else{'Fixture'}
while($null -ne ($line=[Console]::In.ReadLine())){
 $r=$line|ConvertFrom-Json
 $result=@{id=$r.id;ok=$true;action=$r.action}
 if($r.action -eq 'list_windows'){$result.windows=@($(if(-not $closed){@{nativeWindowHandle=101;processId=77;name=$title;className=$targetClass}}))+$extra}
 elseif($r.action -eq 'tree'){$result.nodeCount=30;$result.tree=@{name=$title}}
 else {
  [IO.File]::AppendAllText($env:WCU_BATCH_MARKER,$r.action+':'+$r.args.value+[Environment]::NewLine)
  if($r.action -eq 'set_value'){
   if($r.args.value -eq 'navigation'){$title='Navigated'}
   if($r.args.value -eq 'unsaved'){$title='*Fixture'}
   if($r.args.value -eq 'close'){$closed=$true}
   if($r.args.value -eq 'newWindow'){$extra=@(@{nativeWindowHandle=202;processId=77;name='New';className='Fixture'})}
   if($r.args.value -eq 'dialog'){$extra=@(@{nativeWindowHandle=202;processId=77;name='Dialog';className='#32770'})}
   if($r.args.value -eq 'error'){$result.ok=$false;$result.error='fixture error'}
   if($r.args.value -eq 'unconfirmed'){$result.activated=$false}
  }
  if($r.action -eq 'wait'){[IO.File]::AppendAllText($env:WCU_BATCH_MARKER,'waiting'+[Environment]::NewLine);Start-Sleep -Milliseconds $r.args.milliseconds}
 }
 [Console]::WriteLine(($result|ConvertTo-Json -Depth 20 -Compress))
}
`);
const reports = [];
const step = value => ({ action: 'set_value', arguments: { elementId: 'fixture', value } });
const data = result => JSON.parse(result.content[0].text);
async function clientCase(label, test, extra = {}) {
  const marker = path.join(root, label + '.txt');
  const client = new McpTestClient(process.execPath, [path.join(root, 'mcp/server.mjs')], { env: { ...process.env, ...extra, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_BATCH_MARKER: marker, WCU_STATE_FILE:path.join(root,label+'.state.json') } });
  try { await client.init(); await test(client, marker); reports.push(label); }
  finally { client.child.stdin.end(); const timer = setTimeout(() => client.child.kill(), 5000); if (client.child.exitCode === null) await new Promise(resolve => client.child.once('exit', resolve)); clearTimeout(timer); }
}
const batch = (client, steps, extra = {}) => client.call('windows_computer_use_batch', { nativeWindowHandle: 101, steps, ...extra });
await clientCase('complete', async (client, marker) => {
  const result = await batch(client, [step('one'), step('two'), step('three')]);
  assert.equal(result.isError, undefined); assert.equal(data(result).completed, 3);
  assert.equal(result.content.filter(block => block.text === 'Final observation:').length, 1);
  assert.equal((await readFile(marker, 'utf8')).trim().split('\n').length, 3);
});
const reason = scenario => scenario === 'close' ? 'targetClosed' : scenario;
for (const scenario of ['navigation','newWindow','dialog','close','error','unconfirmed']) await clientCase(scenario, async (client, marker) => {
  const result = await batch(client, [step('one'), step(scenario), step('MUST_NOT_RUN')]);
  assert.equal(result.isError, true); assert.equal(data(result).stopReason, reason(scenario));
  assert.ok(!(await readFile(marker, 'utf8')).includes('MUST_NOT_RUN'));
  assert.equal(data(result).steps.length, 2);
  assert.equal(data(result).afterLastStep, undefined);
});
// #69: a change caused by the last action (a submit that navigates, a confirm
// dialog, a new or closed window) completes the plan; it is reported, not an error.
for (const scenario of ['navigation','newWindow','dialog','close']) await clientCase('last-' + scenario, async (client, marker) => {
  const result = await batch(client, [step('one'), step(scenario)]);
  assert.equal(result.isError, undefined, JSON.stringify(data(result)));
  assert.equal(data(result).ok, true); assert.equal(data(result).completed, 2);
  assert.equal(data(result).stopReason, 'completed'); assert.equal(data(result).afterLastStep, reason(scenario));
  assert.equal(result.content.filter(block => block.text === 'Final observation:').length, scenario === 'close' ? 0 : 1);
  if (scenario === 'close') assert.ok(result.content.some(block => /Final observation skipped: the target closed/.test(block.text ?? '')));
});
for (const scenario of ['error','unconfirmed']) await clientCase('last-' + scenario, async (client, marker) => {
  const result = await batch(client, [step('one'), step(scenario)]);
  assert.equal(result.isError, true); assert.equal(data(result).stopReason, scenario); assert.equal(data(result).afterLastStep, undefined);
});
await clientCase('unsaved-mark', async (client, marker) => {
  const result = await batch(client, [step('unsaved'), step('two')]);
  assert.equal(result.isError, undefined, 'An unsaved-changes mark in the title is not navigation');
  assert.equal(data(result).completed, 2); assert.equal(data(result).afterLastStep, undefined);
});
await clientCase('target-dialog', async (client, marker) => {
  const result = await batch(client, [step('one'), step('two')]);
  assert.equal(result.isError, undefined, 'A dialog that is the target itself does not block the plan');
  assert.equal(data(result).completed, 2);
  const blocked = await batch(client, [step('dialog'), step('MUST_NOT_RUN')]);
  assert.equal(blocked.isError, true); assert.equal(data(blocked).stopReason, 'dialog', 'Another dialog of the process still stops the plan');
  assert.ok(!(await readFile(marker, 'utf8')).includes('MUST_NOT_RUN'));
}, { WCU_FIXTURE_CLASS: '#32770' });
await clientCase('validate-first', async (client, marker) => {
  for (const plan of [[step('one'), { action: 'click', arguments: { x: 1.5, y: 2 } }], Array(21).fill(step('one')), [step('one'), { action: 'launch_app', arguments: { target: 'x' } }], [step('one'), { action: 'set_value', arguments: { elementId: 'x', value: 'two', nativeWindowHandle: 202 } }]]) {
    assert.equal((await batch(client, plan)).isError, true);
  }
  for(const late of [{action:'click',arguments:{x:10}},{action:'keypress',arguments:{keys:['ctrl']}}])assert.equal((await batch(client,[step('one'),late])).isError,true);
  assert.equal(await readFile(marker).then(() => true, () => false), false, 'Invalid plans cannot start actions');
});
await clientCase('disabled-action', async (client, marker) => {
  const result = await batch(client, [step('one'), { action: 'type_text', arguments: { text: 'disabled' } }]);
  assert.equal(result.isError, true); assert.match(result.content[0].text, /TOOL_DISABLED/);
  assert.equal(await readFile(marker).then(() => true, () => false), false);
}, { WCU_ENABLED_TOOLS: JSON.stringify(['batch','set_value','accessibility_tree']) });
await clientCase('cancel-partial-and-concurrency', async (client, marker) => {
  const id = client.next;
  const pending = batch(client, [step('one'), { action: 'wait', arguments: { milliseconds: 5000 } }, step('MUST_NOT_RUN')]);
  const deadline = Date.now() + 5000;
  while (!(await readFile(marker, 'utf8').catch(() => '')).includes('waiting')) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.ok(JSON.parse(await readFile(path.join(root,'cancel-partial-and-concurrency.state.json'),'utf8')).active>=2,'A batch holds an outer lease, including gaps between actions, so settings cannot reconnect midway');
  const other = await client.call('windows_computer_use_wait', { milliseconds: 1 });
  assert.equal(other.isError, true); assert.match(other.content[0].text, /COMPUTER_USE_BUSY/);
  client.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } }) + '\n');
  const result = await pending;
  assert.equal(result.isError, true); assert.equal(data(result).stopReason, 'cancelled');
  assert.equal(data(result).completed, 1); assert.ok(!(await readFile(marker, 'utf8')).includes('MUST_NOT_RUN'));
  assert.equal(JSON.parse(await readFile(path.join(root,'cancel-partial-and-concurrency.state.json'),'utf8')).active,0);
  assert.equal((await client.call('windows_computer_use_wait', { milliseconds: 1 })).isError, undefined, 'The batch must release its lease after cancellation');
});
console.log(JSON.stringify({ passed: true, cases: reports, root }));

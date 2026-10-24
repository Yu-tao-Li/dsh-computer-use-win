// Public MCP calls with a deterministic worker: no UIA or physical input.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpTestClient} from './mcp-test-client.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-observation-contract-'));
await mkdir(path.join(root,'mcp'));await mkdir(path.join(root,'scripts'));
let server=await readFile(new URL('../mcp/server.mjs',import.meta.url),'utf8');
server=server.replace('function runBackend(action, args = {}, timeoutMs = 30000, request) {','function runBackend(action, args = {}, timeoutMs = 30000, request) { timeoutMs = Math.min(timeoutMs, 1400);');
await writeFile(path.join(root,'mcp/server.mjs'),server);
for(const file of ['settings.mjs','takeover.mjs','browser.mjs'])await writeFile(path.join(root,'mcp',file),await readFile(new URL('../mcp/'+file,import.meta.url)));
const marker=path.join(root,'started.txt').replaceAll("'","''");
await writeFile(path.join(root,'scripts/windows-uia.ps1'),`param([switch]$Persistent)
[IO.File]::AppendAllText('${marker}', 'worker' + [Environment]::NewLine)
while($null -ne ($line=[Console]::In.ReadLine())) {
  $r=$line | ConvertFrom-Json
  $result=@{id=$r.id;ok=$true;action=$r.action;args=$r.args}
  if($r.action -eq 'wait'){Start-Sleep -Milliseconds $r.args.milliseconds}
  if($r.action -eq 'tree' -or $r.action -eq 'snapshot'){$result.nodeCount=6;$result.tree=@{name='Fixture'}}
  if($r.action -eq 'find') {
    if($r.args.query -eq 'stall'){Start-Sleep -Seconds 10}
    $result.scannedNodes=6;$result.results=@();$result.targetResponsive=$true;$result.truncated=$false
  }
  if($r.action -eq 'ocr') {
    $result.text='visible placeholder';$result.lines=@(@{text='visible placeholder';boundingBox=@{x=100;y=200;width=80;height=20}})
    $result.matched=@(if($r.args.query -eq 'visible'){@{word=@{text='visible';x=140;y=210};boundingBox=@{x=100;y=200;width=80;height=20}}})
  }
  if($r.action -eq 'screenshot'){$result.screenshot=@{base64='aW1hZ2U=';mimeType='image/png';bounds=@{x=0;y=0;width=800;height=600};imageScale=1}}
  [Console]::WriteLine(($result | ConvertTo-Json -Depth 20 -Compress))
}
`);
const client=new McpTestClient(process.execPath,[path.join(root,'mcp/server.mjs')],{env:{...process.env,WINDOWS_CU_POWERSHELL:process.env.WINDOWS_CU_POWERSHELL||'powershell.exe'}});
const call=(name,args={})=>client.call('windows_computer_use_'+name,args);
const data=r=>JSON.parse(r.content.find(c=>c.type==='text').text);
try{
  await client.init();
  for(const [name,args] of [['find',{}],['find',{query:'x',maxDepth:24}],['snapshot',{activate:'true'}],['click',{x:1.5,y:2}],['wait',{milliseconds:'1'}],['drag',{path:[{x:1,y:2},{x:2,y:'3'}]}],['keypress',{keys:['a','b']}],['wait_for',{condition:'text'}],['health',{extra:true}],['health',[]],['health',null]]){
    const r=await call(name,args);assert.equal(r.isError,true);assert.match(r.content[0].text,/INVALID_ARGUMENTS/);
  }
  assert.equal(await access(path.join(root,'started.txt')).then(()=>true,()=>false),false,'Invalid arguments must not launch a worker');
  assert.equal((await call('wait',{milliseconds:1})).isError,undefined);
  const queued=await Promise.all([call('wait',{milliseconds:700}),call('wait',{milliseconds:700}),call('wait',{milliseconds:700})]);
  assert.ok(queued.every(r=>!r.isError),'Unsent queued calls must not time out or kill the current action');
  assert.equal((await readFile(path.join(root,'started.txt'),'utf8')).trim().split('\n').length,1);
  const hit=data(await call('find',{query:'visible'}));
  assert.equal(hit.source,'uia+ocr');assert.equal(hit.results[0].source,'ocr');assert.equal(hit.results[0].x,140);assert.equal(hit.results[0].id,undefined);assert.equal(hit.ocr.args.resolveControl,false);
  const miss=data(await call('find',{query:'search'}));assert.equal(miss.results.length,0);assert.equal(miss.ocr.lines[0].text,'visible placeholder');
  assert.equal(data(await call('find',{query:'visible',ocrFallback:false})).ocr,undefined);
  assert.equal(data(await call('find',{query:'visible',controlType:'Edit'})).ocr,undefined);
  const snapshot=await call('snapshot',{includeScreenshot:false});assert.ok(!snapshot.content[0].text.includes('\n'));assert.match(data(snapshot).hint,/sparse/);
  const timed=await call('find',{query:'stall',treeTimeoutMs:100});assert.equal(timed.isError,true);assert.equal(data(timed).truncationReason,'backendTimeout');assert.equal(timed.content[1].type,'image');
  assert.equal((await call('wait',{milliseconds:1})).isError,undefined);
  const sent=data(await call('click',{x:1,y:2}));assert.equal(sent.verification,'sent');
  console.log('PASS schema/default validation before worker launch, queued deadlines, OCR hit/miss provenance, explicit opt-out, compact JSON, timed-out UIA screenshot and worker recovery');
}finally{
  client.child.stdin.end();const timer=setTimeout(()=>client.child.kill(),5000);
  if(client.child.exitCode===null)await new Promise(resolve=>client.child.once('exit',resolve));clearTimeout(timer);
  await writeFile(path.join(root,'results.json'),JSON.stringify({transcript:client.transcript,stderr:client.stderr},null,2));
}

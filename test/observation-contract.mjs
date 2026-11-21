// Public MCP calls with a deterministic worker: no UIA or physical input.
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpTestClient} from './mcp-test-client.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-observation-contract-'));
await mkdir(path.join(root,'mcp'));await mkdir(path.join(root,'scripts'));
await cp(new URL('../mcp',import.meta.url),path.join(root,'mcp'),{recursive:true});
let server=await readFile(new URL('../mcp/server.mjs',import.meta.url),'utf8');
server=server.replace('function runBackend(action, args = {}, timeoutMs = 30000, request) {','function runBackend(action, args = {}, timeoutMs = 30000, request) { timeoutMs = Math.min(timeoutMs, 1400);');
await writeFile(path.join(root,'mcp/server.mjs'),server);
const marker=path.join(root,'started.txt').replaceAll("'","''");
await writeFile(path.join(root,'scripts/windows-uia.ps1'),`param([switch]$Persistent)
[IO.File]::AppendAllText('${marker}', 'worker' + [Environment]::NewLine)
[Console]::WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress));while($null -ne ($line=[Console]::In.ReadLine())) {
  $r=$line | ConvertFrom-Json
  $result=@{id=$r.id;ok=$true;action=$r.action;args=$r.args}
  if($r.action -eq 'wait'){Start-Sleep -Milliseconds $r.args.milliseconds}
  if($r.action -eq 'list_windows'){$result.windows=@(@{nativeWindowHandle=42;processId=4;name='Existing Edge fixture'})}
  if($r.action -eq 'keypress'){$result.deliveredTo=@{title='Fixture';via=$(if($r.args.keys[0] -eq 'f2'){'front window'}else{'window target'})}}
  if($r.action -eq 'type_text'){
    $result.deliveredTo=@{title='Fixture';via='window target'}
    $result.verified=($r.args.text -eq 'observed' -or $r.args.text -eq 'changed')
    $result.verification=if($result.verified){'observed'}else{'unconfirmed'}
    if($r.args.text -eq 'changed'){$result.note='The field holds the typed text, and the application changed it'}
    elseif(-not $result.verified){$result.note='Could not verify the edited field'}
  }
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
const client=new McpTestClient(process.execPath,[path.join(root,'mcp/server.mjs')],{env:{
  ...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WINDOWS_CU_POWERSHELL:process.env.WINDOWS_CU_POWERSHELL||'powershell.exe',
  WCU_BROWSER_APP:'edge',WCU_BROWSER_EXE:process.execPath,WCU_BROWSER_PROFILE:path.join(root,'agent-browser'),
  WCU_BROWSER_LANE:'on',WCU_BROWSER_SIGNIN:'0',WCU_BROWSER_ATTACH_USER:'0',WCU_BROWSER_CDP_URL:'',WCU_BROWSER_BIDI_URL:'',
}});
const call=(name,args={})=>client.call('windows_computer_use_'+name,args);
const data=r=>JSON.parse(r.content.find(c=>c.type==='text').text);
try{
  await client.init();
  for(const [name,args] of [['find',{}],['find',{query:'x',maxDepth:24}],['snapshot',{activate:'true'}],['click',{x:1.5,y:2}],['wait',{milliseconds:'1'}],['drag',{path:[{x:1,y:2},{x:2,y:'3'}]}],['keypress',{keys:['a','b']}],['wait_for',{condition:'text'}],['health',{extra:true}],['health',[]],['health',null]]){
    const r=await call(name,args);assert.equal(r.isError,true);assert.match(r.content[0].text,/INVALID_ARGUMENTS/);
  }
  assert.equal(await access(path.join(root,'started.txt')).then(()=>true,()=>false),false,'Invalid arguments must not launch a worker');
  const initial=data(await call('list_windows'));
  assert.equal(initial.browserLane.agent.state,'notStarted');
  assert.deepEqual(initial.browserLane.browsers,[]);
  const nativeWindowHandle=initial.windows[0].nativeWindowHandle;
  for(const [action,args,hint] of [
    ['set_value',{elementId:'new-tab',value:'https://example.test',nativeWindowHandle},/Omit browserTab, windowTitle, processId and nativeWindowHandle/],
    ['set_value',{elementId:'<browser>:new-tab',value:'https://example.test'},/actual connected browser id/],
    ['snapshot',{browserTab:'desktop'},/requires a Windows target/],
    ['snapshot',{browserTab:'t1',nativeWindowHandle},/mixed browser and Windows targets/],
    ['click',{browserTab:'desktop',nativeWindowHandle,elementId:'t1:7'},/fresh desktop snapshot/],
  ]){
    const bad=await call(action,args);
    assert.equal(bad.isError,true);
    assert.match(bad.content[0].text,hint);
  }
  assert.equal(data(await call('list_windows')).browserLane.agent.state,'notStarted');
  const failed=await call('set_value',{elementId:'new-tab',value:'https://example.test'});
  assert.equal(failed.isError,true);
  assert.match(failed.content[0].text,/BROWSER_LANE_UNAVAILABLE: .+exited during startup \(code \d+\)/);
  const status=data(await call('health')).browserLane.agent;
  assert.equal(status.state,'failed');
  assert.equal(status.error.stage,'devtools');
  assert.ok(Number.isInteger(status.error.exitCode));
  const afterFailure=data(await call('list_windows'));
  assert.equal(afterFailure.browserLane.agent.state,'failed');
  assert.equal(afterFailure.windows[0].nativeWindowHandle,nativeWindowHandle);
  const desktop={browserTab:'desktop',nativeWindowHandle};
  const fallback=data(await call('snapshot',{...desktop,includeScreenshot:false}));
  assert.equal(fallback.source,'uia');
  assert.equal(fallback.args.nativeWindowHandle,nativeWindowHandle);
  assert.equal(fallback.args.browserTab,undefined);
  for(const [name,extra] of [['accessibility_tree',{}],['find',{query:'edge',ocrFallback:false}],['wait_for',{condition:'window'}],['activate_window',{}]]){
    const result=data(await call(name,{...desktop,...extra}));
    assert.equal(result.args.browserTab,undefined);
    assert.equal(result.args.nativeWindowHandle,nativeWindowHandle);
  }
  const desktopChord=data(await call('keypress',{...desktop,keys:['alt','h'],thenKeys:[['o']],dispatch:'foreground'}));
  assert.deepEqual(desktopChord.args.thenKeys,[['o']]);
  assert.equal(desktopChord.args.nativeWindowHandle,nativeWindowHandle);
  assert.equal((await call('wait',{milliseconds:1})).isError,undefined);
  const queued=await Promise.all([call('wait',{milliseconds:700}),call('wait',{milliseconds:700}),call('wait',{milliseconds:700})]);
  assert.ok(queued.every(r=>!r.isError),'Unsent queued calls must not time out or kill the current action');
  assert.equal((await readFile(path.join(root,'started.txt'),'utf8')).trim().split('\n').length,1);
  const hit=data(await call('find',{query:'visible'}));
  assert.equal(hit.source,'uia+ocr');assert.equal(hit.results[0].source,'ocr');assert.equal(hit.results[0].x,140);assert.equal(hit.results[0].id,undefined);assert.equal(hit.ocr.args.resolveControl,false);
  assert.match(hit.hint,/OCR fallback found visible text/);
  const miss=data(await call('find',{query:'search'}));assert.equal(miss.results.length,0);assert.equal(miss.ocr.lines[0].text,'visible placeholder');assert.match(miss.hint,/no literal match/);
  const optedOut=data(await call('find',{query:'visible',ocrFallback:false}));assert.equal(optedOut.ocr,undefined);assert.equal(optedOut.ocrSkipped,undefined);
  const typedSearch=data(await call('find',{query:'visible',controlType:'Edit'}));
  assert.equal(typedSearch.ocr,undefined);assert.equal(typedSearch.ocrSkipped,'controlType');assert.match(typedSearch.hint,/skipped because controlType/);
  const snapshot=await call('snapshot',{includeScreenshot:false});assert.ok(!snapshot.content[0].text.includes('\n'));assert.match(data(snapshot).hint,/sparse/);
  const timed=await call('find',{query:'stall',treeTimeoutMs:100});assert.equal(timed.isError,true);assert.equal(data(timed).truncationReason,'backendTimeout');assert.equal(timed.content[1].type,'image');
  assert.equal((await call('wait',{milliseconds:1})).isError,undefined);
  const sent=data(await call('click',{x:1,y:2}));assert.equal(sent.verification,'sent');
  // Issue #82: keys that went to whatever window was in front are not "sent".
  const guessed=data(await call('keypress',{keys:['f2']}));assert.equal(guessed.verification,'unconfirmed');assert.match(guessed.verificationNote,/window in front/);assert.equal(guessed.deliveredTo.via,'front window');
  const aimed=data(await call('keypress',{keys:['f3'],nativeWindowHandle:42}));assert.equal(aimed.verification,'sent');assert.equal(aimed.deliveredTo.via,'window target');
  const verified=data(await call('type_text',{text:'observed',method:'sendinput',nativeWindowHandle:42}));assert.equal(verified.verification,'observed');assert.match(verified.verificationNote,/contained the expected text/);
  const unverified=data(await call('type_text',{text:'other',method:'sendinput',nativeWindowHandle:42}));assert.equal(unverified.verification,'unconfirmed');assert.match(unverified.verificationNote,/Could not verify/);
  const changed=data(await call('type_text',{text:'changed',method:'sendinput',nativeWindowHandle:42}));assert.equal(changed.verification,'observed');assert.match(changed.verificationNote,/application changed it/);
  console.log('PASS schema/default validation before worker launch, queued deadlines, OCR hit/miss provenance, explicit opt-out, compact JSON, timed-out UIA screenshot, worker recovery and key delivery verification');
}finally{
  client.child.stdin.end();const timer=setTimeout(()=>client.child.kill(),5000);
  if(client.child.exitCode===null)await new Promise(resolve=>client.child.once('exit',resolve));clearTimeout(timer);
  await writeFile(path.join(root,'results.json'),JSON.stringify({transcript:client.transcript,stderr:client.stderr},null,2));
}

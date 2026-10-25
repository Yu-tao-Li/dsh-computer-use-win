import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';
const artifacts=path.resolve(process.argv[2]);await mkdir(artifacts,{recursive:true});
// A rerun into the same folder must not find the last run's quit command.
await rm(path.join(artifacts,'native-command.json'),{force:true});
const fixture=spawn('powershell.exe',['-NoProfile','-Sta','-File',path.join(import.meta.dirname,'uia-native-fixture.ps1'),artifacts],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let state={},buffer='',stderr='';
fixture.stderr.on('data',b=>stderr+=b);
fixture.stdout.on('data',b=>{buffer+=b;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{Object.assign(state,JSON.parse(line));}catch{}}});
const client=new McpTestClient(process.execPath,[path.join(import.meta.dirname,'../mcp/server.mjs')],{env:{...process.env,WCU_INDICATOR:'0',WINDOWS_CU_POWERSHELL:process.env.WINDOWS_CU_POWERSHELL||'powershell.exe'}});
const results=[];
async function call(action,args){const start=performance.now();const r=await client.call('windows_computer_use_'+action,args);assert.ok(!r.isError,JSON.stringify(r));const data=JSON.parse(r.content[0].text);results.push({action,args,result:data,wallMs:Math.round(performance.now()-start)});return data;}
try{
  const started=performance.now();await client.init();
  for(let i=0;i<300&&!state.ready;i++){assert.equal(fixture.exitCode,null,stderr);await delay(100);}
  assert.ok(state.ready,JSON.stringify({state,stderr,exitCode:fixture.exitCode,waitedMs:Math.round(performance.now()-started)}));
  console.log('NATIVE_STARTUP '+JSON.stringify({durationMs:Math.round(performance.now()-started),state}));
  const target={nativeWindowHandle:state.hwnd};
  const tree=await call('accessibility_tree',{...target,detailLevel:'full',maxDepth:5});
  assert.equal(tree.targetResponsive,true);assert.ok(tree.nodeCount>=3,JSON.stringify(tree));
  const find=await call('find',{...target,query:'native needle'});assert.ok(find.results.length>0);assert.ok(find.results[0].patterns.includes('Value'));
  const info=await call('element_info',{...target,elementId:find.results[0].id,detailLevel:'full'});assert.equal(info.element.value,'native needle');
  const stale=await client.call('windows_computer_use_element_info',{...target,elementId:'uia:rt:42-999999999'});assert.equal(stale.isError,true);assert.match(stale.content[0].text,/stale/);
  // Background element actions: BM_CLICK and EM_REPLACESEL reach the WinForms
  // controls with no pointer, keyboard or clipboard, and the fixture (shown
  // without activation) never comes to the foreground.
  const front=async()=>(await call('health',{})).activeWindow?.nativeWindowHandle;
  const button=(await call('find',{...target,query:'Fixture button'})).results[0];
  const pressed=await call('invoke',{...target,elementId:button.id});assert.equal(pressed.method,'BM_CLICK',JSON.stringify(pressed));
  for(let i=0;i<40&&state.clicks!==1;i++)await delay(50);assert.equal(state.clicks,1);
  const box=(await call('find',{...target,query:'Fixture check'})).results[0];
  const ticked=await call('click',{...target,elementId:box.id});assert.equal(ticked.method,'background:BM_CLICK',JSON.stringify(ticked));
  for(let i=0;i<40&&state.checked!==true;i++)await delay(50);assert.equal(state.checked,true);
  const typed=await call('set_value',{...target,elementId:find.results[0].id,value:'background text'});assert.equal(typed.method,'EM_REPLACESEL',JSON.stringify(typed));
  for(let i=0;i<40&&state.text!=='background text';i++)await delay(50);assert.equal(state.text,'background text');
  assert.notEqual(await front(),state.hwnd,'Background element actions must not bring the fixture forward: '+JSON.stringify(state));
  // type_text (auto) writes at the caret of the edit that has the focus in the
  // fixture's own thread, with EM_REPLACESEL. The fixture focuses its edit
  // itself; on a desktop with no recent user input (CI runners) Windows lets
  // that call activate the fixture, and then there is nothing left to check.
  await writeFile(path.join(artifacts,'native-command.json'),JSON.stringify({id:11,action:'focus-edit'}));
  for(let i=0;i<40&&state.focused!==true;i++)await delay(50);assert.equal(state.focused,true);
  const frontBeforeTyping=await front();
  const keyed=await call('type_text',{...target,text:' typed'});assert.equal(keyed.method,'background:EM_REPLACESEL',JSON.stringify(keyed));assert.equal(keyed.verified,true);
  for(let i=0;i<40&&state.text!=='background text typed';i++)await delay(50);assert.equal(state.text,'background text typed');
  // Without a window target, observations follow the window DSH gave input to.
  const followed=await call('accessibility_tree',{maxDepth:1});assert.equal(followed.tree.name,'WCU issue18 isolated native fixture',JSON.stringify(followed).slice(0,300));
  // An element with its own scroll bar scrolls by WM_VSCROLL.
  const linesBox=(await call('find',{...target,query:'Fixture lines'})).results[0];
  const scrolled=await call('scroll',{...target,elementId:linesBox.id,deltaY:240});assert.equal(scrolled.method,'background:WM_VSCROLL',JSON.stringify(scrolled));
  await writeFile(path.join(artifacts,'native-command.json'),JSON.stringify({id:12,action:'first-line'}));
  for(let i=0;i<40&&state.firstLine===undefined;i++)await delay(50);assert.ok(state.firstLine>0,JSON.stringify(state));
  const noExpand=await client.call('windows_computer_use_invoke',{...target,elementId:button.id,action:'expand'});assert.equal(noExpand.isError,true);assert.match(noExpand.content[0].text,/ELEMENT_ACTION_UNSUPPORTED/);
  if(frontBeforeTyping!==state.hwnd)assert.notEqual(await front(),state.hwnd,'Background typing and scrolling must not bring the fixture forward: '+JSON.stringify(state));
  await writeFile(path.join(artifacts,'native-command.json'),JSON.stringify({id:1,action:'hang'}));
  for(let i=0;i<30&&!state.hanging;i++)await delay(50);assert.equal(state.hanging,true);
  const start=performance.now();
  const refused=await call('activate_window',target);assert.equal(refused.activated,false);assert.equal(refused.verification,'unconfirmed');assert.equal(refused.targetResponsive,false);assert.ok(refused.warning);assert.ok(refused.window.name);assert.ok(refused.window.boundingBox);assert.equal(refused.window.source,'win32');
  const stopped=await call('snapshot',{...target,includeScreenshot:false,captureWindow:true});assert.equal(stopped.truncationReason,'targetUnresponsive');assert.equal(stopped.nodeCount,0);
  assert.ok(performance.now()-start<1800,'Hung window entered UIA or activation');
  for(let i=0;i<80&&!state.recovered;i++)await delay(50);assert.equal(state.recovered,true);
  // Windows ghosting can temporarily park the original HWND at (-48000,-48000)
  // after its message loop resumes. Wait for the actual fixture surface to return.
  let restored=false;
  for(let i=0;i<50&&!restored;i++){
    const windows=await call('list_windows',{includeInvisible:false,maxWindows:200});
    restored=windows.windows.some(w=>w.nativeWindowHandle===state.hwnd&&!w.isOffscreen&&w.boundingBox.x>-10000&&w.boundingBox.y>-10000);
    if(!restored)await delay(100);
  }
  assert.ok(restored,'Owned fixture did not recover from Windows ghosting');
  const recovered=await call('accessibility_tree',{...target,maxDepth:5});assert.equal(recovered.targetResponsive,true);assert.ok(recovered.nodeCount>=3);
  console.log('PASS real WinForms cached value/patterns, background BM_CLICK/EM_REPLACESEL, type_text, element scroll and followed observation without the foreground, WM_NULL hung-window circuit break, activation metadata/warning and recovery; no physical input');
}finally{
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify({state,results,stderr},null,2)+'\n');
  await writeFile(path.join(artifacts,'native-command.json'),JSON.stringify({id:100,action:'quit'}));client.child.stdin.end();
  for(let i=0;i<70&&(fixture.exitCode===null||client.child.exitCode===null);i++)await delay(100);
  if(fixture.exitCode===null)fixture.kill();if(client.child.exitCode===null)client.child.kill();
}

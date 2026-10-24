// Live read-only smoke for issue #50: Electron without forced accessibility.
// Opens and closes only its own fixture windows; default tool arguments only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import electron from 'electron';
import {McpTestClient} from './mcp-test-client.mjs';
const artifacts=path.resolve(process.argv[2]);
await mkdir(artifacts,{recursive:true});
const env={...process.env,WCU_INDICATOR:'0'};delete env.ELECTRON_RUN_AS_NODE;
const fixtures=[],results=[];
async function startFixture(name){
  // Each fixture needs its own directory: the page and command files live beside the profile.
  const dir=path.join(artifacts,name);await mkdir(dir,{recursive:true});
  const child=spawn(electron,[path.join(import.meta.dirname,'uia-chromium-fixture.cjs'),path.join(dir,'chromium-profile'),'lazy'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const fixture={name,child,dir,stderr:'',pongs:[]};let buffer='';fixtures.push(fixture);
  child.stderr.on('data',b=>fixture.stderr+=b);
  child.stdout.on('data',b=>{buffer+=b;let e;while((e=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,e);buffer=buffer.slice(e+1);try{const r=JSON.parse(line);if(r.ready)fixture.ready=r;if(r.pong)fixture.pongs.push(r.pong);}catch{}}});
  for(let i=0;i<300&&!fixture.ready;i++){assert.equal(child.exitCode,null,fixture.stderr);await delay(100);}
  assert.ok(fixture.ready,'Chromium startup failed: '+fixture.stderr);return fixture;
}
async function stopFixture(fixture){
  // The renderer must still answer after warm-up, then the fixture quits.
  const expected=fixture.pongs.length+1;
  await writeFile(path.join(fixture.dir,'command.json'),JSON.stringify({action:'ping',id:expected}));
  for(let i=0;i<30&&fixture.pongs.length<expected;i++)await delay(100);
  assert.equal(fixture.pongs.length,expected,'Renderer stopped responding');
  await writeFile(path.join(fixture.dir,'command.json'),JSON.stringify({action:'quit',id:expected+1}));
  for(let i=0;i<50&&fixture.child.exitCode===null;i++)await delay(100);
}
const client=new McpTestClient(process.execPath,[path.join(import.meta.dirname,'../mcp/server.mjs')],{env});
async function call(action,args){
  const start=performance.now();const response=await client.call('windows_computer_use_'+action,args);
  assert.ok(!response.isError,JSON.stringify(response));
  const r=JSON.parse(response.content.find(x=>x.type==='text').text);
  assert.equal(r.ok,true);results.push({action,args,result:r,wallMs:Math.round(performance.now()-start)});return r;
}
const names=node=>node?[node.name,...(node.children||[]).flatMap(names)]:[];
const layoutPane=element=>element.controlType==='Pane'&&['RootView','NonClientView','WinFrameView','ClientView','View'].includes(element.className);
try{
  await client.init();
  // First observation of a cold window: the page tree is enabled and reached at default depth.
  const cold=await startFixture('tree');const target={nativeWindowHandle:cold.ready.hwnd};
  const tree=await call('accessibility_tree',target);
  assert.deepEqual([tree.webContent?.renderers,tree.webContent?.ready,tree.webContent?.state],[1,1,'ready'],JSON.stringify(tree.webContent));
  assert.ok(tree.webContent.waitedMs<=1600,'One call waits at most 1.5 s');
  assert.ok(names(tree.tree).includes('Fixture action'),'Default-depth tree misses the page: '+names(tree.tree).join('|'));
  assert.doesNotMatch(tree.hint||'',/Chromium/);
  const found=await call('find',{...target,query:'Fixture action',ocrFallback:false});
  assert.equal(found.source,'uia');assert.ok(found.results.length>0,'find fell short of the page');assert.match(found.results[0].id,/^uia:rt:/);
  assert.equal((await call('element_info',{...target,elementId:found.results[0].id})).element.name,'Fixture action');
  const snap=await call('snapshot',{...target,includeScreenshot:false});
  assert.ok(names(snap.tree).includes('Fixture action'),'Default snapshot depth misses the page');
  assert.equal((await call('wait_for',{...target,condition:'element',query:'Item 1'})).verification,'observed');
  await stopFixture(cold);
  // A cold window hit-tested by point answers with page content, not its layout pane.
  // The fixture is never raised above other windows, so on a developer desktop
  // another window may cover it; the check then reports a skip instead of failing.
  const pointWindow=await startFixture('point');
  const box=(await call('list_windows',{maxWindows:200})).windows.find(w=>w.nativeWindowHandle===pointWindow.ready.hwnd)?.boundingBox;
  assert.ok(box,'Fixture window not listed');
  const response=await client.call('windows_computer_use_element_info',{nativeWindowHandle:pointWindow.ready.hwnd,x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height*0.6)});
  let pointSummary='cold point check skipped: another window covers the fixture';
  if(!(response.isError&&/occluded/.test(response.content[0].text))){
    assert.ok(!response.isError,JSON.stringify(response));
    const hit=JSON.parse(response.content[0].text);results.push({action:'element_info',result:hit});
    assert.equal(hit.webContent?.state,'ready',JSON.stringify(hit.webContent));
    assert.ok(!layoutPane(hit.element),'Point resolved to a layout pane: '+JSON.stringify(hit.element));
    pointSummary=`cold point resolves to ${hit.element.controlType}`;
  }
  await stopFixture(pointWindow);
  console.log(`PASS lazy Chromium ${cold.ready.chromium}: first default tree ${tree.nodeCount} nodes after ${tree.webContent.waitedMs} ms warm-up, find/element_info/snapshot/wait_for reach the page, ${pointSummary}, renderers responsive`);
}finally{
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify({fixtures:fixtures.map(f=>({name:f.name,ready:f.ready,stderr:f.stderr,pongs:f.pongs})),results,backendStderr:client.stderr},null,2)+'\n');
  client.child.stdin.end();
  for(const f of fixtures)if(f.child.exitCode===null){await writeFile(path.join(f.dir,'command.json'),JSON.stringify({action:'quit',id:1000}));f.child.stdin.end();}
  for(let i=0;i<50&&(fixtures.some(f=>f.child.exitCode===null)||client.child.exitCode===null);i++)await delay(100);
  for(const f of fixtures)if(f.child.exitCode===null)f.child.kill();if(client.child.exitCode===null)client.child.kill();
}

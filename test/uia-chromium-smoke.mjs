// Live read-only smoke. Opens and closes only its own Chromium fixture.
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
const fixture=spawn(electron,[path.join(import.meta.dirname,'uia-chromium-fixture.cjs'),path.join(artifacts,'chromium-profile')],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let ready,buffer='',stderr='',pongs=[];
fixture.stderr.on('data',b=>stderr+=b);
fixture.stdout.on('data',b=>{buffer+=b;let e;while((e=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,e);buffer=buffer.slice(e+1);try{const r=JSON.parse(line);if(r.ready)ready=r;if(r.pong)pongs.push(r.pong);}catch{}}});
const clients=[],results=[];
async function makeClient(root,powershell,label){
  const temp=path.join(artifacts,label+'-'+path.basename(powershell).replaceAll('.','-'));
  await mkdir(temp,{recursive:true});
  const client=new McpTestClient(process.execPath,[path.join(root,'mcp/server.mjs')],{env:{...env,TEMP:temp,TMP:temp,WINDOWS_CU_POWERSHELL:powershell}});
  clients.push(client);await client.init();return client;
}
async function call(client,action,args){
  const start=performance.now();const response=await client.call('windows_computer_use_'+action,args);
  assert.ok(!response.isError,JSON.stringify(response));
  const r=JSON.parse(response.content.find(x=>x.type==='text').text);
  assert.equal(r.ok,true);results.push({action,args,result:r,wallMs:Math.round(performance.now()-start)});return r;
}
try{
  for(let i=0;i<300&&!ready;i++){assert.equal(fixture.exitCode,null,stderr);await delay(100);}
  assert.ok(ready,'Chromium startup failed: '+stderr);
  for(const powershell of (process.env.WINDOWS_CU_POWERSHELL?[process.env.WINDOWS_CU_POWERSHELL]:['powershell.exe','pwsh'])){
    const client=await makeClient(path.join(import.meta.dirname,'..'),powershell,'cached');
    const tools=await client.request('tools/list');
    assert.equal(tools.tools.find(x=>x.name==='windows_computer_use_element_info').inputSchema.properties.detailLevel.default,'compact');
    for(const name of ['snapshot','accessibility_tree','find']) assert.equal(tools.tools.find(x=>x.name==='windows_computer_use_'+name).inputSchema.properties.treeTimeoutMs.default,5000);
    const target={nativeWindowHandle:ready.hwnd,includeOffscreen:true};
    if(process.env.WCU_BASELINE_ROOT){
      const baseline=await makeClient(process.env.WCU_BASELINE_ROOT,powershell,'baseline');
      // Identical raw projection, caps and metadata. Counterbalance run order;
      // these are fixture measurements, not a claim about the reporter's CEF app.
      for(const order of [[baseline,client],[client,baseline]])for(const probe of order){
        for(const detailLevel of ['compact','full']){
          const r=await call(probe,'accessibility_tree',{...target,viewMode:'raw',detailLevel,maxDepth:12,maxNodes:300});
          assert.equal(r.nodeCount,300);results.at(-1).implementation=probe===baseline?'0.2.5':'cached';
          const health=await call(client,'accessibility_tree',{...target,maxDepth:0,maxNodes:1});assert.equal(health.targetResponsive,true);
        }
      }
    }
    const cold=await call(client,'accessibility_tree',{...target,maxNodes:300,maxDepth:12});
    assert.ok(cold.nodeCount>10,JSON.stringify(cold));assert.equal(cold.targetResponsive,true);
    // Default arguments reach the page through Chromium's unnamed layout panes.
    const names=node=>node?[node.name,...(node.children||[]).flatMap(names)]:[];
    const defaults=await call(client,'accessibility_tree',{nativeWindowHandle:ready.hwnd});
    assert.equal(defaults.webContent?.state,'ready');assert.ok(names(defaults.tree).includes('Fixture action'),'Default depth misses the page');
    for(const viewMode of ['control','raw','content']){
      const r=await call(client,'accessibility_tree',{...target,viewMode,detailLevel:'full',maxDepth:12,maxNodes:300});
      assert.ok(r.nodeCount>10);assert.equal(r.targetResponsive,true);assert.ok(!r.providerError,r.providerError);
    }
    const found=await call(client,'find',{...target,query:'needle value',maxNodes:300,maxDepth:12});
    assert.ok(found.results.length>0,'Value-based find failed');assert.ok(found.results[0].patterns.includes('Value'));
    const el=await call(client,'element_info',{...target,elementId:found.results[0].id});
    assert.ok(!('patterns' in el.element));assert.equal(el.element.id,found.results[0].id);
    const full=await call(client,'element_info',{...target,elementId:found.results[0].id,detailLevel:'full'});
    assert.equal(full.element.value,'needle value');assert.ok(full.element.patterns.includes('Value'));
    const bounded=await call(client,'accessibility_tree',{...target,maxNodes:3,maxDepth:12});
    assert.equal(bounded.nodeCount,3);assert.equal(bounded.truncationReason,'maxNodes');
    const snap=await call(client,'snapshot',{...target,includeScreenshot:false,maxNodes:30,maxDepth:6});
    assert.equal(snap.targetResponsive,true);
    const budget=await call(client,'accessibility_tree',{...target,maxNodes:3000,maxDepth:12,treeTimeoutMs:100});
    assert.equal(budget.truncationReason,'timeBudget');assert.equal(budget.targetResponsive,true);
    const expected=pongs.length+1;
    await writeFile(path.join(artifacts,'command.json'),JSON.stringify({action:'ping',id:expected}));
    for(let i=0;i<30&&pongs.length<expected;i++)await delay(100);
    assert.equal(pongs.length,expected,'Renderer stopped responding');
    console.log(`PASS Chromium ${ready.chromium} ${powershell}: ${cold.nodeCount} nodes, cached full/value/patterns, stable id, all views, node/time bounds, renderer responsive`);
  }
}finally{
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify({ready,results,pongs,stderr,backendStderr:clients.map(c=>c.stderr)},null,2)+'\n');
  for(const c of clients)c.child.stdin.end();
  await writeFile(path.join(artifacts,'command.json'),JSON.stringify({action:'quit',id:100}));fixture.stdin.end();
  for(let i=0;i<50&&(fixture.exitCode===null||clients.some(c=>c.child.exitCode===null));i++)await delay(100);
  if(fixture.exitCode===null)fixture.kill();for(const c of clients)if(c.child.exitCode===null)c.child.kill();
}

// Real WinForms controls and production cancellation wiring. No physical input.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wcu-quiet-production-'));
const repo=process.env.WCU_QUIET_TEST_REPO||path.resolve(import.meta.dirname,'..');
const fixture=spawn('powershell.exe',['-NoProfile','-Sta','-File',path.join(import.meta.dirname,'uia-native-fixture.ps1'),root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let state={},buffer='',stderr='';fixture.stderr.on('data',b=>stderr+=b);fixture.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{Object.assign(state,JSON.parse(line))}catch{}}});
const c=new McpTestClient(process.execPath,[path.join(repo,'mcp/server.mjs')],{env:{...process.env,WCU_TEST_NO_TAKEOVER:'0',WCU_INDICATOR:'0'}}),results=[];
const call=async(name,args={})=>{const r=await c.call('windows_computer_use_'+name,args);results.push({name,isError:!!r.isError,content:r.content});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text)};
try{
 await c.init();for(let i=0;i<150&&!state.ready;i++)await delay(100);assert.ok(state.ready,stderr);
 const target={nativeWindowHandle:state.hwnd};
 const find=async query=>(await call('find',{...target,query})).results[0];
 const button=await find('Fixture button');assert.equal((await call('invoke',{...target,elementId:button.id})).method,'BM_CLICK');
 const check=await find('Fixture check');assert.equal((await call('click',{...target,elementId:check.id})).method,'background:BM_CLICK');
 const edit=await find('native needle');assert.equal((await call('set_value',{...target,elementId:edit.id,value:'quiet production'})).method,'EM_REPLACESEL');
 for(let i=0;i<40&&(state.clicks!==1||state.checked!==true||state.text!=='quiet production');i++)await delay(50);
 assert.equal(state.clicks,1);assert.equal(state.checked,true);assert.equal(state.text,'quiet production');
 const helpers=Number(execFileSync('powershell.exe',['-NoProfile','-Command',`@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${c.child.pid}" | Where-Object { $_.CommandLine -like '*windows-takeover.ps1*' }).Count`],{encoding:'utf8',windowsHide:true}).trim());
 assert.equal(helpers,0,'background calls must not start a global Esc listener');
 const requestId=c.next,pending=c.call('windows_computer_use_wait',{milliseconds:10000});await delay(200);c.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId}})+'\n');
 const stopped=await pending;assert.equal(stopped.isError,true);assert.match(stopped.content[0].text,/CANCELLED|STOPPED/);
 await call('wait',{milliseconds:1});
 console.log(JSON.stringify({passed:true,productionStopWiring:true,backgroundEffects:3,stopListenerProcesses:helpers,cancellationPreserved:true,root}));
}finally{
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({state,results,stderr},null,2));
 fs.writeFileSync(path.join(root,'native-command.json'),JSON.stringify({id:100,action:'quit'}));c.child.stdin.end();
 for(let i=0;i<100&&(fixture.exitCode===null||c.child.exitCode===null);i++)await delay(50);if(fixture.exitCode===null)fixture.kill();if(c.child.exitCode===null)c.close();
}

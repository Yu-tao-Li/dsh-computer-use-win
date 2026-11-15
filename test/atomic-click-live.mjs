// Optional real input acceptance. Clicks exactly once on this test's own
// WinForms button; the shipped backend returns the pointer and foreground.
// Not part of the ordinary no-physical-input regression runner.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';
assert(process.argv.includes('--live-input'),'Explicit --live-input is required');
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-atomic-click-live-'));
const fixture=spawn('powershell.exe',['-NoProfile','-STA','-File',path.join(import.meta.dirname,'uia-native-fixture.ps1'),root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const state={};let buffer='',stderr='';
fixture.stdout.on('data',data=>{buffer+=data;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{Object.assign(state,JSON.parse(line));}catch{}}});
fixture.stderr.on('data',data=>stderr+=data);
const env={...process.env,WCU_TEST_NO_TAKEOVER:'0',WCU_SETTINGS_JSON:JSON.stringify({progressOverlayEnabled:false,indicatorEnabled:false,cursorIndicatorEnabled:false})};
for(const key of ['WCU_CONFIG_FILE','WCU_STATE_FILE','WCU_ACTIVITY_FILE','WCU_LAYOUT_FILE','WCU_APPROVAL_SECRET','WCU_APPROVAL_LEDGER','WCU_HOST_PID'])delete env[key];
const client=new McpTestClient(process.execPath,[path.join(import.meta.dirname,'../mcp/server.mjs')],{env});
const until=async fn=>{const end=Date.now()+30000;while(!fn()){assert.equal(fixture.exitCode,null,stderr);if(Date.now()>end)throw Error('Owned fixture timed out');await delay(30)}};
const call=async(name,args)=>{const r=await client.call('windows_computer_use_'+name,args);assert.notEqual(r.isError,true,JSON.stringify(r).slice(0,1500));return JSON.parse(r.content[0].text)};
let report,clickResult,foundControls;
try{
 await client.init();await until(()=>state.ready);
 const target={nativeWindowHandle:state.hwnd,processId:state.pid};
 const found=await call('find',{...target,query:'Fixture button',controlType:'Button',maxResults:3});foundControls=found;assert.equal(found.results.length,1);
 const result=await call('click',{...target,elementId:found.results[0].id,dispatch:'foreground'});
 clickResult=result;
 await until(()=>state.clicks===1);await delay(150);assert.equal(state.clicks,1,'No click replay');
 assert.equal(result.method,'sendinput');
 report={passed:true,targetOwnedByFixture:true,clicks:state.clicks,method:result.method,pointer:result.pointer,foreground:result.foreground,physicalInputSent:true,scope:'One real click on owned WinForms button; no clipboard or keys',root};
 console.log(JSON.stringify(report));
}catch(error){report={passed:false,error:error.message,clickResult,foundControls,physicalInputSent:clickResult?true:false,state,root};throw error;}
finally{
 await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));
 await writeFile(path.join(root,'native-command.json'),JSON.stringify({id:100,action:'quit'}));client.child.stdin.end();
 for(let i=0;i<50&&(fixture.exitCode===null||client.child.exitCode===null);i++)await delay(100);
 if(fixture.exitCode===null)fixture.kill();if(client.child.exitCode===null)client.close();
}

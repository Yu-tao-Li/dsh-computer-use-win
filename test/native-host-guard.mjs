// Treat the owned fixture as the host by PID and separately by image path.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-native-host-'));
const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const fixture=spawn(shell,['-NoProfile','-STA','-File',path.join(import.meta.dirname,'uia-native-fixture.ps1'),root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const state={};let buffer='',client,byPath;fixture.stderr.on('data',()=>{});
fixture.stdout.on('data',data=>{buffer+=data;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{Object.assign(state,JSON.parse(line));}catch{}}});
const text=r=>r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
try{
 const deadline=Date.now()+15000;while(!state.ready){if(Date.now()>deadline)throw Error('Fixture did not start');assert.equal(fixture.exitCode,null);await delay(20)}
 const env={...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_HOST_PID:String(state.pid)};delete env.WCU_HOST_EXECUTABLE;
 client=new McpTestClient(process.execPath,[path.join(import.meta.dirname,'../mcp/server.mjs')],{env});await client.init();
 const target={nativeWindowHandle:state.hwnd,processId:state.pid};
 const find=await client.call('windows_computer_use_find',{...target,query:'Fixture button',controlType:'Button'});assert.notEqual(find.isError,true,text(find));
 const button=JSON.parse(text(find)).results[0].id;
 const editFind=await client.call('windows_computer_use_find',{...target,query:'fixture-edit',controlType:'Edit'});assert.notEqual(editFind.isError,true,text(editFind));const edit=JSON.parse(text(editFind)).results[0].id;
 let refused=0;
 for(const [name,args]of [['click',{...target,elementId:button}],['click',{...target,elementId:button,dispatch:'background'}],['set_value',{...target,elementId:edit,value:'must not reach host'}],['activate_window',target],['move_window',{...target,x:10,y:20}],['close_window',target]]){
  const result=await client.call('windows_computer_use_'+name,args);assert.equal(result.isError,true,text(result));assert.match(text(result),/HOST_INPUT_DENIED/);refused++;
 }
 const imageEnv={...env,WCU_HOST_EXECUTABLE:shell};delete imageEnv.WCU_HOST_PID;
 byPath=new McpTestClient(process.execPath,[path.join(import.meta.dirname,'../mcp/server.mjs')],{env:imageEnv});await byPath.init();
 const refusedByPath=await byPath.call('windows_computer_use_activate_window',target);
 assert.equal(refusedByPath.isError,true,text(refusedByPath));
 assert.match(text(refusedByPath),/HOST_INPUT_DENIED:.+host executable/);
 assert.equal(state.clicks,undefined);assert.equal(state.text,undefined);assert.equal(fixture.exitCode,null);
 const report={passed:true,refused,refusedByImagePath:true,readOnlyFindAllowed:true,hostWindowStillOpen:true,noFixtureChanges:true,physicalInputSent:false,root};
 await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 await writeFile(path.join(root,'native-command.json'),JSON.stringify({id:100,action:'quit'}));client?.child.stdin.end();byPath?.child.stdin.end();
 for(let i=0;i<50&&(fixture.exitCode===null||client?.child.exitCode===null||byPath?.child.exitCode===null);i++)await delay(100);
 if(fixture.exitCode===null)fixture.kill();if(client?.child.exitCode===null)client.close();if(byPath?.child.exitCode===null)byPath.close();
}

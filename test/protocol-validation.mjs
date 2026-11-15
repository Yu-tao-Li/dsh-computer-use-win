import assert from 'node:assert/strict';import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {McpTestClient} from './mcp-test-client.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-protocol-')),link=path.join(root,'linked-package');
await symlink(path.resolve(import.meta.dirname,'..'),link,'junction');
const env={...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_ALLOW_LAUNCH_ARGUMENTS:'1'};
const client=new McpTestClient(process.execPath,[path.join(link,'mcp/server.mjs')],{env});
const text=r=>r.content.map(x=>x.text??'').join('\n');
try{
 await client.init();await client.request('ping');
 const schemas=(await client.request('tools/list')).tools;
 const supported=new Set(['type','properties','additionalProperties','required','items','minItems','maxItems','enum','minLength','maxLength','pattern','minimum','maximum','description','default','title']);
 const visit=schema=>{for(const key of Object.keys(schema))assert(supported.has(key),'Unsupported schema keyword '+key);for(const child of Object.values(schema.properties??{}))visit(child);if(schema.items)visit(schema.items);};
 for(const tool of schemas)visit(tool.inputSchema);
 const keySchema=schemas.find(tool=>tool.name==='windows_computer_use_keypress').inputSchema;
 assert.equal(keySchema.properties.thenKeys.maxItems,19);
 assert.equal(keySchema.properties.intervalMs.default,60);
 for(const args of [
  {keys:['alt','h'],thenKeys:[]},
  {keys:['alt','h'],thenKeys:[['ctrl','a','b']]},
  {keys:['alt','h'],thenKeys:[['o']],dispatch:'background'},
  {keys:['alt','h'],thenKeys:[['o']],browserTab:'t1a'},
  {keys:['alt','h'],thenKeys:[['o']],intervalMs:'60'},
 ]){
  const result=await client.call('windows_computer_use_keypress',args);assert.equal(result.isError,true);assert.match(text(result),/INVALID_ARGUMENTS/);
 }
 for(const [args,pattern]of [[{target:''},/at least/],[{target:'x'.repeat(40000)},/at most/],[{target:'fixture.exe',arguments:'x'.repeat(40000)},/at most/]]){
  const result=await client.call('windows_computer_use_launch_app',args);assert.equal(result.isError,true);assert.match(text(result),pattern);
 }
}finally{client.close();}
const broken=path.join(root,'broken');await cp(new URL('../mcp',import.meta.url),path.join(broken,'mcp'),{recursive:true});await mkdir(path.join(broken,'scripts'));
await writeFile(path.join(broken,'scripts/windows-uia.ps1'),`param([switch]$Persistent)\n[Console]::WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress));while($null -ne [Console]::ReadLine()){[Console]::WriteLine('not a JSON response')}`);
const bad=new McpTestClient(process.execPath,[path.join(broken,'mcp/server.mjs')],{env});
try{await bad.init();const start=Date.now(),result=await bad.call('windows_computer_use_wait',{milliseconds:1});assert.match(text(result),/WCU_BACKEND_PROTOCOL_ERROR/);assert(Date.now()-start<5000,'Bad response must fail promptly');}finally{bad.close();}
const ps=spawn(process.env.WINDOWS_CU_POWERSHELL??'powershell.exe',['-NoProfile','-STA','-File',path.resolve(import.meta.dirname,'../scripts/windows-uia.ps1'),'-Persistent'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
try{
 const reply=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error('Bad request was silently dropped')),10000);ps.stdout.on('data',chunk=>{buffer+=chunk;const line=buffer.split(/\r?\n/).find(line=>line.startsWith('{')&&JSON.parse(line).type!=='ready');if(line){clearTimeout(timer);resolve(JSON.parse(line));}});ps.once('error',reject);ps.stdin.write('not JSON\n');});
 assert.equal(reply.ok,false);assert.match(reply.error,/INVALID_JSON|PROTOCOL|JSON/);
}finally{ps.stdin.end();if(ps.exitCode===null)ps.kill();}
console.log(JSON.stringify({passed:true,junctionStartup:true,schemaKeywordsCovered:true,stringBoundsEnforced:true,badResponseFailsFast:true,badRequestReplies:true}));

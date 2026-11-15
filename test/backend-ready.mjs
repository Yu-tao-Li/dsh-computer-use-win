import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-backend-ready-'));
let cases=0;
for(const [name,script,expected]of [
 ['wrong-version',"[Console]::WriteLine((@{type='ready';protocol=99;pid=$PID}|ConvertTo-Json -Compress));Start-Sleep -Seconds 5",/PROTOCOL_MISMATCH/],
 ['missing-ready','Start-Sleep -Seconds 5',/did not become ready/],
 ['wrong-shape',"[Console]::WriteLine('null');Start-Sleep -Seconds 5",/invalid response shape/]
]){
 const dir=path.join(root,name);await mkdir(path.join(dir,'scripts'),{recursive:true});await cp(new URL('../mcp',import.meta.url),path.join(dir,'mcp'),{recursive:true});
 const marker=path.join(dir,'received.txt');
 await writeFile(path.join(dir,'scripts/windows-uia.ps1'),`param([switch]$Persistent)\n${script}\n$line=[Console]::ReadLine();[IO.File]::WriteAllText('${marker.replaceAll("'","''")}',$line)`);
 const client=new McpTestClient(process.execPath,[path.join(dir,'mcp/server.mjs')],{env:{...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_BACKEND_READY_TIMEOUT_MS:name==='missing-ready'?'1000':'10000'}});
 try{
  await client.init();const result=await client.call('windows_computer_use_wait',{milliseconds:1});assert.equal(result.isError,true);assert.match(JSON.stringify(result),expected);
  assert.equal(await readFile(marker).then(()=>true,()=>false),false,'No action can be sent before readiness');cases++;
 }finally{client.close()}
}
console.log(JSON.stringify({passed:true,cases,missingOrWrongHandshakeFailsClosed:true,noActionSent:true}));

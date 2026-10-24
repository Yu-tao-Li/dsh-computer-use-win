import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';
const source=fileURLToPath(new URL('../',import.meta.url));
const root=await mkdtemp(path.join(os.tmpdir(),'dsh-wincu-public-test-'));
const clients=[];
const env={...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_INDICATOR:'0',WINDOWS_CU_POWERSHELL:process.env.WINDOWS_CU_POWERSHELL||'powershell.exe'};
async function fixture(name,script,shortTimeout=false){
  const dir=path.join(root,name);await mkdir(path.join(dir,'mcp'),{recursive:true});await mkdir(path.join(dir,'scripts'));
  let server=await readFile(path.join(source,'mcp/server.mjs'),'utf8');
  // Only the deliberately stalled action gets an accelerated watchdog. Cold
  // worker startup/replacement must not be measured against a 1.5s hang budget.
  if(shortTimeout){assert.ok(server.includes('timeoutMs = 30000'));server=server.replace('function runBackend(action, args = {}, timeoutMs = 30000, request) {','function runBackend(action, args = {}, timeoutMs = 30000, request) { timeoutMs = action === "wait" && args.milliseconds === 5000 ? 1500 : 15000;');}
  await writeFile(path.join(dir,'mcp/server.mjs'),server);
  for(const file of ['settings.mjs','takeover.mjs','browser.mjs'])await copyFile(path.join(source,'mcp',file),path.join(dir,'mcp',file));
  if(script)await writeFile(path.join(dir,'scripts/windows-uia.ps1'),script);else await copyFile(path.join(source,'scripts/windows-uia.ps1'),path.join(dir,'scripts/windows-uia.ps1'));
  const client=new McpTestClient(process.execPath,[path.join(dir,'mcp/server.mjs')],{env});clients.push(client);await client.init();return client;
}
const call=(client,name,args={})=>client.request('tools/call',{name:'windows_computer_use_'+name,arguments:args});
const cancel=(client,id)=>client.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id}})+'\n');
try{
  const a=await fixture('real-a'),b=await fixture('real-b');
  assert.equal((await call(a,'wait',{milliseconds:1})).isError,undefined);
  for(let i=0;i<3;i++){
    const id=a.next,start=performance.now(),active=call(a,'wait',{milliseconds:6000}),queued=call(a,'wait',{milliseconds:6000}),other=call(b,'wait',{milliseconds:50});
    await delay(100);cancel(a,id);
    const results=await Promise.all([active,queued,other]);assert.equal(results[0].isError,true);assert.equal(results[1].isError,true);assert.equal(results[2].isError,undefined);
    assert.ok(performance.now()-start<5000);
    assert.equal((await call(a,'wait',{milliseconds:1})).isError,undefined);
    const fresh=call(a,'wait',{milliseconds:50});cancel(a,id);assert.equal((await fresh).isError,undefined);
  }
  const pending=call(a,'wait',{milliseconds:150}),id=a.next,queued=call(a,'wait',{milliseconds:1000});cancel(a,id);
  assert.equal((await queued).isError,true);assert.equal((await pending).isError,undefined);
  console.log('PASS real wait cancellation, queue cancellation, stale cancellation and separate MCP process');
  const timed=await fixture('timeout',null,true);
  for(let i=0;i<3;i++){
    let result=await call(timed,'wait',{milliseconds:1});assert.equal(result.isError,undefined,JSON.stringify(result));
    result=await call(timed,'wait',{milliseconds:5000});assert.equal(result.isError,true,JSON.stringify(result));assert.match(result.content[0].text,/timed out after 1500ms/);
    result=await call(timed,'wait',{milliseconds:1});assert.equal(result.isError,undefined,JSON.stringify(result));
  }
  console.log('PASS three timeout/replacement-worker recovery cycles');
  const slow=await fixture('slow-start',`param([switch]$Persistent)
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
Start-Sleep -Milliseconds 1800
while($null -ne ($line=[Console]::In.ReadLine())) {
  $r=$line | ConvertFrom-Json
  Start-Sleep -Milliseconds $r.args.milliseconds
  [Console]::WriteLine((@{id=$r.id;ok=$true} | ConvertTo-Json -Compress))
}
`,true);
  let slowResult=await call(slow,'wait',{milliseconds:1});assert.equal(slowResult.isError,undefined,JSON.stringify(slowResult));
  slowResult=await call(slow,'wait',{milliseconds:5000});assert.equal(slowResult.isError,true);assert.match(slowResult.content[0].text,/timed out after 1500ms/);
  slowResult=await call(slow,'wait',{milliseconds:1});assert.equal(slowResult.isError,undefined,JSON.stringify(slowResult));
  console.log('PASS delayed cold startup and replacement, retaining the 1500ms stalled-action watchdog');
  const marker=path.join(root,'cleanup.txt');
  const script=`param([switch]$Persistent)\nwhile($null -ne ($line=[Console]::In.ReadLine())){\n$r=$line|ConvertFrom-Json\nif($r.action -eq 'click'){Start-Sleep -Milliseconds 500;[IO.File]::WriteAllText('${marker.replaceAll("'","''")}','released')}\n[Console]::WriteLine((@{id=$r.id;ok=$true}|ConvertTo-Json -Compress))\n}\n`;
  const input=await fixture('synthetic-input',script);
  assert.equal((await call(input,'wait',{milliseconds:1})).isError,undefined);
  // Deliver both requests together so indicator preparation cannot let the
  // later read overtake the input merely because stdio split the writes.
  input.child.stdin.cork();
  const inputId=input.next,start=performance.now(),action=call(input,'click',{x:1,y:2}),later=call(input,'wait',{milliseconds:1});
  input.child.stdin.uncork();
  await delay(100);cancel(input,inputId);assert.equal((await later).isError,true);assert.equal((await action).isError,true);
  assert.equal(await readFile(marker,'utf8'),'released');assert.ok(performance.now()-start>=450);
  assert.equal((await call(input,'wait',{milliseconds:1})).isError,undefined);
  console.log('PASS simulated input cleanup before worker retirement; no physical input sent');
}finally{
  for(const client of clients){client.child.stdin.end();}
  await Promise.all(clients.map(async client=>{for(let i=0;i<50&&client.child.exitCode===null;i++)await delay(100);if(client.child.exitCode===null){client.child.kill();await new Promise(resolve=>client.child.once('exit',resolve));}}));
  assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('dsh-wincu-public-test-'));
  await rm(root,{recursive:true,force:true});
}

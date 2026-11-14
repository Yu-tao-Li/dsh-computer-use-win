// Real named event and stop-listener process, deterministic long input worker.
// No mouse/keyboard events are synthesized and no user app receives input.
import assert from 'node:assert/strict';import {cp,mkdtemp,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {setTimeout as delay} from 'node:timers/promises';import {McpTestClient} from './mcp-test-client.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-cancel-event-'));
for(const entry of ['mcp','scripts'])await cp(new URL('../'+entry,import.meta.url),path.join(root,entry),{recursive:true});
await writeFile(path.join(root,'scripts/windows-uia.ps1'),`param([switch]$Persistent)
[Console]::WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress));while($null -ne ($line=[Console]::ReadLine())){
 $r=$line|ConvertFrom-Json
 $event=[Threading.EventWaitHandle]::OpenExisting($env:WCU_CANCEL_EVENT)
 [IO.File]::WriteAllText('${root.replaceAll("'","''")}\\started','started')
 $cancelled=$false
 try { for($i=0;$i -lt 500;$i++){if($event.WaitOne(10)){$cancelled=$true;break}} }
 finally {[IO.File]::WriteAllText('${root.replaceAll("'","''")}\\released',[string]$cancelled);$event.Dispose()}
 [Console]::WriteLine((@{id=$r.id;ok=$false;error='COMPUTER_USE_CANCELLED'}|ConvertTo-Json -Compress))
}`);
const client=new McpTestClient(process.execPath,[path.join(root,'mcp/server.mjs')],{env:{...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'0',WCU_SETTINGS_JSON:JSON.stringify({indicatorEnabled:false,cursorIndicatorEnabled:false,progressOverlayEnabled:false})}});
try{
 await client.init();const id=client.next;
 const active=client.call('windows_computer_use_type_text',{text:'fixture',method:'sendinput'});
 const deadline=Date.now()+20000;for(;;){try{await readFile(path.join(root,'started'));break;}catch{if(Date.now()>deadline)throw Error('Fixture did not start: '+client.stderr);await delay(20);}}
 const started=Date.now();client.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id}})+'\n');
 const result=await active;assert.equal(result.isError,true);assert.match(JSON.stringify(result),/COMPUTER_USE_CANCELLED/);
 assert.equal(await readFile(path.join(root,'released'),'utf8'),'True');assert(Date.now()-started<1500,'Cancellation event did not interrupt input promptly');
 console.log(JSON.stringify({passed:true,cancellationEventInterruptsInFlightInput:true,cleanupRan:true,elapsedMs:Date.now()-started,physicalInputSent:false,root}));
}finally{client.close();}

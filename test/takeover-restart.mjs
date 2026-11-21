import assert from 'node:assert/strict';import {mkdtemp,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {TakeoverControl} from '../mcp/takeover.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-takeover-restart-')),holdFile=path.join(root,'hold-event.ps1');
await writeFile(holdFile,`param([string]$CancelEvent)\n$event=[Threading.EventWaitHandle]::OpenExisting($CancelEvent)\n[Console]::WriteLine('held')\n[void][Console]::ReadLine()\n$event.Dispose()\n`);
const control=new TakeoverControl({powershell:'powershell.exe',testMode:true,config:{indicatorEnabled:false,cursorIndicatorEnabled:false}});control.disabledForTest=false;let holder;
try{
 await control.command('status');holder=spawn('powershell.exe',['-NoProfile','-File',holdFile,'-CancelEvent',control.eventName],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Event holder did not start')),5000);holder.stdout.once('data',()=>{clearTimeout(timer);resolve();});holder.once('error',reject);});
 await control.command('stop');const stopped=await control.command('status');assert.equal(stopped.cancelled,true);
 const child=control.child;const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;
 await control.resumeOperation();await control.begin();assert.equal((await control.command('status')).cancelled,false,'Replacement helper must reset an event still held by another process');await control.end();
 const report={passed:true,oldEventKeptAlive:true,replacementResetsCancellation:true,physicalInputSent:false,root};await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{holder?.stdin.end('\n');await control.close();}

// A series that wanted the indicator can exist before the helper acknowledged
// arming. That bookkeeping must not authorize a desktop action.
const guarded=new TakeoverControl({configFile:null,stateFile:null,activityFile:null});
guarded.disabledForTest=false;
guarded.seriesHeld=guarded.seriesIndicator=true;
guarded.child={stdin:{write(){}}};
guarded.command=async()=>{throw new Error('fixture arming rejected');};
await assert.rejects(guarded.begin(),/COMPUTER_USE_PAUSED.*fixture arming rejected/);
assert.equal(guarded.active,0);
assert.equal(guarded.armedChild,null);
guarded.child=null;
await guarded.close();

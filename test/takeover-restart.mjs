import assert from 'node:assert/strict';import {mkdtemp,readdir,stat,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {once} from 'node:events';import {spawn} from 'node:child_process';import {TakeoverControl} from '../mcp/takeover.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-takeover-restart-')),holdFile=path.join(root,'hold-event.ps1');
await writeFile(holdFile,`param([string]$CancelEvent)\n$event=[Threading.EventWaitHandle]::OpenExisting($CancelEvent)\n[Console]::WriteLine('held')\n[void][Console]::ReadLine()\n$event.Dispose()\n`);
const powershell=process.env.WINDOWS_CU_POWERSHELL||'powershell.exe';
const core=path.basename(powershell).toLowerCase().startsWith('pwsh');
process.env.TEMP=root;process.env.TMP=root;
const control=new TakeoverControl({powershell,testMode:true,helperIdleMs:150,config:{indicatorEnabled:false,cursorIndicatorEnabled:false}});control.disabledForTest=false;let holder;
try{
 await control.command('status');
 const files=(await readdir(root)).filter(name=>/^wcu-takeover-core-clr.*\.dll$/.test(name));
 assert.equal(files.length,core?1:0);
 const cached=core?path.join(root,files[0]):null;
 const cachedAt=cached?(await stat(cached)).mtimeMs:null;
 holder=spawn(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',holdFile,'-CancelEvent',control.eventName],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Event holder did not start')),5000);holder.stdout.once('data',()=>{clearTimeout(timer);resolve();});holder.once('error',reject);});
 await control.command('stop');const stopped=await control.command('status');assert.equal(stopped.cancelled,true);
 const child=control.child;const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;
 await control.resumeOperation();await control.begin();assert.equal((await control.command('status')).cancelled,false,'Replacement helper must reset an event still held by another process');
 const idleExit=once(control.child,'exit',{signal:AbortSignal.timeout(5000)});
 await control.end();
 if(cached)assert.equal((await stat(cached)).mtimeMs,cachedAt,'Restart must use the existing compiled takeover helper');
 await idleExit;
 assert.equal(control.child,null,'The native helper process must exit when the last lease becomes idle');
 const report={passed:true,oldEventKeptAlive:true,replacementResetsCancellation:true,coreCacheReused:core,idleProcessExited:true,physicalInputSent:false,root};await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
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

// Exercise the real lifecycle with a fake helper and host activity file.
// No overlays, hooks, or desktop input are needed for these cases.
const activityFile=path.join(root,'idle-activity.json');
const displaysOff={indicatorEnabled:false,cursorIndicatorEnabled:false,progressOverlayEnabled:false};
const lifetime=new TakeoverControl({configFile:null,stateFile:null,activityFile,config:displaysOff,helperIdleMs:70});
lifetime.disabledForTest=false;
clearTimeout(lifetime.poll);
const calls=[];
let starts=0,exits=0,progressWindow=false;
lifetime.command=async function(name){
  calls.push(name);
  if(!this.child){
    starts++;
    this.child={exitCode:null,signalCode:null,kill:()=>exits++};
  }
  if(name==='begin')this.armedChild=this.child;
  if(name==='end')this.armedChild=null;
  return {progressVisible:progressWindow};
};
const idle=async()=>{
  const expires=Date.now()+3000;
  while(lifetime.child&&Date.now()<expires)await new Promise(r=>setTimeout(r,20));
  assert.equal(lifetime.child,null,'An idle helper must exit');
};
try{
  await writeFile(activityFile,JSON.stringify({active:false}));
  await lifetime.sync();
  assert.equal(starts,0,'An idle host must not start its helper');
  await writeFile(activityFile,JSON.stringify({active:true,indicator:false,sessionId:'fixture',turn:1,expiresAt:Date.now()+10000}));
  await lifetime.begin({quiet:true});
  await lifetime.end({quiet:true});
  assert.equal(starts,0,'A quiet call with all displays off must not start a helper');
  await writeFile(activityFile,JSON.stringify({active:true,indicator:true,sessionId:'fixture',turn:1,expiresAt:Date.now()+10000}));
  await lifetime.begin({quiet:true});
  await lifetime.end({quiet:true});
  assert.equal(starts,0,'A host series alone must not wake the helper with displays off');

  await lifetime.begin();
  assert.equal(starts,1,'A real input lease still starts the stop listener');
  await lifetime.end();
  await new Promise(r=>setTimeout(r,120));
  assert.equal(exits,0,'A desktop series must keep its armed listener between calls');
  await writeFile(activityFile,JSON.stringify({active:false}));
  await lifetime.sync();
  await idle();
  assert.equal(exits,1);

  lifetime.config={...lifetime.config,progressOverlayEnabled:true};
  await writeFile(activityFile,JSON.stringify({active:false,lingerUntil:Date.now()+250,progress:{status:'done'}}));
  await lifetime.sync();
  assert.equal(starts,2,'Finished progress must still be shown');
  await new Promise(r=>setTimeout(r,120));
  assert.equal(exits,1,'Visible progress must keep the helper alive');
  progressWindow=true;
  await writeFile(activityFile,JSON.stringify({active:false}));
  await lifetime.sync();
  await new Promise(r=>setTimeout(r,120));
  assert.equal(exits,1,'An adjusting progress window can defer its close');
  progressWindow=false;
  await idle();
  assert.equal(exits,2);
  assert.equal(lifetime.paused,false,'Idle exit must not pause input');
  assert.ok(calls.includes('status'),'Idle exit checks the native window state first');
}finally{
  lifetime.killHelper(new Error('Fixture complete'),lifetime.child,{failIfActive:false});
  await lifetime.close();
}
console.log('PASS quiet calls skip the helper, input retains its stop listener, and idle retirement respects progress windows');

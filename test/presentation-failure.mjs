import assert from 'node:assert/strict';import {mkdtemp,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {TakeoverControl,STOPPED} from '../mcp/takeover.mjs';import {installActivity} from '../mcp/activity.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-presentation-failure-')),blocked=path.join(root,'not-a-directory');await writeFile(blocked,'fixture');
const control=new TakeoverControl({stateFile:path.join(blocked,'state.json')});control.disabledForTest=true;
const oldStop=new TakeoverControl();oldStop.disabledForTest=true;oldStop.paused=true;oldStop.pauseMessage=STOPPED;oldStop.stoppedAt=Date.now()-3600000;oldStop.stopReported=false;
await assert.rejects(oldStop.begin(),error=>error.message===STOPPED);assert.equal(oldStop.stopReported,true);await oldStop.begin();await oldStop.end();await oldStop.close();
try{await control.begin();assert.equal(control.active,1);await control.end();assert.equal(control.active,0);assert.equal(control.shown,0);}finally{await control.close();}
const concurrent=new TakeoverControl();concurrent.disabledForTest=false;concurrent.active=1;concurrent.shown=1;
let release,entered;const enteredBegin=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const commands=[];
concurrent.command=async name=>{commands.push(name);if(name==='begin'){entered();await gate;}return {};};
const acquiring=concurrent.begin();await enteredBegin;await concurrent.end();assert.equal(concurrent.shown,1);assert(!commands.includes('end'),'A prior end must not disarm a reserved input lease');release();await acquiring;await concurrent.end();await concurrent.close();
const handlers={},disposers=[],warnings=[];
const ctx={on:(name,fn)=>handlers[name]=fn,effect:fn=>disposers.push(fn()),logger:{warn:error=>warnings.push(String(error)),error:error=>warnings.push(String(error))}};
installActivity(ctx,path.join(blocked,'activity.json'));
try{
 const exec={name:'mcp__wincu__windows_computer_use_click',arguments:{x:1,y:1},agent:{session:{id:'fixture'},phase:{kind:'running',turn:1}},signal:new AbortController().signal};
 const result=await handlers['tools/execute'](exec,async()=>({ok:true,sentinel:'action completed'}));
 assert.equal(result.sentinel,'action completed');assert.ok(warnings.length);
}finally{for(const dispose of disposers.reverse())dispose?.();}
console.log(JSON.stringify({passed:true,stateWriteFailureDoesNotCorruptLease:true,publishFailurePreservesSuccessfulResult:true}));

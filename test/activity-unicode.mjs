// Host events -> activity file -> real .NET helper, including split stream emoji.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installActivity } from '../mcp/activity.mjs';
import { TakeoverControl } from '../mcp/takeover.mjs';
import { DEFAULT_SETTINGS } from '../mcp/settings.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-unicode-'));
const file=path.join(root,'activity.json'),handlers={},disposers=[];
const config={...DEFAULT_SETTINGS,progressOverlayEnabled:true,progressOverlayMode:'source'};
const activity=installActivity({on:(name,fn)=>{handlers[name]=fn;},effect:fn=>disposers.push(fn()),logger:{error:error=>{throw error;}}},file,{getSettings:()=>config});
const session={id:'unicode'},agent={session,phase:{kind:'running',turn:1}};
const event=(type,data)=>handlers['session/event'](session,{type,data:{turn:1,...data}});
const chunk=(step,type,text)=>event('assistant/chunk',{step,chunk:{type,text}});
const control=new TakeoverControl({activityFile:file,testMode:true,config});control.disabledForTest=false;
function wellFormed(value){if(typeof value==='string')assert.equal(value.isWellFormed(),true,'No lone surrogates may reach .NET');else if(value&&typeof value==='object')Object.values(value).forEach(wellFormed);}
const state=async()=>{activity.refresh();const result=JSON.parse(await readFile(file,'utf8'));wellFormed(result);return result;};
try {
  await handlers['tools/execute']({name:'mcp__wincu__windows_computer_use_wait',arguments:{},agent},async()=>true);
  event('step/start',{step:1});
  chunk(1,'reasoning-delta','x'.repeat(299)+'😀z');
  chunk(1,'text-delta','x'.repeat(1201)+'😀'+'y'.repeat(1199));
  let saved=await state();assert.equal(saved.progress.intent,'x'.repeat(299));assert.equal(saved.progress.reply,'y'.repeat(1199));
  event('step/start',{step:2});
  chunk(2,'text-delta','q'.repeat(1198)+'😀'+'z'.repeat(30));
  event('turn/end',{reason:{kind:'completed'}});
  saved=await state();assert.equal(saved.progress.reply,'q'.repeat(1198)+'…','Final reply prefix must not cut the emoji');
  agent.phase.turn=2;
  await handlers['tools/execute']({name:'mcp__wincu__windows_computer_use_wait',arguments:{},agent},async()=>true);
  handlers['session/event'](session,{type:'assistant/chunk',data:{turn:2,step:1,chunk:{type:'text-delta',text:'\uD83D'}}});
  saved=await state();assert.equal(saved.progress.reply,'\uFFFD','A temporarily incomplete stream must serialize safely');
  handlers['session/event'](session,{type:'assistant/chunk',data:{turn:2,step:1,chunk:{type:'text-delta',text:'\uDE00'}}});
  saved=await state();assert.equal(saved.progress.reply,'😀','The original stream buffer must preserve the complete emoji');
  await control.sync();
  const native=await control.command('status');assert.equal(native.progressVisible,true);assert.ok(native.progressContent.includes('😀'));
  console.log('PASS host text limits, reply completion, split emoji streaming and actual .NET JSON/render path');
} finally {await control.close();for(const dispose of disposers)dispose?.();}

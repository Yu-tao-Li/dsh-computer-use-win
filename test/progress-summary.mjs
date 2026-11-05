import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createProgressSummarizer,summarizeProgress,summaryInput,SUMMARY_MAX_TOKENS,SUMMARY_FIRST_DELAY_MS,SUMMARY_INPUT_CHARS} from '../mcp/progress-summary.mjs';
import {installActivity} from '../mcp/activity.mjs';
import {DEFAULT_SETTINGS,normalizeSettings} from '../mcp/settings.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{await flush();await flush();};
const owner=()=>({id:'a',turn:1,session:{id:'a'},progress:{step:2,status:'thinking',tool:'',reasoning:'Inspecting the settings page.',reply:'',
  steps:[{step:2,actions:[{label:'读取页面内容',state:'done'}],reasoning:'Inspecting the settings page.',reply:''}]}});
assert.equal(DEFAULT_SETTINGS.progressOverlayMode,'source');
assert.throws(()=>normalizeSettings({progressOverlayMode:'invalid'}),/progressOverlayMode/);
let settings={...DEFAULT_SETTINGS},clock=1000,calls=[],lookups=0,changes=0;
const item=owner();
const summary=createProgressSummarizer({get:()=>{lookups++;throw Error('No model in source mode');}},{
  getSettings:()=>settings,now:()=>clock,onChange:()=>changes++,request:async(_ctx,session,input,signal)=>{
    calls.push({session,input,signal});return '正在查看设置页面。';
  }});
summary.update(item);clock+=20000;summary.update(item);await settle();
assert.equal(calls.length,0);assert.equal(lookups,0);assert.equal(item.progress.displayMode,'source');
settings={...settings,progressOverlayMode:'summary'};summary.update(item);assert.equal(calls.length,0,'The first summary waits briefly for material');
clock+=SUMMARY_FIRST_DELAY_MS;summary.update(item);await settle();
assert.equal(calls.length,1);assert.equal(item.progress.summary,'正在查看设置页面。');assert.equal(changes,1);
assert.deepEqual(item.progress.summaries,[{step:2,text:'正在查看设置页面。',final:false}]);
assert.match(calls[0].input,/第 2 步：读取页面内容/);
assert.match(summaryInput({...item.progress,intent:'The user wants the settings page checked.'}),/任务开头的模型输出：The user wants the settings page checked\./,'The summary sees how the model understood the task');
clock+=20000;summary.update(item);await settle();assert.equal(calls.length,1,'Identical input is not summarized again');
item.progress.steps[0].reasoning=item.progress.reasoning='x'.repeat(5000);item.progress.privateArguments='SECRET_TOOL_ARGUMENTS';
summary.update(item);await settle();assert.equal(calls.length,2);
assert.ok(calls[1].input.length<=SUMMARY_INPUT_CHARS);assert.ok(!calls[1].input.includes('SECRET'));
// A new step keeps the last summary on screen and cannot bypass the interval.
item.progress.step=3;item.progress.steps.push({step:3,actions:[{label:'滚动页面',state:'running'}],reasoning:'Next page',reply:''});
clock+=1000;summary.update(item);clock+=1000;summary.update(item);await settle();
assert.equal(calls.length,2,'A new step cannot bypass the interval');assert.equal(item.progress.summary,'正在查看设置页面。','A new step keeps the last summary');
clock+=8000;summary.update(item);await settle();assert.equal(calls.length,3);assert.match(calls[2].input,/第 3 步：滚动页面（进行中）/);
// The end of the turn gets one final summary at once, whatever the interval.
item.progress.status='done';item.progress.steps.at(-1).reply='已经到底。';summary.update(item);await settle();
assert.equal(calls.length,4);assert.match(calls[3].input,/任务状态：已完成/);assert.match(calls[3].input,/给用户的回复：已经到底。/);
assert.equal(item.progress.summaryFinal,true);clock+=60000;summary.update(item);await settle();assert.equal(calls.length,4,'One final summary per turn');
settings={...settings,progressOverlayEnabled:false};summary.update(item);clock+=20000;summary.update(item);
assert.equal(item.progress.displayMode,'source');assert.equal(calls.length,4);summary.close();
// Long histories drop their oldest steps first and stay within the bound.
const long={step:40,status:'acting',steps:Array.from({length:30},(_,i)=>({step:i+1,actions:[{label:'滚动页面',state:'done'}],reasoning:'y'.repeat(300),reply:''}))};
const bounded=summaryInput(long);assert.ok(bounded.length<=SUMMARY_INPUT_CHARS);assert.match(bounded,/第 30 步/);assert.ok(!bounded.includes('第 1 步：'));

// One request per turn is in flight. A new step does not cancel it (its answer
// still describes the turn); a different turn, source mode, closing the
// overlay or the final summary does, and the stale answer is discarded.
let pending=[],mode={...DEFAULT_SETTINGS,progressOverlayMode:'summary'};
const slow=createProgressSummarizer({}, {getSettings:()=>mode,intervalMs:0,initialDelayMs:0,
  request:(_ctx,session,input,signal)=>new Promise(resolve=>pending.push({session,input,signal,resolve}))});
const a=owner();slow.update(a);await settle();slow.update(a);assert.equal(pending.length,1);
a.progress.step=3;a.progress.steps.push({step:3,actions:[],reasoning:'more',reply:''});slow.update(a);await settle();
assert.equal(pending[0].signal.aborted,false,'A new step keeps the running request');assert.equal(pending.length,1);
pending[0].resolve('第 2 步的总结');await settle();assert.equal(a.progress.summary,'第 2 步的总结');assert.equal(a.progress.summaryStep,2);
slow.update(a);await settle();assert.equal(pending.length,2);
mode={...mode,progressOverlayMode:'source'};slow.update(a);assert.equal(pending[1].signal.aborted,true);
pending[1].resolve('STALE_MODE');await settle();assert.equal(a.progress.summary,'');
mode={...mode,progressOverlayMode:'summary'};slow.update(a);await settle();assert.equal(pending.length,3);
a.progress.status='done';slow.update(a);assert.equal(pending[2].signal.aborted,true,'The final summary replaces a running one');await settle();assert.equal(pending.length,4);
pending[2].resolve('STALE_RUNNING');pending[3].resolve('结果总结');await settle();
assert.equal(a.progress.summary,'结果总结');assert.equal(a.progress.summaryFinal,true);
const b={...owner(),id:'b',session:{id:'b'}};slow.update(b);await settle();assert.equal(pending.length,5);
slow.update(undefined);assert.equal(pending[4].signal.aborted,true);pending[4].resolve('STALE_TURN');await settle();assert.equal(b.progress.summary,'');
const c={...owner(),id:'c',session:{id:'c'}};slow.update(c);await settle();
mode={...mode,progressOverlayEnabled:false};slow.update(c);assert.equal(pending[5].signal.aborted,true);slow.close();

let timeoutChanges=0;
const timed=createProgressSummarizer({}, {getSettings:()=>({progressOverlayMode:'summary'}),initialDelayMs:0,timeoutMs:15,
  request:()=>new Promise(()=>{}),onChange:()=>timeoutChanges++});
const timedOwner=owner();timed.update(timedOwner);await new Promise(resolve=>setTimeout(resolve,40));
assert.equal(timedOwner.progress.summaryStatus,'unavailable');assert.equal(timeoutChanges,1);timed.close();
let failures=0;
const failed=createProgressSummarizer({}, {getSettings:()=>({progressOverlayMode:'summary'}),initialDelayMs:0,intervalMs:0,
  request:async()=>{failures++;throw Error('No quota');}});
const failedOwner=owner();failed.update(failedOwner);await settle();failed.update(failedOwner);await settle();
assert.equal(failures,1);assert.equal(failedOwner.progress.summaryStatus,'unavailable');failed.close();

// The real activity owner supplies only its own bounded stream; an auxiliary
// summary does not get appended as a new agent message or renew the idle lease.
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-progress-summary-'));
const activityFile=path.join(root,'activity.json'),handlers={},disposers=[];let requested=0;
let liveSettings={...DEFAULT_SETTINGS};
installActivity({on:(name,fn)=>handlers[name]=fn,effect:fn=>disposers.push(fn()),logger:{error:error=>{throw error;}}},activityFile,
  {getSettings:()=>liveSettings,summaryOptions:{initialDelayMs:0,intervalMs:0,request:async(_ctx,_session,input)=>{
    requested++;assert.ok(!input.includes('OTHER_SESSION_SECRET'));return '正在检查页面。';
  }}});
const session={id:'activity'},agent={session,phase:{kind:'running',turn:1}};
try{
  await handlers['tools/execute']({name:'windows_computer_use_snapshot',agent,arguments:{private:'SECRET'}},async()=>true);
  assert.equal(requested,0);
  handlers['session/event']({id:'other'},{type:'assistant/chunk',data:{turn:1,chunk:{type:'text-delta',text:'OTHER_SESSION_SECRET'}}});
  liveSettings={...liveSettings,progressOverlayMode:'summary'};
  await handlers['tools/execute']({name:'windows_computer_use_wait',agent},async()=>true);await settle();
  assert.ok(requested>0);assert.equal(JSON.parse(await readFile(activityFile,'utf8')).progress.summary,'正在检查页面。');
  assert.ok(!(await readFile(activityFile,'utf8')).includes('SECRET'),'Call arguments never reach the overlay data');
  const before=requested;handlers['session/event'](session,{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});await settle();
  const ended=JSON.parse(await readFile(activityFile,'utf8'));
  assert.equal(ended.active,false);assert.equal(ended.progress.status,'done');assert.ok(ended.lingerUntil>Date.now(),'The finished state lingers');
  assert.equal(requested,before+1,'The end of the turn asks for one final summary');
}finally{for(const dispose of disposers)dispose?.();}

// #70: while a reply streams the file keeps its last 1200 characters; when the
// turn finishes, a longer final reply is shown from its start with "…" at the end.
{
  const file=path.join(root,'reply-start.json'),on={},stops=[];
  installActivity({on:(name,fn)=>on[name]=fn,effect:fn=>stops.push(fn()),logger:{error:error=>{throw error;}}},file,{getSettings:()=>({...DEFAULT_SETTINGS})});
  const who={id:'reply-start'},running=turn=>({session:who,phase:{kind:'running',turn}});
  const stream=frame=>on['agent/assistant-stream']({agent:{session:who},frame});
  const reply=Array.from({length:300},(_,index)=>`ReplyLine${String(index).padStart(4,'0')}.`).join('');
  const send=(attemptId,text)=>{for(let at=0;at<text.length;at+=97)stream({type:'chunk',attemptId,chunk:{type:'text-delta',text:text.slice(at,at+97)}});};
  const finish=turn=>{on['session/event'](who,{type:'turn/end',data:{turn,reason:{kind:'completed'}}});return JSON.parse(readFileSync(file,'utf8')).progress;};
  try{
    await on['tools/execute']({name:'mcp__wincu__windows_computer_use_wait',arguments:{},agent:running(1),signal:new AbortController().signal},async()=>true);
    stream({type:'start',attemptId:'r1',turn:1,step:2});send('r1',reply);
    await new Promise(resolve=>setTimeout(resolve,1100));
    const streaming=JSON.parse(readFileSync(file,'utf8')).progress.steps.at(-1).reply;
    assert.equal(streaming.length,1200);assert.ok(streaming.endsWith('ReplyLine0299.'),'A streaming reply follows its end');
    const done=finish(1),last=done.steps.at(-1);
    assert.ok(last.reply.startsWith('ReplyLine0000.'),'A finished long reply starts at its beginning');
    assert.ok(last.reply.endsWith('…'));assert.equal(last.reply.length,1200);assert.equal(done.reply,last.reply);
    // A retried attempt's start is dropped with its text, and a short reply is unchanged.
    await on['tools/execute']({name:'mcp__wincu__windows_computer_use_wait',arguments:{},agent:running(2),signal:new AbortController().signal},async()=>true);
    stream({type:'start',attemptId:'r2',turn:2,step:3});send('r2','ABANDONED_START '+reply);
    stream({type:'end',attemptId:'r2',outcome:{kind:'abandoned'}});
    stream({type:'start',attemptId:'r3',turn:2,step:3});send('r3','Short final reply.');
    const short=finish(2).steps.at(-1).reply;
    assert.equal(short,'Short final reply.','A short reply is shown whole, without an abandoned start');
  }finally{for(const stop of stops)stop?.();}
}

// Exercise the shipped DSH LLM service when supplied, with a local adapter.
// This verifies canonical message/stream/routing contracts without a paid API.
let hostLlm=false;
if(process.argv[2]){
  const require=createRequire(path.join(process.argv[2],'../package.json'));
  const load=name=>import(pathToFileURL(require.resolve(name)).href);
  const [{Context},{LlmRuntime,LlmAdapter}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-llm')]);
  const host=new Context(),llm=new LlmRuntime(host);let dispatched=0;
  class FixtureAdapter extends LlmAdapter{
    resolveModel(provider,model){return {provider,id:model,name:model,reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
    async *stream(options){
      dispatched++;assert.equal(options.provider,'summary-fixture');assert.equal(options.model,'current-conversation-model');
      assert.equal(options.maxTokens,SUMMARY_MAX_TOKENS);assert.equal(options.purpose,'computer-use-progress');
      assert.equal(options.tools,undefined);assert.equal(options.messages.length,1);assert.ok(options.messages[0].id);
      assert.equal(options.messages[0].role,'user');assert.equal(options.messages[0].content[0].text,'fixture input');
      yield {type:'reasoning-delta',index:0,text:'Do not display this extra reasoning'};
      yield {type:'text-delta',index:1,text:'正在查看设置。'};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  try{
    llm.registerAdapter(['summary-fixture'],new FixtureAdapter());
    const value=await summarizeProgress(host,{id:'fixture',requestHeader:()=>({config:{provider:'summary-fixture',model:'current-conversation-model'}})},'fixture input',new AbortController().signal);
    assert.equal(value,'正在查看设置。');assert.equal(dispatched,1);hostLlm=true;
    await assert.rejects(summarizeProgress(host,{id:'missing-route'},'input',new AbortController().signal),/unavailable/);
    assert.equal(dispatched,1);
  }finally{await host.fiber.dispose();}
}
console.log(JSON.stringify({passed:true,defaultZeroModelCalls:true,optIn:true,boundedInput:true,rateLimitedAcrossSteps:true,stepChangeKeepsSummary:true,finalSummary:true,historyInput:true,
  noDuplicateRequest:true,singleInFlight:true,staleResponsesDiscarded:true,disableAndCloseCancel:true,timeoutFallback:true,
  failureNoRetryLoop:true,sessionIsolation:true,hostLlm,paidApiCalls:0,root}));

// The conversation shows each computer-use step, and one summary row per turn,
// from DSH's own tool results. DSH 0.1.7 and later send a result as
// {role:'tool', toolCallId, source:{callId}, content, isError}; DSH 0.1.5 wraps
// it in a {type:'tool-result'} block of a user message. Neither has a top-level
// callId, which the summary matched on, so every step of every turn stayed
// "working" and every summary read "Incomplete". The messages below are built
// the way each line's createToolResultMessage builds them
// (@deepseek-ai/dsh-llm lib/types/message.js). React from devDependencies; no
// desktop access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const modules={react:React,'react/jsx-runtime':require('react/jsx-runtime')};
const stub=new Proxy(function(){},{get:(_target,key)=>key==='__esModule'?true:stub,apply:()=>stub,construct:()=>({})});
let plugin;
vm.runInNewContext(readFileSync(new URL('../mcp/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(name=>modules[name]??stub);}}},console});
const definitions=[],views=new Map();
const slots={
  inject:(_name,factory)=>{const out=factory();if(out&&typeof out.next==='function')for(const _ of out);},
  register:(entry,component)=>{views.set(entry.name+':'+entry.key,component);return ()=>{};}
};
plugin.apply({effect:fn=>fn(),slots,locale:{register:()=>()=>{},bind:()=>key=>key},
  inject:(names,fn)=>{if(names.includes('uiConversation'))fn({slots,uiConversation:{events:{register:definition=>{definitions.push(definition);return ()=>{};}}}});}});
const series=definitions.find(definition=>definition.kind==='wincu-series');
assert.ok(series,'client.js registers the wincu-series Definition');
const tool=name=>'mcp__wincu__windows_computer_use_'+name;
const StepRow=views.get('tool.call.toolview:'+tool('wait')),SeriesRow=views.get('conversation.chat.node:wincu-series');
assert.ok(StepRow&&SeriesRow,'client.js registers the step and series rows');
const t=key=>key,state=html=>/class="wcu-activity-state">([^<]*)</.exec(html)?.[1];

const hosts={
  // DSH 0.1.7 – 0.2.2
  '0.2':(callId,content,isError=false)=>({role:'tool',source:{kind:'tool',callId},toolCallId:callId,content,isError,id:'m-'+callId}),
  // DSH 0.1.5 and older
  '0.1.5':(callId,content,isError=false)=>({role:'user',source:{kind:'tool',callId},content:[{type:'tool-result',toolCallId:callId,content,isError}],id:'m-'+callId})
};
const text=value=>[{type:'text',text:JSON.stringify(value)}];
const ok=text({ok:true,milliseconds:2500,verification:'observed'});
const failed=[{type:'text',text:'Error: ELEMENT_NOT_FOUND: no such element'}];
const stopped=[{type:'text',text:'Error: COMPUTER_USE_STOPPED_BY_USER: The user stopped this operation series.'}];
const replay=events=>{
  let context;
  for(const event of events){
    const match=series.match(event);if(!match)continue;
    const full={...match,event};
    context=match.role==='start'?series.start({},full):series.update({state:context},full);
  }
  // States come from the vm realm; compare them as plain JSON.
  return JSON.parse(JSON.stringify(context));
};
const turn=(make,results)=>replay([
  {seq:1,type:'turn/start',data:{turn:1}},
  ...results.flatMap(([callId,name,args,content,isError],index)=>[
    {seq:10+index*2,type:'tool/call',data:{turn:1,step:index+1,callId,name:tool(name),arguments:args}},
    {seq:11+index*2,type:'tool/result',data:{turn:1,step:index+1,message:make(callId,content,isError)}}]),
  {seq:99,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}
]);
const summary=calls=>state(renderToStaticMarkup(React.createElement(SeriesRow,{node:{data:calls},t})));

for(const [host,make] of Object.entries(hosts)){
  const done=turn(make,[['c1','wait','{"milliseconds":2500}',ok],['c2','wait',{milliseconds:2500},ok]]);
  assert.deepEqual(done.calls.map(call=>[call.id,call.status]),[['c1','completed'],['c2','completed']],host+': both results match their calls');
  assert.equal(summary(done),'completed · 2 seriesCount',host+': a turn whose steps all completed reads Completed');
  const mixed=turn(make,[['c1','wait',{},ok],['c2','click',{x:1,y:2},failed,true],['c3','type_text',{text:'x'},stopped,true]]);
  assert.deepEqual(mixed.calls.map(call=>[call.id,call.status]),[['c1','completed'],['c2','failed'],['c3','stopped']],host+': failed and stopped results');
  assert.equal(summary(mixed),'stoppedAction · 3 seriesCount',host+': a stopped step makes the turn Stopped');
  const unanswered=turn(make,[['c1','wait',{},ok]]);unanswered.calls.push({id:'lost',name:tool('click'),args:{},seq:50,status:'working'});
  assert.equal(summary(unanswered),'failedAction · 2 seriesCount',host+': a step with no result leaves the turn Incomplete');
}

// Step rows. DSH 0.2 passes phase and a node holding the result message; DSH
// 0.1.5 passes the node alone (kind, call.argsRaw, content, isError).
const step=props=>state(renderToStaticMarkup(React.createElement(StepRow,{toolName:tool('wait'),t,...props})));
assert.equal(step({phase:'result',block:{kind:'result',call:{name:tool('wait'),arguments:{milliseconds:2500}},message:hosts['0.2']('c1',ok)}}),'completed');
assert.equal(step({phase:'result',block:{kind:'result',call:{name:tool('wait'),arguments:{}},message:hosts['0.2']('c1',failed,true)}}),'failedAction');
assert.equal(step({phase:'start',block:{callId:'c1',name:tool('wait'),arguments:{}}}),'working');
assert.equal(step({block:{kind:'result',callId:'c1',call:{name:tool('wait'),argsRaw:'{"milliseconds":2500}'},content:ok,isError:false}}),'completed','0.1.5 finished step');
assert.equal(step({block:{kind:'result',callId:'c1',call:{name:tool('wait'),argsRaw:'{}'},content:stopped,isError:true}}),'stoppedAction','0.1.5 stopped step');
assert.equal(step({block:{callId:'c1',name:tool('wait'),argsRaw:'{"milliseconds":2500}'}}),'working','0.1.5 running step');
console.log('PASS series and step rows read DSH 0.2 and DSH 0.1.5 tool results: completed, failed, stopped and unanswered steps');

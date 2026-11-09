// Replay one conversation through DSH's own Conversation assembler
// (ConversationNodeAssembler of @deepseek-ai/dsh-client-ui-conversation) with
// this plugin's wincu-series Definition, once per host bundle given on the
// command line. A window that starts in the middle of a turn, an older page
// loaded with "load earlier", and a live tail must give one series per turn and
// no error (#76). The 0.5.5 Definition, which started a Context on every event,
// runs alongside as a control: DSH 0.1.5 rejects it with "more than one start Match".
//
// Usage: node test/host-conversation-replay.mjs <dsh-client-ui-conversation>/lib/client.js ...
// Each bundle runs in a vm context whose only real module is React from this
// repository's devDependencies; every other import is an inert stub.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const modules={react:require('react'),'react/jsx-runtime':require('react/jsx-runtime')};
const bundles=process.argv.slice(2);
if(!bundles.length)throw Error('Pass one or more paths to dsh-client-ui-conversation/lib/client.js');

const stub=new Proxy(function(){},{get:(_target,key)=>key==='__esModule'?true:stub,apply:()=>stub,construct:()=>({})});
function load(file){
  let exported;
  const sandbox={window:{__ModuleLoader__:{load:entry=>{exported=entry.factory(name=>modules[name]??stub);}}},
    console,setTimeout,clearTimeout,queueMicrotask,structuredClone,TextEncoder,TextDecoder,URL,AbortController,Intl};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(readFileSync(file,'utf8'),sandbox,{filename:file});
  return exported;
}

// The plugin's own Definition, taken from client.js the way DSH receives it.
const definitions=[];
const plugin=load(new URL('../mcp/client.js',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const slots={inject:()=>{},register:()=>()=>{}};
plugin.apply({effect:fn=>fn(),slots,locale:{register:()=>()=>{},bind:()=>key=>key},
  inject:(names,fn)=>{if(names.includes('uiConversation'))fn({slots,uiConversation:{events:{register:definition=>{definitions.push(definition);return ()=>{};}}}});}});
const series=definitions.find(definition=>definition.kind==='wincu-series');
assert.ok(series,'client.js must register the wincu-series Definition');
const previous={...series,match:event=>['turn/start','turn/end','tool/call','tool/result'].includes(event.type)&&Number.isInteger(event.data?.turn)?{id:String(event.data.turn),role:'start'}:null};

const tool=name=>'mcp__wincu__windows_computer_use_'+name;
const call=(seq,turn,callId,name)=>({seq,time:1000+seq,type:'tool/call',data:{turn,callId,name,arguments:{}}});
const result=(seq,turn,callId)=>({seq,time:1000+seq,type:'tool/result',data:{turn,message:{callId,content:[{type:'text',text:JSON.stringify({ok:true,verification:'observed'})}]}}});
const start=(seq,turn)=>({seq,time:1000+seq,type:'turn/start',data:{turn}});
const end=(seq,turn)=>({seq,time:1000+seq,type:'turn/end',data:{turn,reason:{kind:'completed'}}});
// Turn 1 also calls a tool of another plugin, which the series ignores.
const events=[
  start(0,1),call(1,1,'a',tool('click')),result(2,1,'a'),call(3,1,'b','read_file'),result(4,1,'b'),end(5,1),
  start(6,2),call(7,2,'c',tool('screenshot')),result(8,2,'c'),end(9,2),
  start(10,3),call(11,3,'d',tool('type_text')),result(12,3,'d'),end(13,3)
];
const record=event=>({type:'event',event});
const between=(from,to)=>events.filter(event=>event.seq>=from&&event.seq<=to).map(record);
const scenarios={
  // The loaded window starts inside turn 1; "load earlier" brings its start.
  'window starts mid-turn, then load earlier, then live tail':assembler=>{assembler.replaceWindow(between(3,9),true);assembler.prepend(between(0,2),false);for(const entry of between(10,13))assembler.append(entry);},
  'window starts at a turn, then load earlier':assembler=>{assembler.replaceWindow(between(6,13),true);assembler.prepend(between(0,5),false);},
  'whole history, then live tail':assembler=>{assembler.replaceWindow(between(0,9),false);for(const entry of between(10,13))assembler.append(entry);}
};
const run=(host,definition,scenario)=>{
  const assembler=new host.ConversationNodeAssembler({entries:()=>[definition],fallbackEntry:()=>undefined},{entries:()=>[]});
  scenario(assembler);
  // States come from the vm realm; compare them as plain JSON.
  return JSON.parse(JSON.stringify(Object.fromEntries([...assembler.contexts.values()].filter(context=>context.kind==='wincu-series').map(context=>[context.id,context.state??null]))));
};

const report=[];
for(const bundle of bundles){
  const version=JSON.parse(readFileSync(path.join(path.dirname(bundle),'..','package.json'),'utf8')).version;
  const host=load(bundle);
  assert.equal(typeof host?.ConversationNodeAssembler,'function',`${bundle} exports no ConversationNodeAssembler`);
  const entry={host:version,fixed:{},previous:{}};
  for(const [name,scenario] of Object.entries(scenarios)){
    const states=run(host,series,scenario);
    for(const [turn,callId] of [['1','a'],['2','c'],['3','d']]){
      const state=states[turn];
      assert.ok(state,`${version} ${name}: turn ${turn} has no series state`);
      assert.equal(state.ended,true,`${version} ${name}: turn ${turn} did not end`);
      assert.deepEqual(state.calls.map(item=>[item.id,item.status]),[[callId,'completed']],`${version} ${name}: turn ${turn} calls`);
    }
    entry.fixed[name]='ok';
    try{run(host,previous,scenario);entry.previous[name]='ok';}
    catch(error){entry.previous[name]='throws: '+error.message;}
  }
  report.push(entry);
}
console.log(JSON.stringify(report,null,1));

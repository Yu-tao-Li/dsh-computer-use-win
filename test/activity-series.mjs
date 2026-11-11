import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installActivity,readableAbort,ACTIVITY_IDLE_MS} from '../mcp/activity.mjs';
import {TakeoverControl} from '../mcp/takeover.mjs';
import {DEFAULT_SETTINGS} from '../mcp/settings.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-activity-series-'));
const activityFile=path.join(root,'activity.json'),configFile=path.join(root,'settings.json');
const handlers={},disposers=[];
const ctx={on:(name,fn)=>{handlers[name]=fn;},effect:fn=>disposers.push(fn()),logger:{error:error=>{throw error;}}};
installActivity(ctx,activityFile);
const session={id:'a'},agent={session,phase:{kind:'running',turn:4}};
// A coordinate click uses the real pointer, so its series shows the indicator.
const call=who=>handlers['tools/execute']({name:'mcp__wincu__windows_computer_use_click',arguments:{x:10,y:10},agent:who,signal:new AbortController().signal},async()=>true);
await call(agent);
assert.equal(JSON.parse(await readFile(activityFile,'utf8')).active,true);
// DSH's stop button aborts with {kind:'user'}; its MCP client turns that into "[object Object]".
const stopButton=new AbortController();stopButton.abort({kind:'user'});
const objectError={isError:true,content:[{type:'text',text:'Error: [object Object]'}],error:{message:'[object Object]'}};
const stoppedCall=await handlers['tools/execute']({name:'mcp__wincu__windows_computer_use_wait_for',agent,signal:stopButton.signal},async()=>objectError);
assert.match(stoppedCall.content[0].text,/^Error: COMPUTER_USE_STOPPED_IN_DSH/);assert.match(stoppedCall.error.message,/DSH stop button/);
assert.equal(readableAbort({signal:new AbortController().signal},objectError),objectError,'A call that was not aborted keeps its result');
const realError={...objectError,error:{message:'BROWSER_TIMEOUT'}};
assert.equal(readableAbort({signal:stopButton.signal},realError),realError,'A readable error stays as it is');
await assert.rejects(call({session:{id:'b'},phase:{kind:'running',turn:4}}),/COMPUTER_USE_BUSY/);
handlers['session/event'](session,{type:'turn/end',data:{turn:3}});
assert.equal(JSON.parse(await readFile(activityFile,'utf8')).active,true,'An older turn must not release the current owner');
await writeFile(configFile,JSON.stringify({...DEFAULT_SETTINGS,indicatorIdleMs:200}));
const control=new TakeoverControl({activityFile,configFile,stateFile:path.join(root,'state.json'),testMode:true});
control.disabledForTest=false;
try{
 await control.command('test_pointer_source',{x:200,y:200});
 await control.begin();await control.end();
 await new Promise(r=>setTimeout(r,900));
 assert.equal((await control.command('status')).armed,true,'Indicator must remain armed through a reasoning gap longer than the per-action hide delay');
 assert.equal(control.active,0);assert.equal(control.seriesHeld,true);
 const stopped=await control.command('test_key',{vk:0x1b,down:true});assert.equal(stopped.paused,true);
 await control.sync();assert.equal(control.paused,true,'An active host lease cannot silently resume after Esc');
 await assert.rejects(control.begin(),/COMPUTER_USE_STOPPED_BY_USER/);
 const replacement=new TakeoverControl({activityFile,configFile,stateFile:path.join(root,'state.json')});
 await assert.rejects(replacement.begin(),/COMPUTER_USE_STOPPED_BY_USER/);await replacement.close();
 await control.command('test_key',{vk:0x1b,down:false});
 handlers['session/event'](session,{type:'turn/end',data:{turn:4}});
 await control.sync();assert.equal(control.seriesHeld,false);assert.equal(control.paused,true);
 const other={session:{id:'b'},phase:{kind:'running',turn:1}};
 await call(other);await control.sync();assert.equal(control.paused,false);
 handlers['session/event'](other.session,{type:'turn/end',data:{turn:1}});await control.sync();
 await call(agent);await assert.rejects(control.begin(),/COMPUTER_USE_STOPPED_BY_USER/);
 handlers['session/event'](session,{type:'turn/end',data:{turn:4}});await control.sync();
 await call({...agent,phase:{kind:'running',turn:5}});await control.sync();
 assert.equal(control.paused,false,'The next user turn must automatically resume without settings');
 assert.equal((await control.command('status')).armed,true);
 // Model a host that stopped heartbeating before its final lease expires.
 // A live owner would correctly renew the lease while this assertion runs.
 for(const dispose of disposers.splice(0))dispose?.();
 await writeFile(activityFile,JSON.stringify({active:true,expiresAt:Date.now()-1}));await control.sync();
 const deadline=Date.now()+3000;
 let status;
 do{await new Promise(r=>setTimeout(r,50));status=await control.command('status');}while(status.armed&&Date.now()<deadline);
 assert.equal(status.armed,false,'A stale host lease must not leave a stuck indicator');
 console.log(JSON.stringify({passed:true,reasoningGapKeptVisible:true,physicalEscDuringGap:true,sameTurnCannotResume:true,nextUserTurnAutoResumes:true,stoppedScopeSurvivesWorkerReload:true,otherConversationDoesNotUnblockStoppedTurn:true,turnOwnership:true,concurrentSessionsRejected:true,expiredLeaseReleases:true,physicalInputSent:false,root}));
}finally{await control.close();for(const dispose of disposers)dispose?.();}

// A long tool stays visible; an idle completed call releases ownership even
// when its conversation continues doing unrelated work without turn/end.
assert.equal(ACTIVITY_IDLE_MS,30000);
const idleHandlers={},idleDisposers=[],idleFile=path.join(root,'idle-activity.json');
installActivity({on:(name,fn)=>{idleHandlers[name]=fn;},effect:fn=>idleDisposers.push(fn()),logger:{error:error=>{throw error;}}},idleFile,{idleMs:100});
try{
 let finish;
 const pending=idleHandlers['tools/execute']({name:'windows_computer_use_wait',agent,signal:new AbortController().signal},()=>new Promise(resolve=>{finish=resolve;}));
 await new Promise(r=>setTimeout(r,1200));
 assert.equal(JSON.parse(await readFile(idleFile,'utf8')).active,true,'An executing tool must not time out as idle');
 finish(true);await pending;
 assert.equal(JSON.parse(await readFile(idleFile,'utf8')).active,true,'Completion must start a fresh idle interval');
 const deadline=Date.now()+2500;
 while(JSON.parse(readFileSync(idleFile,'utf8')).active&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 assert.equal(JSON.parse(readFileSync(idleFile,'utf8')).active,false,'No further desktop calls must release the indicator and ownership');
 await idleHandlers['tools/execute']({name:'windows_computer_use_screenshot',agent:{session:{id:'after-idle'},phase:{kind:'running',turn:1}}},async()=>true);
 assert.equal(JSON.parse(await readFile(idleFile,'utf8')).sessionId,'after-idle','A new desktop series may start after idle release');
 console.log(JSON.stringify({idleTimeout:true,defaultIdleMs:ACTIVITY_IDLE_MS,longActionStaysActive:true,nextSeriesReacquires:true}));
}finally{for(const dispose of idleDisposers)dispose?.();}

// Browser-lane calls run in the background. They hold the series, so turns and
// a stopped series still apply, but only a desktop call turns on the indicator.
const browserHandlers={},browserDisposers=[],browserFile=path.join(root,'browser-activity.json');
installActivity({on:(name,fn)=>{browserHandlers[name]=fn;},effect:fn=>browserDisposers.push(fn()),logger:{error:error=>{throw error;}}},browserFile);
const pageCall=(turn,args,name='snapshot')=>browserHandlers['tools/execute']({name:'mcp__wincu__windows_computer_use_'+name,arguments:args,agent:{session:{id:'web'},phase:{kind:'running',turn}},signal:new AbortController().signal},async()=>true);
const browserState=async()=>JSON.parse(await readFile(browserFile,'utf8'));
const quiet=new TakeoverControl({activityFile:browserFile,configFile,stateFile:path.join(root,'browser-state.json'),testMode:true});
quiet.disabledForTest=false;
try{
 await pageCall(1,{browserTab:'t0123456789abcdef'});
 assert.deepEqual([(await browserState()).active,(await browserState()).indicator],[true,false],'A browser-lane call holds the series without the indicator');
 // A browser task usually starts by listing windows (the routing instructions
 // say so) and may wait between page steps; neither touches the desktop.
 await pageCall(1,{},'list_windows');
 await pageCall(1,JSON.stringify({milliseconds:200}),'wait');
 assert.equal((await browserState()).indicator,false,'Listing windows and waiting keep a browser series quiet');
 // Reads of the screen or UI Automation, and element actions that start in the
 // background, use neither the pointer nor the keyboard either.
 for(const [name,args] of [['screenshot',{}],['snapshot',{windowTitle:'Notepad'}],['find',{query:'OK'}],['click',{elementId:'uia:rt:42-1'}],['invoke',{elementId:'uia:rt:42-1'}],['set_value',{elementId:'uia:rt:42-1',value:'x'}]])await pageCall(1,args,name);
 assert.equal((await browserState()).indicator,false,'Reads and background element actions keep a series quiet');
 await pageCall(1,{windowTitle:'Notepad',activate:true},'snapshot');
 assert.equal((await browserState()).indicator,true,'A read that brings a window forward shows the indicator');
 browserHandlers['session/event']({id:'web'},{type:'turn/end',data:{turn:1}});
 await pageCall(1,{browserTab:'t0123456789abcdef'});
 await quiet.begin({quiet:true});
 assert.equal(quiet.seriesHeld,true);assert.equal(quiet.active,1);
 if(quiet.config.progressOverlayEnabled){
   const status=await quiet.command('status');assert.equal(status.armed,false,'The default progress overlay cannot arm Esc for browser-only work');
   assert.equal(status.progressVisible,true,'The independently enabled progress overlay can show browser progress');
   const escape=await quiet.command('test_key',{vk:0x1b,down:true});assert.equal(escape.consumed,false);assert.equal(escape.paused,false);
   await quiet.command('test_key',{vk:0x1b,down:false});
 }else assert.ok(!quiet.child,'With progress disabled, browser-only work must not start the helper');
 await quiet.end({quiet:true});
 await pageCall(1,{elementId:'t0123456789abcdef:12',text:'x'},'type_text');
 assert.equal((await browserState()).indicator,false,'A page element id is a browser-lane call too');
 await pageCall(1,JSON.stringify({x:10,y:10}),'click');
 assert.equal((await browserState()).indicator,true,'The first desktop call of the series turns the indicator on');
 await quiet.sync();
 assert.equal((await quiet.command('status')).armed,true);
 browserHandlers['session/event']({id:'web'},{type:'turn/end',data:{turn:1}});
 await pageCall(2,{browserTab:'t0123456789abcdef'});
 assert.equal((await browserState()).indicator,false,'A new turn starts without the indicator');
 await quiet.sync();
 const deadline=Date.now()+3000;
 let status;
 do{await new Promise(r=>setTimeout(r,50));status=await quiet.command('status');}while(status.armed&&Date.now()<deadline);
 assert.equal(status.armed,false,'A browser-only turn must hide the indicator left by the previous turn');
 console.log(JSON.stringify({browserSeriesQuiet:true,discoveryQuiet:true,readsAndBackgroundElementActionsQuiet:true,activateShowsIndicator:true,browserElementIdsQuiet:true,desktopCallShowsIndicator:true,nextTurnQuietAgain:true}));
}finally{await quiet.close();for(const dispose of browserDisposers)dispose?.();}

// Only the overlay reads the model's text. With the overlay off the text stays
// in memory, and after the finished state's linger time it leaves the file.
let textSettings={progressOverlayEnabled:false,progressOverlayMode:'source'};
const textHandlers={},textDisposers=[],textFile=path.join(root,'text-activity.json');
installActivity({on:(name,fn)=>{textHandlers[name]=fn;},effect:fn=>textDisposers.push(fn()),logger:{error:error=>{throw error;}}},textFile,{lingerMs:100,getSettings:()=>textSettings});
const textSession={id:'text'},textAgent=turn=>({session:textSession,phase:{kind:'running',turn}});
const modelText=(turn,reasoning,reply)=>{
 const stream=frame=>textHandlers['agent/assistant-stream']({agent:textAgent(turn),frame}),attemptId='attempt-'+turn;
 stream({type:'start',attemptId,turn,step:1});
 stream({type:'chunk',attemptId,chunk:{type:'reasoning-delta',text:reasoning}});
 stream({type:'chunk',attemptId,chunk:{type:'text-delta',text:reply}});
};
const textCall=turn=>textHandlers['tools/execute']({name:'mcp__wincu__windows_computer_use_wait',arguments:{},agent:textAgent(turn),signal:new AbortController().signal},async()=>true);
const textEnd=turn=>textHandlers['session/event'](textSession,{type:'turn/end',data:{turn,reason:{kind:'completed'}}});
const textRaw=()=>readFileSync(textFile,'utf8'),textState=()=>JSON.parse(textRaw());
try{
 modelText(1,'REASONING_BEFORE_CALL','REPLY_BEFORE_CALL');
 await textCall(1);
 assert.equal(textState().active,true);
 assert.equal(textState().progress,undefined,'With the overlay off the file holds no progress');
 modelText(1,'REASONING_DURING_TURN','REPLY_DURING_TURN');
 await textCall(1);
 assert.doesNotMatch(textRaw(),/REASONING_|REPLY_/,'With the overlay off no model text reaches the file');
 textSettings={...textSettings,progressOverlayEnabled:true};
 await textCall(1);
 assert.match(textRaw(),/REASONING_BEFORE_CALL/,'Turned on mid-turn, the overlay gets the text kept in memory');
 assert.match(textState().progress.reply,/REPLY_DURING_TURN/);
 textSettings={...textSettings,progressOverlayEnabled:false};
 await textCall(1);
 assert.doesNotMatch(textRaw(),/REASONING_|REPLY_/,'Turned off mid-turn, the next write drops the text');
 textEnd(1);
 assert.equal(textState().active,false);
 assert.doesNotMatch(textRaw(),/REASONING_|REPLY_/,'With the overlay off the finished state holds no text either');
 textSettings={...textSettings,progressOverlayEnabled:true};
 modelText(2,'REASONING_TURN_TWO','REPLY_TURN_TWO');
 await textCall(2);
 textEnd(2);
 assert.equal(textState().progress.status,'done');assert.ok(Number.isFinite(textState().lingerUntil));
 assert.match(textRaw(),/REPLY_TURN_TWO/,'The finished state stays readable while it lingers');
 const deadline=Date.now()+3000;
 while(textRaw().includes('_TURN_TWO')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 assert.equal(textState().progress,undefined,'After the linger time the file holds no progress');
 assert.equal(textState().lingerUntil,undefined);
 console.log(JSON.stringify({overlayOffKeepsTextOutOfFile:true,turnedOnShowsKeptText:true,turnedOffDropsText:true,lingerShowsFinishedState:true,lingerEndClearsText:true}));
}finally{for(const dispose of textDisposers)dispose?.();}

// An idle publisher writes nothing, so a language change reached the overlay
// preview only with the next tool call. refresh() writes it at once, and the
// takeover control (which draws the preview) takes the new language.
let idleLocale='en-US';
const localeDisposers=[],localeFile=path.join(root,'locale-activity.json');
const localeActivity=installActivity({on:()=>{},effect:fn=>localeDisposers.push(fn()),logger:{error:error=>{throw error;}}},localeFile,{getLocale:()=>idleLocale});
const localeControl=new TakeoverControl({activityFile:localeFile,stateFile:path.join(root,'locale-state.json'),testMode:true});
try{
 assert.equal(JSON.parse(readFileSync(localeFile,'utf8')).locale,'en');
 idleLocale='zh-CN';
 await new Promise(r=>setTimeout(r,1300));
 assert.equal(JSON.parse(readFileSync(localeFile,'utf8')).locale,'en','Idle, the publisher does not rewrite the file by itself');
 localeActivity.refresh();
 assert.equal(JSON.parse(readFileSync(localeFile,'utf8')).locale,'zh','refresh() writes the new language with no tool call');
 await localeControl.sync();
 assert.equal(localeControl.locale,'zh','The preview is drawn in the new language');
 console.log(JSON.stringify({idleLanguageChangeReachesPreview:true}));
}finally{await localeControl.close();for(const dispose of localeDisposers)dispose?.();}

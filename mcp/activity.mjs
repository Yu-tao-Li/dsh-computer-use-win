import {atomicJson} from './takeover.mjs';
import {isQuietCall} from './browser.mjs';
import {createProgressSummarizer} from './progress-summary.mjs';

export function isDesktopTool(name=''){
  return /^(?:mcp__wincu__)?windows_computer_use_(?!health$|tools$)[a-z_]+$/.test(name);
}

export const ACTIVITY_IDLE_MS=30000;
// After a turn ends the overlay keeps its last state this long, so the user
// can read the result without raising the DSH window.
export const PROGRESS_LINGER_MS=20000;
// Bounded history: the most recent steps, older steps keep only the tail of
// their text, the current step keeps more.
const MAX_STEPS=24,MAX_ACTIONS=6,OLD_STEP_TEXT=400,CURRENT_TEXT=1200,INTENT_TEXT=300;

const callArguments=value=>{
  if(typeof value==='string')try{return JSON.parse(value);}catch{return {};}
  return value&&typeof value==='object'?value:{};
};
const shortName=name=>String(name??'').replace(/^(?:mcp__wincu__)?windows_computer_use_/,'');
const cleanText=text=>text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const tail=(text,limit)=>text.length>limit?'…'+text.slice(-(limit-1)):text;

// Plain-language names for what a call does. They come from the tool name and
// the shape of the call (page or window, which special element, how many batch
// steps) and never from values: no typed text, URLs, selectors or coordinates.
const LABELS={snapshot:['读取页面内容','读取窗口内容'],accessibility_tree:['读取界面结构'],list_windows:['查找浏览器或窗口'],
  find:['查找页面元素','查找界面元素'],element_info:['查看元素信息'],click:['点击页面元素','点击'],double_click:['双击'],
  move:['移动鼠标'],drag:['拖动'],scroll:['滚动页面','滚动窗口'],type_text:['输入文字'],keypress:['按键'],focus:['切换焦点'],
  invoke:['操作控件'],activate_window:['切换到窗口'],wait:['等待'],ocr:['识别屏幕文字'],screenshot:['截图查看页面','截图查看屏幕'],
  wait_for:['等待页面变化','等待界面变化'],close_window:['关闭窗口'],move_window:['移动窗口'],launch_app:['打开应用或网页'],
  // DSH's own tools that often run inside a computer-use turn.
  read_image:['查看截图'],web_search:['搜索网页'],web_fetch:['读取网页']};
export function actionLabel(name,args={}){
  const tool=shortName(name);
  if(tool==='batch'){
    const steps=Array.isArray(args.steps)?args.steps:[];
    const kinds=[...new Set(steps.map(step=>actionLabel(step?.action,{...callArguments(step?.arguments),browserTab:args.browserTab})).filter(Boolean))];
    return `连续执行 ${steps.length} 个操作${kinds.length?'：'+kinds.slice(0,2).join('、')+(kinds.length>2?' 等':''):''}`;
  }
  if(tool==='set_value'){
    const id=String(args.elementId??'');
    if(/(?:^|:)new-tab$/.test(id))return '打开新标签页';
    if(/:address$/.test(id))return '打开网址';
    if(/:connect$/.test(id))return '连接浏览器';
    return '填写或选择内容';
  }
  const label=LABELS[tool];
  if(!label)return '';
  return label.length>1&&!args.browserTab?label[1]:label[0];
}

// DSH's stop button aborts a call with a plain object ({kind:'user'}), and its
// MCP client passes that object on as the error, so the agent would read
// "Error: [object Object]". Say what happened instead.
export function readableAbort(exec,result){
  if(!result?.isError||!exec.signal?.aborted||result.error?.message!=='[object Object]')return result;
  const message=exec.signal.reason?.kind==='user'
    ?'COMPUTER_USE_STOPPED_IN_DSH: The user stopped this call with the DSH stop button. Do not retry it in this turn. A new user turn, including a request to continue, can use the desktop again.'
    :'COMPUTER_USE_CANCELLED: DSH cancelled this call before it finished.';
  return {...result,content:[{type:'text',text:'Error: '+message}],error:{...result.error,message}};
}

const newProgress=(startedAt=Date.now())=>({status:'waiting',step:0,tool:'',action:'',reasoning:'',reply:'',steps:[],startedAt});
// One entry per model step: the actions it took and the text DSH showed for it.
function stepEntry(progress,step){
  let entry=progress.steps.at(-1);
  if(entry?.step===step)return entry;
  for(const old of progress.steps){old.reasoning=tail(old.reasoning,OLD_STEP_TEXT);old.reply=tail(old.reply,OLD_STEP_TEXT);}
  entry={step,actions:[],reasoning:'',reply:''};progress.steps.push(entry);
  if(progress.steps.length>MAX_STEPS)progress.steps.splice(0,progress.steps.length-MAX_STEPS);
  return entry;
}
function addAction(progress,label){
  const entry=stepEntry(progress,progress.step||1),action={label,state:'running'};
  entry.actions.push(action);if(entry.actions.length>MAX_ACTIONS)entry.actions.splice(0,entry.actions.length-MAX_ACTIONS);
  progress.action=label;return action;
}

// The host knows turn boundaries; the stdio worker only knows individual calls.
// Keep this lease outside the worker so tool-list reloads preserve the series.
export function installActivity(ctx,file,{idleMs=ACTIVITY_IDLE_MS,lingerMs=PROGRESS_LINGER_MS,getSettings=()=>({}),summaryOptions={}}={}){
  let owner,lingering,closed=false,needsPublish=true;
  // A turn's text that arrived before its first computer-use call (usually the
  // model deciding to use the browser). Kept in memory only, per running turn,
  // and shown only if that turn starts using the computer.
  const early=new Map();
  // The start of each step's reply, in memory only. While a reply streams the
  // file keeps its last characters so the overlay follows the end; when the
  // turn finishes, a final reply longer than that is shown from its start.
  const replyStarts=new WeakMap();
  const summaries=createProgressSummarizer(ctx,{...summaryOptions,getSettings,onChange:()=>{if(!closed)publish();}});
  const expireIdle=()=>{if(owner&&owner.pending===0&&Date.now()-owner.lastActive>=idleMs)owner=undefined;};
  const publish=()=>{
    needsPublish=true;expireIdle();
    if(lingering&&(owner||Date.now()>=lingering.until))lingering=undefined;
    const shown=owner??lingering?.owner;
    summaries.update(shown);
    atomicJson(file,{active:!!owner,sessionId:owner?.id??null,turn:owner?.turn??null,indicator:!!owner?.desktop,expiresAt:owner?Date.now()+5000:0,
      ...(shown?{progress:shown.progress}:{}),...(!owner&&lingering?{lingerUntil:lingering.until}:{})});
    needsPublish=false;
  };
  publish();
  const startOwner=(session,turn)=>{
    const seed=early.get(session.id);early.delete(session.id);
    const progress=newProgress(seed?.turn===turn?seed.startedAt:Date.now());
    if(seed?.turn===turn&&seed.step){
      progress.step=seed.step;const entry=stepEntry(progress,seed.step);
      entry.reasoning=progress.reasoning=seed.reasoning;entry.reply=progress.reply=seed.reply;
      if(seed.reasoning){progress.intent=seed.reasoning.slice(0,INTENT_TEXT);progress.intentStep=seed.step;}
    }
    return progress;
  };
  ctx.on('tools/execute',async(exec,next)=>{
    const session=exec.agent?.session;
    const turn=exec.agent?.phase?.kind==='running'?exec.agent.phase.turn:undefined;
    if(!isDesktopTool(exec.name)){
      // Another DSH tool inside a computer-use turn gets a line in the step
      // history when it has a plain-language name; nothing else changes.
      const label=owner&&session?.id===owner.id&&turn===owner.turn?actionLabel(exec.name,callArguments(exec.arguments)):'';
      if(!label)return next();
      const current=owner,progress=current.progress,action=addAction(progress,label);
      progress.status='acting';needsPublish=true;
      try{const result=await next();action.state=result?.isError?'error':'done';return result;}
      catch(error){action.state='error';throw error;}
      finally{current.lastActive=Date.now();if(current.pending===0&&progress.action===label){progress.status='waiting';progress.action='';}needsPublish=true;}
    }
    if(exec.signal?.aborted)return readableAbort(exec,await next());
    if(session&&turn!==undefined){
      expireIdle();
      if(owner&&owner.id!==session.id)throw Error('COMPUTER_USE_BUSY: Another conversation is using the desktop. Wait for that operation series to finish or stop it before retrying.');
      if(!owner){owner={id:session.id,session,turn,pending:0,lastActive:Date.now(),desktop:false,progress:startOwner(session,turn)};lingering=undefined;}
      const current=owner;
      if(current.turn!==turn){current.turn=turn;current.desktop=false;current.progress=startOwner(session,turn);}
      // Browser-lane calls run in the background, and listing windows or waiting
      // touches nothing: they keep the series and its turn, but only a desktop
      // call turns on the screen indicator.
      const args=callArguments(exec.arguments),tool=shortName(exec.name);
      if(!isQuietCall(tool,args))current.desktop=true;
      const action=addAction(current.progress,actionLabel(tool,args)||tool);
      current.pending++;current.progress.status='acting';current.progress.tool=tool;publish();
      try{const result=readableAbort(exec,await next());action.state=result?.isError?'error':'done';current.progress.lastAction={tool,status:result?.isError?'error':'returned'};return result;}
      catch(error){action.state='error';current.progress.lastAction={tool,status:'error'};throw error;}
      finally{current.pending--;current.lastActive=Date.now();if(current.pending===0){current.progress.status='waiting';current.progress.tool='';current.progress.action='';}if(owner===current)publish();}
    }
    return readableAbort(exec,await next());
  },{global:true});
  ctx.on('session/event',(session,event)=>{
    const turn=event.data?.turn;
    if(event.type==='turn/end'){
      early.delete(session.id);
      if(owner?.id===session.id&&owner.turn===turn){
        const kind=event.data.reason?.kind,progress=owner.progress;
        progress.status=kind==='aborted'?'stopped':kind==='error'?'failed':'done';
        progress.endedAt=Date.now();progress.tool='';progress.action='';
        const last=progress.steps.at(-1),start=last&&replyStarts.get(last);
        if(start&&start.length>CURRENT_TEXT){last.reply=start.text.slice(0,CURRENT_TEXT-1)+'…';if(progress.step===last.step)progress.reply=last.reply;}
        lingering=lingerMs>0?{owner,until:Date.now()+lingerMs}:undefined;owner=undefined;publish();
      }
      return;
    }
    const step=Number.isSafeInteger(event.data?.step)?event.data.step:undefined;
    if(event.type==='step/start')stepStarted(session.id,turn,step);
    // Older hosts recorded streamed text as assistant/chunk session events.
    const chunk=event.type==='assistant/chunk'?event.data.chunk:undefined;
    if(chunk)acceptText(session.id,turn,step,chunk);
  },{global:true});
  // DSH streams the model's output as agent/assistant-stream frames: a start
  // frame names the turn and step of one model attempt, its chunk frames carry
  // the text, and an abandoned attempt is retried from the start.
  const attempts=new Map(),retried=new Set();
  ctx.on('agent/assistant-stream',({agent,frame}={})=>{
    const sessionId=agent?.session?.id;
    if(!sessionId||!frame)return;
    if(frame.type==='start'){
      if(!Number.isSafeInteger(frame.turn))return;
      const key=JSON.stringify([sessionId,frame.turn,frame.step]);
      attempts.set(frame.attemptId,{sessionId,turn:frame.turn,step:Number.isSafeInteger(frame.step)?frame.step:undefined,key});
      while(attempts.size>32)attempts.delete(attempts.keys().next().value);
      if(retried.delete(key))clearStepText(sessionId,frame.turn,frame.step);
      stepStarted(sessionId,frame.turn,frame.step);
      return;
    }
    const attempt=attempts.get(frame.attemptId);
    if(!attempt)return;
    if(frame.type==='end'){
      attempts.delete(frame.attemptId);
      if(frame.outcome?.kind==='abandoned'){retried.add(attempt.key);while(retried.size>32)retried.delete(retried.values().next().value);}
      return;
    }
    if(frame.type==='chunk')acceptText(sessionId,attempt.turn,attempt.step,frame.chunk);
  },{global:true});
  function stepStarted(sessionId,turn,step){
    if(turn===undefined)return;
    if(owner?.id===sessionId&&owner.turn===turn){
      const progress=owner.progress;
      if(step===undefined||step===progress.step&&progress.steps.at(-1)?.step===step)return;
      progress.step=step;stepEntry(progress,step);
      progress.reasoning='';progress.reply='';progress.status='waiting';needsPublish=true;
      return;
    }
    const seed=early.get(sessionId);
    if(seed?.turn===turn&&seed.step===step)return;
    early.set(sessionId,{turn,step:step??0,reasoning:'',reply:'',startedAt:seed?.turn===turn?seed.startedAt:Date.now()});
    while(early.size>8)early.delete(early.keys().next().value);
  }
  function clearStepText(sessionId,turn,step){
    if(owner?.id===sessionId&&owner.turn===turn){
      const entry=owner.progress.steps.find(item=>item.step===step);
      if(entry){entry.reasoning='';entry.reply='';replyStarts.delete(entry);}
      if(owner.progress.step===step){owner.progress.reasoning='';owner.progress.reply='';}
      needsPublish=true;
    } else {const seed=early.get(sessionId);if(seed?.turn===turn&&seed.step===step){seed.reasoning='';seed.reply='';}}
  }
  // Only text already emitted by the host is displayed; never synthesize
  // reasoning or copy tool arguments, user prompts or another session.
  function acceptText(sessionId,turn,step,chunk){
    const field=chunk?.type==='reasoning-delta'?'reasoning':chunk?.type==='text-delta'?'reply':null;
    const text=field&&typeof chunk.text==='string'?cleanText(chunk.text):'';
    if(!text||turn===undefined)return;
    if(!owner||owner.id!==sessionId||owner.turn!==turn){
      const seed=early.get(sessionId);
      if(seed?.turn===turn&&(step===undefined||seed.step===step))seed[field]=(seed[field]+text).slice(-CURRENT_TEXT);
      return;
    }
    const progress=owner.progress;
    owner.lastActive=Date.now();
    // The turn's first reasoning usually restates the task; the summary needs it.
    if(field==='reasoning'){
      const at=step??progress.step;
      if(progress.intentStep===undefined)progress.intentStep=at;
      if(progress.intentStep===at&&(progress.intent??'').length<INTENT_TEXT)progress.intent=((progress.intent??'')+text).slice(0,INTENT_TEXT);
    }
    if(step!==undefined&&step!==progress.step){progress.step=step;progress.reasoning='';progress.reply='';}
    const entry=stepEntry(progress,progress.step||1);
    progress[field]=(progress[field]+text).slice(-CURRENT_TEXT);entry[field]=(entry[field]+text).slice(-CURRENT_TEXT);
    if(field==='reply'){
      const start=replyStarts.get(entry)??{text:'',length:0};
      if(start.text.length<CURRENT_TEXT)start.text=(start.text+text).slice(0,CURRENT_TEXT);
      start.length+=text.length;replyStarts.set(entry,start);
    }
    progress.status=field==='reasoning'?'thinking':'replying';
    needsPublish=true;
  }
  ctx.effect(()=>{
    const timer=setInterval(()=>{if((owner||needsPublish)&&!closed)try{publish();}catch(error){ctx.logger.error(error);}},1000);
    timer.unref();
    return ()=>{closed=true;clearInterval(timer);summaries.close();owner=undefined;lingering=undefined;early.clear();publish();};
  });
}

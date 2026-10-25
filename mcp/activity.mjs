import {atomicJson} from './takeover.mjs';
import {isQuietCall} from './browser.mjs';

export function isDesktopTool(name=''){
  return /^(?:mcp__wincu__)?windows_computer_use_(?!health$|tools$)[a-z_]+$/.test(name);
}

export const ACTIVITY_IDLE_MS=30000;

const callArguments=value=>{
  if(typeof value==='string')try{return JSON.parse(value);}catch{return {};}
  return value&&typeof value==='object'?value:{};
};

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

// The host knows turn boundaries; the stdio worker only knows individual calls.
// Keep this lease outside the worker so tool-list reloads preserve the series.
export function installActivity(ctx,file,{idleMs=ACTIVITY_IDLE_MS}={}){
  let owner,closed=false,needsPublish=true;
  const expireIdle=()=>{if(owner&&owner.pending===0&&Date.now()-owner.lastActive>=idleMs)owner=undefined;};
  const publish=()=>{needsPublish=true;expireIdle();atomicJson(file,{active:!!owner,sessionId:owner?.id??null,turn:owner?.turn??null,indicator:!!owner?.desktop,expiresAt:owner?Date.now()+5000:0});needsPublish=false;};
  publish();
  ctx.on('tools/execute',async(exec,next)=>{
    if(!isDesktopTool(exec.name))return next();
    if(exec.signal?.aborted)return readableAbort(exec,await next());
    const session=exec.agent?.session;
    const turn=exec.agent?.phase?.kind==='running'?exec.agent.phase.turn:undefined;
    if(session&&turn!==undefined){
      expireIdle();
      if(owner&&owner.id!==session.id)throw Error('COMPUTER_USE_BUSY: Another conversation is using the desktop. Wait for that operation series to finish or stop it before retrying.');
      const current=owner??={id:session.id,turn,pending:0,lastActive:Date.now(),desktop:false};
      if(current.turn!==turn){current.turn=turn;current.desktop=false;}
      // Browser-lane calls run in the background, and listing windows or waiting
      // touches nothing: they keep the series and its turn, but only a desktop
      // call turns on the screen indicator.
      if(!isQuietCall(exec.name.replace(/^(?:mcp__wincu__)?windows_computer_use_/,''),callArguments(exec.arguments)))current.desktop=true;
      current.pending++;publish();
      try{return readableAbort(exec,await next());}
      finally{current.pending--;current.lastActive=Date.now();if(owner===current)publish();}
    }
    return readableAbort(exec,await next());
  },{global:true});
  ctx.on('session/event',(session,event)=>{
    if(event.type==='turn/end'&&owner?.id===session.id&&owner.turn===event.data.turn){owner=undefined;publish();}
  },{global:true});
  ctx.effect(()=>{
    const timer=setInterval(()=>{if((owner||needsPublish)&&!closed)try{publish();}catch(error){ctx.logger.error(error);}},1000);
    timer.unref();
    return ()=>{closed=true;clearInterval(timer);owner=undefined;publish();};
  });
}

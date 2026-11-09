import {randomUUID} from 'node:crypto';
import {formatText,overlayStrings} from './overlay-strings.mjs';

export const SUMMARY_INTERVAL_MS=10000;
export const SUMMARY_FIRST_DELAY_MS=1500;
export const SUMMARY_TIMEOUT_MS=8000;
export const SUMMARY_MAX_TOKENS=192;
export const SUMMARY_INPUT_CHARS=2400;
const SUMMARY_HISTORY=8;
const clean=text=>String(text??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const tail=(text,limit)=>{text=clean(text).trim();return text.length>limit?'…'+text.slice(-(limit-1)):text;};
const ENDED={done:'summaryDone',stopped:'summaryStopped',failed:'summaryFailed'};
export const isEnded=progress=>Object.hasOwn(ENDED,progress?.status??'');

// The model sees the step history (plain-language action names and the text
// DSH already showed), never tool arguments, screenshots, user prompts or the
// conversation. Oldest material is dropped first to stay within the bound.
// Its labels are in the overlay's language, like the summary it asks for.
export function summaryInput(progress,limit=SUMMARY_INPUT_CHARS,locale='zh'){
  const words=overlayStrings(locale);
  const steps=Array.isArray(progress.steps)?progress.steps:[];
  const state=words[ENDED[progress.status]??'summaryRunning'];
  const intent=tail(progress.intent??'',300);
  const head=formatText(words.summaryHead,state,progress.step||1)+(intent?'\n'+formatText(words.summaryIntent,intent):'');
  const stepLine=(step,actions,said)=>(actions?formatText(words.summaryStepActions,step,actions):formatText(words.summaryStepLine,step))+(said?'\n  '+formatText(words.summarySaid,said):'');
  const lines=steps.map((entry,index)=>{
    const last=index===steps.length-1;
    const actions=(entry.actions??[]).map(action=>action.state==='error'?formatText(words.actionError,action.label):action.state==='running'?formatText(words.actionRunning,action.label):action.label).join(words.listSeparator);
    return stepLine(entry.step,actions,tail(entry.reasoning,last?500:160));
  });
  if(!steps.length&&(progress.reasoning||progress.tool))lines.push(stepLine(progress.step||1,progress.tool||'',progress.reasoning?tail(progress.reasoning,500):''));
  const reply=tail(progress.reply||steps.at(-1)?.reply||'',600);
  const foot=reply?'\n'+formatText(words.summaryReply,reply):'';
  let body=lines.join('\n');
  while(body.length+head.length+foot.length+2>limit&&lines.length>1){lines.shift();body='…\n'+lines.join('\n');}
  return `${head}\n${body}${foot}`.slice(-limit);
}
const hasMaterial=progress=>Boolean(progress.steps?.some(entry=>entry.actions?.length||entry.reasoning||entry.reply)||progress.tool||progress.reasoning||progress.reply);

// Use the exact route of this session, without tools, screenshots, user prompts
// or full conversation history. This is an optional auxiliary model request.
export async function summarizeProgress(ctx,session,input,signal,locale='zh'){
  signal.throwIfAborted();
  const llm=typeof ctx.get==='function'?ctx.get('llm'):ctx.llm;
  const route=session.requestHeader?.()?.config;
  if(!llm?.prepareCall||!route?.provider||!route?.model)throw Error('Progress summary model is unavailable');
  const call=await llm.prepareCall({provider:route.provider,model:route.model,maxTokens:SUMMARY_MAX_TOKENS},signal,(controls,model)=>{
    const effort=model.reasoning?.efforts?.[0]?.id;
    return {...controls,...(effort===undefined?{}:{reasoningEffort:effort})};
  });
  signal.throwIfAborted();
  const options={...call.config,sessionId:session.id,purpose:'computer-use-progress',signal,
    system:overlayStrings(locale).summarySystem,
    messages:[{id:randomUUID(),role:'user',source:{kind:'computer-use-progress'},content:[{type:'text',text:input}]}]};
  let text='',finish;
  for await(const chunk of call.stream(options)){
    signal.throwIfAborted();
    if(chunk.type==='text-delta')text=(text+clean(chunk.text)).slice(0,240);
    if(chunk.type==='finish')finish=chunk.reason?.kind;
  }
  signal.throwIfAborted();
  if(!text.trim()||!['stop','max-tokens'].includes(finish))throw Error('Progress summary did not produce a usable answer');
  return text.trim();
}

// Driven by the activity heartbeat, never another agent turn. One request per
// turn is in flight at a time; a new step does not cancel it, so a fast
// sequence of short steps still gets summaries. The interval bounds the paid
// calls; when the turn ends one final summary describes the result.
export function createProgressSummarizer(ctx,{getSettings=()=>({}),getLocale=()=>'zh',onChange=()=>{},
  intervalMs=SUMMARY_INTERVAL_MS,timeoutMs=SUMMARY_TIMEOUT_MS,initialDelayMs=SUMMARY_FIRST_DELAY_MS,
  now=Date.now,request=summarizeProgress}={}){
  let current,key='',firstSeen=0,lastStarted=-Infinity,lastInput='',inFlight,finalDone=false;
  const abort=()=>{if(inFlight){inFlight.controller.abort();inFlight=undefined;}};
  const clear=()=>{abort();current=undefined;key='';lastInput='';finalDone=false;lastStarted=-Infinity;};
  const update=owner=>{
    const settings=getSettings();
    if(!owner||settings.progressOverlayEnabled===false||settings.progressOverlayMode!=='summary'){
      clear();if(owner){owner.progress.displayMode='source';owner.progress.summary='';owner.progress.summaryStatus='';owner.progress.summaries=[];}return;
    }
    const nextKey=JSON.stringify([owner.id,owner.turn]);
    if(current!==owner||key!==nextKey){clear();current=owner;key=nextKey;firstSeen=now();
      Object.assign(owner.progress,{summary:'',summaryStatus:'waiting',summaries:[]});}
    const progress=owner.progress,ended=isEnded(progress);
    progress.displayMode='summary';
    if(inFlight){
      // The result of a running request would be superseded by the final one.
      if(!ended||inFlight.final)return;
      abort();
    }
    if(ended?finalDone:!hasMaterial(progress)||now()-firstSeen<initialDelayMs||now()-lastStarted<intervalMs)return;
    const locale=getLocale(),input=summaryInput(progress,SUMMARY_INPUT_CHARS,locale);
    if(!ended&&input===lastInput)return;
    const controller=new AbortController(),ticket={controller,key,owner,final:ended,step:progress.step||1};
    inFlight=ticket;lastStarted=now();lastInput=input;if(ended)finalDone=true;
    progress.summaryStatus='working';
    const expired=setTimeout(()=>controller.abort(),timeoutMs);expired.unref?.();
    const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('Progress summary cancelled')),{once:true}));
    Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return request(ctx,owner.session,input,controller.signal,locale);}),cancelled]).then(text=>{
      if(inFlight!==ticket||controller.signal.aborted)return;
      const value=clean(text).trim().slice(0,240);
      if(!value){progress.summaryStatus='unavailable';return;}
      progress.summary=value;progress.summaryStatus='ready';progress.summaryStep=ticket.step;progress.summaryFinal=ticket.final;
      const history=progress.summaries??=[];
      if(history.at(-1)?.text!==value)history.push({step:ticket.step,text:value,final:ticket.final});
      if(history.length>SUMMARY_HISTORY)history.splice(0,history.length-SUMMARY_HISTORY);
    },()=>{if(inFlight===ticket)progress.summaryStatus='unavailable';}).finally(()=>{
      clearTimeout(expired);
      if(inFlight===ticket){inFlight=undefined;try{onChange();}catch(error){ctx.logger?.warn?.('Progress summary display update failed: %s',error.message);}}
    });
  };
  return {update,close:clear};
}

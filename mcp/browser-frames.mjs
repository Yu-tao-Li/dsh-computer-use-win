// Frame-aware CDP routing. Public element ids remain tab:number; their private
// references bind renderer, frame, document and backend node independently.
import {assertBrowserUrl} from './policy.mjs';
import {readSafeValue} from './page-values.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
const fail=message=>{throw new Error('BROWSER_ELEMENT_STALE: '+message);};
const keyOf=node=>node?.frameId?`${node.frameId}@${node.document}:${node.backendNodeId}`:node;
export const sameFrameNode=(left,right)=>keyOf(left)===keyOf(right);

export class BrowserFrames {
  constructor(lane){this.lane=lane;this.objects=new Map();this.objectCounter=0;this.sessions=new Map();this.callContext=new AsyncLocalStorage();this.groupCounter=0;}
  async scope(run){
    const group={name:'wcu-call-'+(++this.groupCounter),objects:new Set()};
    return this.callContext.run(group,async()=>{
      try{return await run();}
      finally{
        const sessions=new Map();
        for(const id of group.objects){const record=this.objects.get(id);if(record){sessions.set(record.sessionId,record);this.objects.delete(id);}}
        // Result cleanup cannot replace a successfully completed action.
        await Promise.allSettled([...sessions.values()].map(record=>this.raw(record.tab,record.sessionId,'Runtime.releaseObjectGroup',{objectGroup:group.name},500)));
      }
    });
  }
  state(tab){return tab.frames??=new Map();}
  raw(tab,session,method,params={},timeout=5000){return tab.browser.cdp.send(method,params,session,timeout);}
  node(frame,backendNodeId){return {frameId:frame.id,document:frame.document,sessionId:frame.sessionId,backendNodeId};}
  key(node){return keyOf(node);}
  frame(tab,node){
    if(!node?.frameId)return null;
    const frame=this.state(tab).get(node.frameId);
    if(!frame||frame.document!==node.document||frame.sessionId!==node.sessionId)fail('The frame navigated or was removed; read it again.');
    return frame;
  }
  async refresh(tab,request){
    if(tab.refreshFrames)return tab.refreshFrames;
    const pending=this.refreshOnce(tab,request);tab.refreshFrames=pending;
    try{return await pending;}finally{if(tab.refreshFrames===pending)tab.refreshFrames=null;}
  }
  async refreshOnce(tab,request){
    const rootSession=await this.lane.session(tab),previous=this.state(tab),current=new Map();
    const {targetInfos}=await tab.browser.cdp.send('Target.getTargets');
    const remotes=new Set(targetInfos.filter(info=>info.type==='iframe').map(info=>info.targetId));
    const walk=async(tree,sessionId,rendererRoot,parentId)=>{
      if(current.size>=64)throw new Error('BROWSER_FRAME_LIMIT: This page has more than 64 frames.');
      const info=tree.frame;
      let session=sessionId,renderer=rendererRoot,frameTree=tree;
      if(info.id!==rendererRoot&&remotes.has(info.id)){
        const old=previous.get(info.id);
        session=old?.sessionId!==rootSession?old?.sessionId:undefined;
        if(!session||!this.sessions.has(session)){
          session=(await tab.browser.cdp.send('Target.attachToTarget',{targetId:info.id,flatten:true})).sessionId;
          this.sessions.set(session,{tab,frameId:info.id});
          try{
            await this.raw(tab,session,'Page.enable');await this.raw(tab,session,'DOM.enable');
            if(this.lane.enableFetch)await this.lane.enableFetch(tab,session);
            if(tab.browser.source==='agent'||tab.intercepting)await this.raw(tab,session,'Page.setInterceptFileChooserDialog',{enabled:true});
          }catch(error){
            this.sessions.delete(session);
            await tab.browser.cdp.send('Target.detachFromTarget',{sessionId:session}).catch(()=>{});
            throw error;
          }
        }
        renderer=info.id;
        frameTree=(await this.raw(tab,session,'Page.getFrameTree')).frameTree;
      }
      const value=frameTree.frame;
      if(!/^about:(?:blank|srcdoc)$/i.test(value.url??''))assertBrowserUrl(value.url||'about:blank',parentId==null?{env:this.lane.env,approvedFileUrl:tab.approvedFileUrl,grants:request?.approvalGrants,approved:request?.policyApproved===true}:{env:this.lane.env,approvedFileUrl:tab.approvedFileUrl});
      const old=previous.get(info.id);
      const frame={id:info.id,parentId:parentId??value.parentId??null,sessionId:session,rendererRoot:renderer,document:value.loaderId??info.loaderId??'',url:value.url};
      if(old?.document===frame.document&&old.sessionId===session)frame.world=old.world;
      current.set(frame.id,frame);
      const children=frameTree.childFrames??[];
      for(const child of children)await walk(child,session,renderer,frame.id);
      // Chromium omits OOPIFs from Page.getFrameTree. Only attach targets with
      // an explicit parent frame already verified inside this tab.
      for(const target of targetInfos.filter(target=>target.type==='iframe'&&target.parentFrameId===frame.id)){
        if(!current.has(target.targetId))await walk({frame:{id:target.targetId,url:target.url}},session,renderer,frame.id);
      }
    };
    const tree=(await this.raw(tab,rootSession,'Page.getFrameTree')).frameTree;
    await walk(tree,rootSession,tree.frame.id,null);
    tab.frames=current;
    for(const [sid,record]of this.sessions)if(record.tab===tab&&!current.has(record.frameId))this.sessions.delete(sid);
    for(const [objectId,record]of this.objects)if(record.tab===tab&&(!current.has(record.frameId)||current.get(record.frameId).document!==record.document))this.objects.delete(objectId);
    return [...current.values()];
  }
  onEvent(browser,message){
    const record=this.sessions.get(message.sessionId);
    if(message.method==='Target.detachedFromTarget'&&this.sessions.has(message.params?.sessionId)){
      const detached=message.params.sessionId;
      const item=this.sessions.get(detached);this.sessions.delete(detached);item.tab.frames?.delete(item.frameId);
      if(item.tab.dialog?.frameSession===detached)item.tab.dialog=null;
      this.lane.release?.(item.tab);
      return true;
    }
    if(!record||record.tab.browser!==browser)return false;
    const {tab}=record,{method,params={}}=message;
    if(method==='Fetch.requestPaused'){this.lane.onFetchPaused?.(tab,message.sessionId,params);return true;}
    if(method==='Page.frameNavigated'){
      const frame=tab.frames?.get(params.frame.id);if(frame){frame.document=params.frame.loaderId;frame.url=params.frame.url??frame.url;frame.world=undefined;}
      browser.lastActivity=Date.now();
    }
    if(method==='Page.frameDetached')tab.frames?.delete(params.frameId);
    if(method==='Page.javascriptDialogOpening'){
      tab.dialog={type:params.type,message:String(params.message??'').slice(0,300),frameSession:message.sessionId,...(params.type==='prompt'?{defaultPrompt:params.defaultPrompt??''}:{})};
      for(const resolve of tab.dialogWaiters.splice(0))resolve();
    }
    if(method==='Page.javascriptDialogClosed'){tab.dialog=null;this.lane.release?.(tab);}
    if(method==='Page.fileChooserOpened'){
      const frame=tab.frames?.get(record.frameId);
      tab.chooser={multiple:params.mode==='selectMultiple',...(frame&&params.backendNodeId?{input:this.lane.idFor(tab,this.node(frame,params.backendNodeId))}:{})};
    }
    return true;
  }
  invalidate(tab,info){
    const frame=tab.frames?.get(info.id);
    if(frame&&frame.document!==info.loaderId){frame.document=info.loaderId;frame.world=undefined;}
  }
  async validate(tab,node){await this.refresh(tab);this.frame(tab,node);}
  prepare(tab,method,params){
    const clean={...params};let frame=null;
    const group=this.callContext.getStore();
    if(group&&method==='DOM.resolveNode')clean.objectGroup=group.name;
    if(params.backendNodeId?.frameId){frame=this.frame(tab,params.backendNodeId);clean.backendNodeId=params.backendNodeId.backendNodeId;}
    const object=this.objects.get(params.objectId);
    if(object){frame=this.frame(tab,object);clean.objectId=object.raw;}
    if(params.arguments)clean.arguments=params.arguments.map(arg=>{
      const ref=this.objects.get(arg.objectId);
      if(!ref)return arg;
      this.frame(tab,ref);
      if(frame&&ref.sessionId!==frame.sessionId)fail('Elements belong to different renderer sessions.');
      return {...arg,objectId:ref.raw};
    });
    if(method==='Page.handleJavaScriptDialog'&&tab.dialog?.frameSession)return {sessionId:tab.dialog.frameSession,params:clean,frame};
    return {sessionId:frame?.sessionId??tab.sessionId,params:clean,frame};
  }
  wrap(tab,method,result,frame){
    const context=frame??tab.frames?.get(tab.mainFrameId);
    if(!context)return result;
    const object=value=>{
      if(!value?.objectId)return;
      const virtual=`wcu-object-${++this.objectCounter}`;
      this.objects.set(virtual,{...this.node(context,0),tab,raw:value.objectId});value.objectId=virtual;
      this.callContext.getStore()?.objects.add(virtual);
    };
    object(result.object);object(result.result);
    if(result.node?.backendNodeId)result.node.backendNodeId=this.node(context,result.node.backendNodeId);
    if(method==='DOM.getNodeForLocation'&&result.backendNodeId){
      const hit=tab.frames.get(result.frameId)??context;result.backendNodeId=this.node(hit,result.backendNodeId);
    }
    if(method==='Accessibility.getPartialAXTree')for(const node of result.nodes??[])if(node.backendDOMNodeId)node.backendDOMNodeId=this.node(context,node.backendDOMNodeId);
    return result;
  }
  async readAX(tab,request){
    const frames=await this.refresh(tab,request),merged=[],byFrame=new Map();
    const frameTrees=await Promise.all(frames.map(async frame=>{
      const {nodes}=await this.raw(tab,frame.sessionId,'Accessibility.getFullAXTree',{frameId:frame.id},15000);
      return [frame,nodes];
    }));
    for(const [frame,nodes] of frameTrees){
      const decorated=nodes.map(node=>({...node,nodeId:`${frame.id}|${node.nodeId}`,childIds:node.childIds?.map(id=>`${frame.id}|${id}`),...(node.backendDOMNodeId?{backendDOMNodeId:this.node(frame,node.backendDOMNodeId)}:{})}));
      byFrame.set(frame.id,decorated);merged.push(...decorated);
    }
    const children=frames.filter(frame=>frame.parentId);
    if(children.length){
      const owners=await Promise.all(children.map(async frame=>{
        const parent=tab.frames.get(frame.parentId);
        const {backendNodeId}=await this.raw(tab,parent.sessionId,'DOM.getFrameOwner',{frameId:frame.id});
        return [frame,parent,backendNodeId];
      }));
      for(const [frame,parent,backendNodeId] of owners){
        const owner=byFrame.get(parent.id)?.find(node=>node.backendDOMNodeId?.backendNodeId===backendNodeId);
        const child=byFrame.get(frame.id)?.find(node=>node.role?.value==='RootWebArea');
        if(owner&&child)owner.childIds=[...(owner.childIds??[]),child.nodeId];
      }
    }
    return {nodes:merged,frames:frames.length};
  }
  async world(tab,frame){
    if(!frame.world)frame.world=(await this.raw(tab,frame.sessionId,'Page.createIsolatedWorld',{frameId:frame.id,worldName:'wcu-frame-read'})).executionContextId;
    return frame.world;
  }
  async evaluate(tab,frame,expression,timeout=2000){
    const contextId=await this.world(tab,frame);
    return this.raw(tab,frame.sessionId,'Runtime.evaluate',{expression,contextId,returnByValue:true},timeout);
  }
  async focusedValue(tab,expression){
    const frames=await this.refresh(tab);
    let focused=frames[0];
    if(frames.length>1){
      const checks=await Promise.all(frames.map(frame=>this.evaluate(tab,frame,"document.hasFocus()&&!['IFRAME','FRAME'].includes(document.activeElement?.tagName)")));
      for(let i=0;i<frames.length;i++)if(checks[i].result?.value)focused=frames[i];
    }
    return this.evaluate(tab,focused,expression);
  }
  async textContains(tab,query){
    for(const frame of await this.refresh(tab)){
      const expression=`(()=>{const safe=${readSafeValue.toString()};const values=[document.body?.innerText||''];for(const element of document.querySelectorAll('input,textarea,select')){if(element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden')values.push(safe(element));}return values.join(' ').replace(/\\s+/g,'').toLowerCase().includes(${JSON.stringify(query)})})()`;
      if((await this.evaluate(tab,frame,expression)).result?.value)return {result:{value:true}};
    }
    return {result:{value:false}};
  }
  async rootPoint(tab,node,point,{check=true}={}){
    let frame=this.frame(tab,node);
    if(!frame||!frame.parentId)return point;
    // Quads in a renderer are relative to that renderer's root viewport.
    // Cross-process boundaries map through the iframe's content quad, which
    // also handles CSS scale/rotation. Same-process coordinates already share
    // the root viewport, but every ancestor still needs an occlusion check.
    let result={...point};const visited=new Set();
    for(;frame?.parentId;){
      if(visited.has(frame.id))fail('Invalid frame ancestry.');visited.add(frame.id);
      const parent=tab.frames.get(frame.parentId);if(!parent)fail('The parent frame was removed.');
      const {backendNodeId}=await this.raw(tab,parent.sessionId,'DOM.getFrameOwner',{frameId:frame.id});
      if(frame.sessionId!==parent.sessionId){
        if(check)await this.raw(tab,parent.sessionId,'DOM.scrollIntoViewIfNeeded',{backendNodeId}).catch(()=>{});
        const {model}=await this.raw(tab,parent.sessionId,'DOM.getBoxModel',{backendNodeId});
        const viewport=(await this.evaluate(tab,frame,'({width:innerWidth,height:innerHeight})')).result.value;
        const u=result.x/viewport.width,v=result.y/viewport.height,q=model.content;
        if(!(u>=0&&u<=1&&v>=0&&v<=1))throw new Error('BROWSER_ELEMENT_NOT_VISIBLE: The point is outside its frame viewport.');
        result={x:q[0]+u*(q[2]-q[0])+v*(q[6]-q[0]),y:q[1]+u*(q[3]-q[1])+v*(q[7]-q[1])};
      }
      if(check){
        const hit=await this.raw(tab,parent.sessionId,'DOM.getNodeForLocation',{x:Math.round(result.x),y:Math.round(result.y),includeUserAgentShadowDOM:false,ignorePointerEventsNone:false});
        let hitFrame=tab.frames.get(hit.frameId),inside=false;
        for(;hitFrame;hitFrame=tab.frames.get(hitFrame.parentId))if(hitFrame.id===frame.id){inside=true;break;}
        if(hit.backendNodeId!==backendNodeId&&!inside)throw new Error('BROWSER_ELEMENT_COVERED: A parent page covers the iframe; inspect the page before retrying.');
      }
      frame=parent;
    }
    return result;
  }
  async hit(tab,node,x,y){
    const frame=this.frame(tab,node);
    const result=await this.raw(tab,frame?.sessionId??tab.sessionId,'DOM.getNodeForLocation',{x:Math.round(x),y:Math.round(y),includeUserAgentShadowDOM:false,ignorePointerEventsNone:false});
    return this.wrap(tab,'DOM.getNodeForLocation',result,frame);
  }
  async intercept(tab,enabled){
    const sessions=new Set([tab.sessionId,...[...this.state(tab).values()].map(frame=>frame.sessionId)]);
    const results=await Promise.allSettled([...sessions].map(session=>this.raw(tab,session,'Page.setInterceptFileChooserDialog',{enabled},3000)));
    if(enabled&&results.some(result=>result.status==='rejected'))throw new Error('BROWSER_FILE_CHOOSER_GUARD: Could not suppress the native file chooser; input was not sent.');
  }
  forget(tab){
    for(const [id,record]of this.objects)if(record.tab===tab)this.objects.delete(id);
    for(const [sid,record]of this.sessions)if(record.tab===tab)this.sessions.delete(sid);
  }
}

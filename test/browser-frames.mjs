// Same-origin, cross-origin/OOPIF and nested frame actions in a real browser.
// The fixture owns every page and all input stays inside CDP.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {BrowserLane} from '../mcp/browser.mjs';
import {McpTestClient} from './mcp-test-client.mjs';
let origin,cross;
const canvasFixture=`<canvas id="canvas" width="200" height="120" style="position:absolute;left:700px;top:80px;background:#dce9f4"></canvas><p id="canvasState" style="position:absolute;left:700px;top:210px">Canvas ready</p><script>let down=false,dragged=false;canvas.onpointerdown=()=>{down=true;dragged=false};canvas.onpointermove=()=>{if(down)dragged=true};canvas.onpointerup=e=>{canvasState.textContent=dragged?'Canvas dragged':'Canvas clicked';down=false;window.lastPointerUp={x:e.clientX,y:e.clientY}};</script>`;
const server=http.createServer((req,res)=>{
  res.setHeader('content-type','text/html; charset=utf-8');
  if(req.url==='/')return res.end(`<title>Frame parent</title><style>iframe{position:absolute;width:480px;height:260px;border:8px solid #284;left:100px;top:150px}#same{top:530px}#cover{display:none;position:fixed;left:90px;top:140px;width:560px;height:300px;background:white;z-index:99}</style><button id="show" onclick="cover.style.display='block'">Cover frame</button><button onclick="cover.style.display='none'">Uncover frame</button><div id="cover">Parent obstruction</div><iframe id="remote" src="${cross}/child"></iframe><iframe id="same" src="${origin}/same"></iframe>${canvasFixture}`);
  if(req.url==='/child'||req.url==='/changed')return res.end(`<title>Cross frame</title><label>Frame input <input></label><label>Frame password <input type="password" value="frame-secret"></label><input aria-label="Frame code" autocomplete="one-time-code" value="123456"><button onclick="this.textContent='Frame clicked'">Frame click</button><iframe style="width:240px;height:120px" src="${origin}/nested"></iframe>`);
  if(req.url==='/same')return res.end('<title>Same frame</title><label>Same input <input></label><button onclick="this.textContent=\'Same clicked\'">Same click</button>');
  res.end('<title>Nested frame</title><button onclick="this.textContent=\'Nested clicked\'">Nested click</button>');
});
await new Promise(resolve=>server.listen({host:'::',port:0,ipv6Only:false},resolve));
origin=`http://127.0.0.1:${server.address().port}`;cross=`http://localhost:${server.address().port}`;
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-browser-frames-'));
const lane=new BrowserLane({env:{...process.env,WCU_BROWSER_PROFILE:root,WCU_BROWSER_HEADLESS:'1',WCU_BROWSER_SIGNIN:'0',WCU_BROWSER_APP:'edge'}});
let checks=[];
try{
  const result=await lane.run('set_value',{elementId:'new-tab',value:origin+'/'},{});
  const tab=lane.tabs.get(result.meta.opened.id);
  await writeFile(path.join(root,'initial-outline.txt'),result.text);
  const find=async query=>{
    const response=await lane.find(tab,{query,maxResults:20});
    const item=response.meta.results.find(item=>item.role!=='text')??response.meta.results[0];
    assert(item,'Missing frame element: '+query);return item.id;
  };
  assert.match(result.text,/Frame input/);assert.match(result.text,/Same input/);assert.match(result.text,/Nested click/);
  assert.equal(result.text.includes('frame-secret'),false);
  assert.equal(result.text.replaceAll(tab.key,' ').includes('123456'),false,'OTP must be absent from the outline text');
  assert.equal([...tab.frames.values()].some(frame=>frame.sessionId!==tab.sessionId),true,'The cross-site frame must use a separate CDP renderer session');checks.push('oopif-and-nested-outline');
  const input=await find('Frame input');
  const written=await lane.run('set_value',{elementId:input,value:'frame value'},{});assert.equal(written.meta.verifyValue,'frame value');
  await lane.run('focus',{elementId:input},{});
  const typed=await lane.run('type_text',{browserTab:tab.key,text:' suffix'},{});assert.equal(typed.meta.verifyValue,'frame value suffix');checks.push('cross-frame-edit-focus-type');
  const objectsBefore=lane.frames.objects.size;
  for(let i=0;i<3;i++)await lane.run('element_info',{elementId:input},{});
  assert.equal(lane.frames.objects.size,objectsBefore,'Private CDP object references must be released after each public call');
  const info=await lane.run('element_info',{elementId:await find('Frame password')},{});assert.equal(JSON.stringify(info).includes('frame-secret'),false);assert.match(info.meta.value,/redacted/);
  assert.equal((await lane.frames.textContains(tab,'frame-secret')).result.value,false);checks.push('frame-secret-redaction');
  await lane.run('click',{elementId:await find('Frame click'),button:'left'},{});
  assert.match((await lane.outline(tab)).lines.map(x=>x.text).join('\n'),/Frame clicked/);checks.push('oopif-coordinate-click');
  await lane.run('click',{elementId:await find('Nested click'),button:'left'},{});assert.match((await lane.outline(tab)).lines.map(x=>x.text).join('\n'),/Nested clicked/);checks.push('nested-coordinate-click');
  await lane.run('set_value',{elementId:await find('Same input'),value:'same value'},{});
  await lane.run('click',{elementId:await find('Same click'),button:'left'},{});assert.match((await lane.outline(tab)).lines.map(x=>x.text).join('\n'),/Same clicked/);checks.push('same-origin-edit-and-click');
  const rotated=await find('Same clicked'),rotatedNode=lane.nodeFor(tab,Number(rotated.split(':')[1]));
  await lane.call(tab,await lane.resolveElement(tab,rotatedNode),"function(){this.style.transform='rotate(90deg)';this.textContent='Rotated button';}");
  await lane.run('click',{elementId:rotated,button:'left'},{});checks.push('rotated-element-click');
  // Read a fresh target after the previous scroll; scroll the root back too.
  await lane.send(tab,'Runtime.evaluate',{expression:'scrollTo(0,0)'});
  const clicked=await find('Frame clicked');
  await lane.run('click',{elementId:await find('Cover frame'),button:'left'},{});
  await assert.rejects(lane.run('click',{elementId:clicked,button:'left'},{}),/COVERED/);checks.push('parent-overlay-rejected');
  await lane.run('click',{elementId:await find('Uncover frame'),button:'left'},{});
  // CSS scaling crosses the process boundary; the event must reach the child.
  await lane.send(tab,'Runtime.evaluate',{expression:"document.getElementById('remote').style.transform='scale(.8)';document.getElementById('remote').style.transformOrigin='top left'"});
  await lane.run('click',{elementId:clicked,button:'left'},{});checks.push('scaled-frame-coordinate-click');
  const oldInput=input;
  await lane.send(tab,'Runtime.evaluate',{expression:`document.getElementById('remote').src=${JSON.stringify(cross+'/changed')}`});await delay(500);
  await assert.rejects(lane.run('set_value',{elementId:oldInput,value:'must not write'},{}),/STALE/);checks.push('child-navigation-invalidates-id');
  const fresh=await find('Frame input');
  await lane.send(tab,'Runtime.evaluate',{expression:"document.getElementById('remote').remove()"});await delay(100);
  await assert.rejects(lane.run('set_value',{elementId:fresh,value:'must not write'},{}),/STALE/);checks.push('frame-removal-invalidates-id');
  // The public MCP path must keep frame output untrusted and use page pixels.
  const client=new McpTestClient(process.execPath,[path.resolve(import.meta.dirname,'../mcp/server.mjs')],{env:{...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_BROWSER_PROFILE:path.join(root,'mcp'),WCU_BROWSER_HEADLESS:'1',WCU_BROWSER_SIGNIN:'0',WCU_BROWSER_APP:'edge'}});
  try{
    await client.init();
    const call=async(name,args)=>{const reply=await client.call('windows_computer_use_'+name,args);assert(!reply.isError,JSON.stringify(reply));return {reply,meta:JSON.parse(reply.content[0].text)};};
    const opened=await call('set_value',{elementId:'new-tab',value:origin+'/'}),browserTab=opened.meta.opened.id;
    assert.match(JSON.stringify(opened.reply),/untrusted/i);assert.equal(JSON.stringify(opened.reply).includes('frame-secret'),false);
    const found=await call('find',{browserTab,query:'Frame input'});
    const edited=await call('set_value',{elementId:found.meta.results.find(item=>item.role==='textbox').id,value:'public frame value'});assert.equal(edited.meta.verifyValue,'public frame value');
    await call('move',{browserTab,x:800,y:100});
    assert.match(JSON.stringify((await call('click',{browserTab,x:800,y:100})).reply),/Canvas clicked/);
    assert.match(JSON.stringify((await call('drag',{browserTab,path:[{x:750,y:150},{x:850,y:150}]})).reply),/Canvas dragged/);
    const outside=await client.call('windows_computer_use_click',{browserTab,x:-1,y:10});assert.equal(outside.isError,true);checks.push('public-mcp-frame-and-viewport-input');
  }finally{client.child.stdin.end();for(let i=0;i<100&&client.child.exitCode===null;i++)await delay(50);if(client.child.exitCode===null)client.close();}
  await lane.send(tab,'Runtime.evaluate',{expression:'scrollTo(0,0)'});
  const originalInput=lane.input.bind(lane),request={};
  lane.input=async(...args)=>{const result=await originalInput(...args);if(args[1]==='Input.dispatchMouseEvent'&&args[2].type==='mouseMoved'&&args[2].buttons===1)request.cancelled=true;return result;};
  try{await assert.rejects(lane.run('drag',{browserTab:tab.key,path:[{x:750,y:150},{x:800,y:150},{x:850,y:150}]},request),/CANCELLED/);}
  finally{lane.input=originalInput;}
  assert.deepEqual((await lane.send(tab,'Runtime.evaluate',{expression:'window.lastPointerUp',returnByValue:true})).result.value,{x:800,y:150});checks.push('cancelled-page-drag-releases-at-current-point');
  await writeFile(path.join(root,'results.json'),JSON.stringify({passed:true,checks},null,2));
  console.log(JSON.stringify({passed:true,checks,physicalInputSent:false,root}));
}catch(error){
  const tab=[...lane.tabs.values()][0];
  const tree=tab?await lane.send(tab,'Page.getFrameTree').catch(()=>null):null;
  const targets=tab?await tab.browser.cdp.send('Target.getTargets').catch(()=>null):null;
  await writeFile(path.join(root,'failure.json'),JSON.stringify({error:error.stack,checks,frames:tab?[...tab.frames.values()]:[],tree,targets},null,2));
  console.error('Frame diagnostics: '+root);throw error;
}
finally{await lane.shutdown();await new Promise(resolve=>server.close(resolve));}

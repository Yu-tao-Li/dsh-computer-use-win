// Real visible Chromium, isolated profile; page input never uses desktop input.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {BrowserLane} from '../mcp/browser.mjs';
import {normalizeSettings,toolSelectionKey,browserRoutingInstructions} from '../mcp/settings.mjs';
import {bridgeConfig} from '../mcp/dsh-plugin.mjs';
assert.equal(normalizeSettings({}).browserFirst,true);
assert.equal(normalizeSettings({}).browserVisible,true);
for(const key of ['browserFirst','browserVisible']) {
 assert.throws(()=>normalizeSettings({[key]:'false'}));
 assert.notEqual(toolSelectionKey({}),toolSelectionKey({[key]:false}));
}
assert.equal(bridgeConfig({}).env.WCU_BROWSER_HEADLESS,'0');
assert.equal(bridgeConfig({browserVisible:false}).env.WCU_BROWSER_HEADLESS,'1');
// The browser follows the Windows default, and sign-ins are off until the user turns them on.
assert.equal(normalizeSettings({}).browserApp,'default');
assert.equal(normalizeSettings({}).browserSignIn,false);
assert.throws(()=>normalizeSettings({browserApp:'firefox'}));
assert.throws(()=>normalizeSettings({browserSignIn:'true'}));
assert.notEqual(toolSelectionKey({}),toolSelectionKey({browserApp:'edge'}));
assert.notEqual(toolSelectionKey({}),toolSelectionKey({browserSignIn:true}));
assert.deepEqual([bridgeConfig({}).env.WCU_BROWSER_APP,bridgeConfig({}).env.WCU_BROWSER_SIGNIN],['default','0']);
assert.deepEqual([bridgeConfig({browserApp:'chrome',browserSignIn:true}).env.WCU_BROWSER_APP,bridgeConfig({browserApp:'chrome',browserSignIn:true}).env.WCU_BROWSER_SIGNIN],['chrome','1']);
assert.match(browserRoutingInstructions({}),/isolated DSH browser without the user's sign-ins/);
assert.match(browserRoutingInstructions({browserSignIn:true}),/DSH browser, whose profile is kept.*never type passwords.*sign in once in the DSH browser window.*ask the user unless/);
assert.doesNotMatch(browserRoutingInstructions({browserSignIn:true}),/user's own browser|Show the browser window/);
assert.match(browserRoutingInstructions({browserSignIn:true,browserVisible:false}),/window is hidden now.*Show the browser window/);
assert.match(browserRoutingInstructions({toolPreset:'lite'}),/new browser tab is unavailable/);
assert.doesNotMatch(browserRoutingInstructions({browserFirst:false}),/Browser-first policy/);
// The page records every mutation whose target is DSH's status element: the
// pointer must move without any the page can observe.
const page=url=>'<!doctype html><title>DSH 可见浏览器回归</title>'+(url.startsWith('/icon')?'<link rel="icon" href="/own.svg">':'')+
 '<label>名字<input></label><button style="padding:18px 36px;outline:none" onclick="document.title=document.querySelector(\'input\').value">确认</button><button onclick="alert(\'测试弹窗\')">弹窗</button>'+
 '<label>城市<select onchange="document.title=\'选了\'+this.value"><option value="bj">北京</option><option value="sh">上海</option><option value="sz" disabled>深圳</option></select></label><h1>'+url+'</h1>'+
 '<script>window.__seen=[];new MutationObserver(l=>{for(const m of l)if(m.target.nodeType===1&&m.target.hasAttribute("data-dsh-browser-status"))__seen.push(m.type+":"+m.attributeName)}).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true})</script>';
const server=http.createServer((q,r)=>{if(q.url==='/own.svg'){r.setHeader('content-type','image/svg+xml');r.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#e8590c"/></svg>');return;}r.setHeader('content-type','text/html;charset=utf-8');r.end(page(q.url))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wcu-visible-'));
const lane=new BrowserLane({env:{...process.env,WCU_BROWSER_HEADLESS:'0',WCU_BROWSER_PROFILE:root,WCU_TEST_WINDOW_X:'3500'}});
const site='http://127.0.0.1:'+server.address().port,checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name)};
const id=(text,label)=>{const line=text.split('\n').find(l=>l.includes(label));assert.ok(line,text);return /\[(t\w+:\d+)\]/.exec(line)[1]};
const isolated=async(tab,expression)=>{const {executionContextId}=await tab.browser.cdp.send('Page.createIsolatedWorld',{frameId:tab.mainFrameId,worldName:'DSH browser status'},tab.sessionId);return (await tab.browser.cdp.send('Runtime.evaluate',{contextId:executionContextId,expression,returnByValue:true},tab.sessionId)).result.value};
const state=tab=>isolated(tab,"(()=>{const h=document.querySelector('[data-dsh-browser-status]');return h&&{...globalThis.__dshIndicator(),events:getComputedStyle(h).pointerEvents,aria:h.getAttribute('aria-hidden'),shadow:h.shadowRoot===null,icon:document.querySelector('link[rel~=\"icon\"]')?.getAttribute('href')??null}})()");
const main=async(tab,expression)=>(await lane.send(tab,'Runtime.evaluate',{expression,returnByValue:true})).result.value;
// Whether DSH's pointer blue (#4176e6) fills the area below a CSS point of a
// PNG taken at the given ratio; text fringes of ClearType are bluish too, so
// several close matches are required.
function blueAt(base64,x,y,ratio){
 const png=Buffer.from(base64,'base64'),w=png.readUInt32BE(16),h=png.readUInt32BE(20),bpp=png[25]===6?4:3,parts=[];
 for(let o=8;o<png.length;){const n=png.readUInt32BE(o);if(png.toString('latin1',o+4,o+8)==='IDAT')parts.push(png.subarray(o+8,o+8+n));o+=12+n;}
 const raw=zlib.inflateSync(Buffer.concat(parts)),stride=w*bpp+1,rows=[];let prev=Buffer.alloc(w*bpp);
 for(let r=0;r<h;r++){const f=raw[r*stride],line=Buffer.from(raw.subarray(r*stride+1,(r+1)*stride));
  for(let i=0;i<line.length;i++){const a=i>=bpp?line[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0,p=a+b-c;
   line[i]=(line[i]+(f===1?a:f===2?b:f===3?(a+b)>>1:f===4?(Math.abs(p-a)<=Math.abs(p-b)&&Math.abs(p-a)<=Math.abs(p-c)?a:Math.abs(p-b)<=Math.abs(p-c)?b:c):0))&255;}
  rows.push(prev=line);}
 let matches=0;
 for(let dy=4;dy<=14;dy+=2)for(let dx=1;dx<=7;dx+=2){const px=Math.round((x+dx)*ratio),py=Math.round((y+dy)*ratio);if(px>=w||py>=h)continue;const [R,G,B]=rows[py].subarray(px*bpp,px*bpp+3);if(Math.abs(R-65)<30&&Math.abs(G-118)<30&&Math.abs(B-230)<30)matches++;}
 return matches>=4;
}
try {
 const first=await lane.run('set_value',{elementId:'new-tab',value:site},{}),tab=lane.tabs.get(first.meta.opened.id);
 check('visible default browser',!tab.browser.headless);
 check('window tinted DSH blue',lane.agentChild.spawnargs.includes('--install-autogenerated-theme=65,118,230'));
 const window=await tab.browser.cdp.send('Browser.getWindowForTarget',{targetId:tab.targetId});
 check('normal window on third monitor',window.bounds.windowState==='normal'&&window.bounds.left>=3413);
 let s=await state(tab);
 check('working tab shows the icon badge',s.state==='working'&&s.badge&&s.icon?.startsWith('data:image/svg+xml'));
 check('status layer is noninteractive and hidden from AX',s.events==='none'&&s.aria==='true'&&s.shadow===true);
 const hostNode=(await lane.send(tab,'DOM.describeNode',{objectId:(await lane.send(tab,'Runtime.evaluate',{expression:"document.querySelector('[data-dsh-browser-status]')"})).result.objectId})).node.backendNodeId;
 const ax=(await lane.send(tab,'Accessibility.getFullAXTree',{})).nodes.filter(node=>node.backendDOMNodeId===hostNode);
 check('the status layer is not in the accessibility tree',ax.every(node=>node.ignored));
 check('page JS cannot access isolated controller',await main(tab,'typeof globalThis.__dshStatus')==='undefined');
 await delay(2900);s=await state(tab);
 check('badge goes after the linger',s.state==='idle'&&!s.badge&&s.icon===null&&!s.pointer);
 await lane.run('set_value',{elementId:id(first.text,'名字'),value:'中文可见测试'},{});
 const confirm=id(first.text,'确认');
 await lane.run('click',{elementId:confirm},{});
 check('typed and clicked',await main(tab,'document.title')==='中文可见测试');
 s=await state(tab);
 const box=await main(tab,"(()=>{const r=[...document.querySelectorAll('button')].find(b=>b.textContent==='确认').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()");
 check('pointer marks the click',s.pointer&&Math.abs(s.x-box[0])<2&&Math.abs(s.y-box[1])<2);
 const ratio=await main(tab,'devicePixelRatio');
 const direct=(await lane.send(tab,'Page.captureScreenshot',{format:'png'})).data;
 check('pointer is drawn on the page',blueAt(direct,s.x,s.y,ratio));
 const shot=await lane.run('screenshot',{browserTab:tab.key,maxWidth:4000},{});
 check('screenshots leave the pointer out',!blueAt(shot.screenshot.base64,s.x,s.y,ratio)&&!(await state(tab)).capture);
 check('page observers never see the indicator',(await main(tab,'__seen.join(",")'))==='');
 const pendingRequest={};
 const waiting=lane.run('wait_for',{browserTab:tab.key,query:'never-present',condition:'text',appear:true,timeoutMs:4000,intervalMs:100},pendingRequest).catch(e=>e);
 await delay(300);check('working while a call runs',(await state(tab)).state==='working');
 pendingRequest.cancelled=true;await waiting;await delay(100);
 check('a stopped call takes the badge off at once',(await state(tab)).state==='idle');
 const city=id(first.text,'option "上海"');
 const chose=await lane.run('click',{elementId:city},{});
 check('clicking a drop-down option chooses it',chose.meta.chose==='上海'&&await main(tab,'document.title')==='选了sh'&&await main(tab,'document.querySelector("select").value')==='sh');
 await assert.rejects(lane.run('click',{elementId:id(first.text,'option "深圳"')},{}),/BROWSER_OPTION_DISABLED/);
 checks.push('a disabled option is refused');
 lane.seriesActive=()=>true;
 await lane.run('set_value',{elementId:tab.key+':address',value:site+'/icon'},{});
 s=await state(tab);
 check('a new document gets the badge in place of its own icon',s.state==='working'&&s.icon?.startsWith('data:image/svg+xml'));
 await delay(3300);
 check('the badge stays while DSH holds the series',(await state(tab)).state==='working');
 lane.seriesActive=()=>false;await delay(1400);s=await state(tab);
 check('the page gets its own icon back',s.state==='idle'&&s.icon==='/own.svg');
 const opened=await lane.run('tree',{browserTab:tab.key},{});
 await lane.run('click',{elementId:id(opened.text,'弹窗')},{});
 check('dialog detected',!!tab.dialog);
 await lane.run('keypress',{browserTab:tab.key,keys:['ENTER']},{});
 check('indicator back after the dialog',!tab.dialog&&(await state(tab)).state==='working');
 await delay(2900);
 const second=await lane.run('set_value',{elementId:'new-tab',value:site+'/second'},{});
 const secondTab=lane.tabs.get(second.meta.opened.id);
 check('only the tab in use shows the badge',(await state(secondTab)).state==='working'&&(await state(tab)).state==='idle');
 // The second tab opened in the background: it does not paint, and a single
 // capture there never answered before.
 await main(secondTab,"document.body.style.background='rgb(0,140,0)'");
 let started=Date.now();
 const background=await lane.run('screenshot',{browserTab:secondTab.key,maxWidth:1000},{});
 check('background tab screenshot',!!background.screenshot&&Date.now()-started<12000);
 // X-19: a minimized window paints nothing new; the capture still answers and
 // the window stays minimized.
 await lane.run('set_value',{elementId:secondTab.key+':address',value:site+'/minimized'},{});
 const {windowId}=await tab.browser.cdp.send('Browser.getWindowForTarget',{targetId:secondTab.targetId});
 await tab.browser.cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
 await delay(1200);
 await main(secondTab,"document.body.style.background='rgb(200,0,0)'");
 started=Date.now();
 const minimized=await lane.run('screenshot',{browserTab:secondTab.key,maxWidth:1000},{});
 const after=(await tab.browser.cdp.send('Browser.getWindowForTarget',{targetId:secondTab.targetId})).bounds.windowState;
 check('minimized window screenshot answers and the window stays minimized',!!minimized.screenshot&&Date.now()-started<12000&&after==='minimized');
 console.log(JSON.stringify({passed:true,checks,profile:root,window,minimizedCaptureMs:Date.now()-started},null,2));
} finally {lane.close();server.close()}

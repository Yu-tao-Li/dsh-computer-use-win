const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData',path.join(process.env.WCU_SETTINGS_TEST_ROOT,'user-data'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:940,height:1280,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,offscreen:true,backgroundThrottling:false}});
  let paintedImage,paintCount=0;win.webContents.on('paint',(_e,_d,image)=>{paintedImage=image;paintCount++});
  const evaluate=code=>win.webContents.executeJavaScript(code);
  // The saved pictures are for people, not assertions: an offscreen capture can
  // fail with UnknownVizError now and then, which must not fail the suite.
  const savePicture=async name=>{await new Promise(r=>setTimeout(r,200));const before=paintCount;win.webContents.invalidate();const deadline=Date.now()+3000;while(paintCount<=before&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));for(let attempt=1;;attempt++){try{fs.writeFileSync(path.join(process.env.WCU_SETTINGS_TEST_ROOT,name),(await win.webContents.capturePage()).toPNG());return;}catch(error){if(attempt===3){console.error('capturePage failed for '+name+': '+error.message);return;}await new Promise(r=>setTimeout(r,200));}}};
  // A save waits for the host's reconnect; 7 s timed out once while other suites ran.
  const until=async code=>{const end=Date.now()+15000;const settled='!!(('+code+') && (!window.snapshot?.writable || document.querySelector("[data-recording=true]") || !document.getElementById("wincu-page-remoteIndicatorVisible")?.disabled))';while(!await evaluate(settled)){if(Date.now()>end)throw Error('Settings condition timed out: '+code);await new Promise(r=>setTimeout(r,20))}};
  await win.loadURL('data:text/html,<html><meta charset="utf-8"><body style="font-family:Arial;padding:24px;background:white;color:%23203040"><div id="app"></div></body></html>');
  await evaluate(
    'const nativeRequire=window.require;'+
    'const React=nativeRequire('+JSON.stringify(process.env.WCU_REACT_ENTRY)+');'+
    'const ReactDOM=nativeRequire('+JSON.stringify(process.env.WCU_REACT_DOM_ENTRY)+');'+
    "window.require=undefined;"+
    "window.__ModuleLoader__={load:entry=>{window.clientModule=entry.factory(name=>name==='react'?React:nativeRequire(name))}};void 0;"
  );
  await evaluate(fs.readFileSync(path.join(__dirname,'../mcp/client.js'),'utf8'));
  // Plugin updates: a fake fetch stands for DSH's plugin market (its public
  // update API v1) and for npm. The startup check runs at once here, against a
  // market that reports this version as the latest.
  await evaluate(
    "{const store=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}});}"+
    "window.__wcuUpdateDelayMs=0;window.fetchCalls=[];window.fakeFetch=null;"+
    "window.fetch=async(url,init={})=>{const call={url:String(url),method:init.method||'GET',headers:init.headers||{},body:init.body?JSON.parse(init.body):undefined};window.fetchCalls.push(call);if(!window.fakeFetch)throw new TypeError('offline');const r=await window.fakeFetch(call);return {status:r.status,ok:r.status>=200&&r.status<300,json:async()=>r.body};};"+
    "window.bump=v=>v.replace(/(\\d+)$/,n=>String(+n+1));"+
    "window.fakeMarket=o=>{let n=0;const schema='dsh-market/update-api/v1';const fake=call=>{const u=call.url;"+
      "if(u==='/dsh-computer-use-win/api/update-ready'&&call.method==='POST'){o.readyCalls=(o.readyCalls||0)+1;o.readyHeader=call.headers['x-wcu-request'];return o.ready===undefined?{status:404,body:null}:{status:200,body:o.ready==='locked'?{ok:true,checked:true,ready:false,code:'EPERM'}:{ok:true,checked:true,ready:true}};}"+
      "if(u==='/dsh-market/cancel'&&call.method==='POST'){o.cancels=(o.cancels||0)+1;const s=(o.cancelStatus||[]).shift()??200;if(s===200)o.cancelled=true;return {status:s,body:s===200?{ok:true,cancelled:true}:{error:'no operation is running'}};}"+
      "if(u.startsWith('/dsh-market/api/v1/updates?name=dsh-computer-use-win')&&o.removed)return {status:404,body:{schema,error:'plugin is not installed'}};"+
      "if(u==='/dsh-market/api/v1/capabilities')return o.absent?{status:404,body:null}:{status:200,body:{schema,apiVersion:1,runtime:o.runtime||'desktop',features:{check:true,update:true,progress:true,rollback:true,restart:!!o.restart,updatesSummary:true},restart:{supported:!!o.restart,managedBy:o.restart?'market':'desktop-host'},endpoints:{updates:'/dsh-market/api/v1/updates',updatesSummary:'/dsh-market/api/v1/updates/summary',operations:'/dsh-market/api/v1/operations',rollback:'/dsh-market/api/v1/rollback',restart:'/dsh-market/api/v1/restart'}}};"+
      "if(u.startsWith('/dsh-market/api/v1/updates?name=dsh-computer-use-win'))return {status:200,body:{schema,package:{name:'dsh-computer-use-win',source:o.source||'npm',installedVersion:o.installed,latestVersion:u.includes('force=1')?o.freshLatest??o.latest:o.latest,updateAvailable:!!o.available,channelSwitch:null}}};"+
      "if(u==='/dsh-market/api/v1/updates'&&call.method==='POST'){if(o.busy)return {status:409,body:{schema,error:'busy',failure:{code:'OPERATION_BUSY',message:'busy',retryable:true}}};n++;return {status:202,body:{schema,operation:{schema,operationId:'boot-update-'+n,state:'running',progress:{percent:0}}}};}"+
      "if(u.startsWith('/dsh-market/api/v1/operations?operationId=boot-update-')){if(o.lost)return {status:404,body:null};const next=o.cancelled?{state:'cancelled'}:o.operations.shift()||{state:'running'};if(next.state==='failed'&&o.removeOnFailure)o.removed=true;return {status:200,body:{schema,operation:{schema,operationId:decodeURIComponent(u.split('=')[1]),kind:'update',packageName:'dsh-computer-use-win',beforeVersion:o.installed,installedVersion:o.installed,progress:{percent:null},outcome:{refreshRequired:false,restartRequired:true},failure:null,...next}}};}"+
      "if(u==='/dsh-market/api/v1/restart'&&call.method==='POST')return {status:200,body:{ok:true}};"+
      "if(u==='/dsh-computer-use-win/api/restart')return call.method==='GET'?{status:200,body:{supported:!!o.pluginRestart}}:o.pluginRestart?{status:200,body:{ok:true}}:{status:409,body:{ok:false,error:'WCU_RESTART_UNSUPPORTED'}};"+
      "if(u==='https://registry.npmjs.org/dsh-computer-use-win/latest'&&o.npmDown)throw new TypeError('npm unreachable');"+
      "if(u==='https://mirrors.cloud.tencent.com/npm/dsh-computer-use-win/latest'&&o.mirror)return {status:200,body:{name:'dsh-computer-use-win',version:o.mirror}};"+
      "if(u==='https://registry.npmjs.org/dsh-computer-use-win/latest'){const npm=o.npm===undefined?o.latest:o.npm;return npm?{status:200,body:{name:'dsh-computer-use-win',version:npm}}:{status:404,body:{error:'Not found'}};}"+
      "return {status:404,body:null};};fake.o=o;return fake;};"+
    "window.V="+JSON.stringify(require('../package.json').version)+";window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.V,available:false});"+
    // A settings nav button like DSH's, so the update dot can be checked.
    "document.body.insertAdjacentHTML('beforeend','<div id=\"fake-nav\"><button class=\"x_navCell_1\"><svg></svg><span>电脑操控</span></button></div>');void 0;"
  );
  await evaluate("window.nativeRecording=false;window.failNativeRecording=false;window.recordingCalls=[];window.hostEsc=0;window.dshDesktop={shortcuts:{recording:async active=>{window.recordingCalls.push(active);if(active&&window.failNativeRecording)throw Error('fixture native recording failure');window.nativeRecording=active}}};void 0");
  await evaluate(
    "window.writes=[];window.listeners=new Set();window.snapshot={value:{mode:'lite',indicatorEnabled:true,indicatorText:'DSH 正在控制电脑',indicatorPosition:'top',indicatorIdleMs:800,stopShortcut:''},revision:1,writable:true};window.failSave=false;window.entries=[];"+
    "window.scope={getSnapshot:()=>window.snapshot,subscribe:fn=>{window.listeners.add(fn);return ()=>window.listeners.delete(fn)},load:async()=>{},set:async(field,value)=>{window.writes.push({field,value});window.snapshot={...window.snapshot,value:{...window.snapshot.value,[field]:value}};for(const fn of window.listeners)fn()}};"+
    "window.definitions=[];window.ctx={effect:fn=>fn(),uiConversation:{events:{register:def=>window.definitions.push(def)}},locale:{register:(_ns,dict)=>{window.dictionary=dict;return ()=>{}},bind:()=>key=>window.dictionary.zh[key]},settingsScope:{bind:options=>{window.namespace=options.namespace;return window.scope}},slots:{inject:(_name,fn)=>{const result=fn();if(result&&typeof result.next==='function')for(const item of result){};return result},register:(entry,card)=>{window.entries.push({entry,card});return ()=>{}}},"+
    "connection:{api:{settings:{mutate:async request=>{if(window.failSave){window.failSave=false;return {result:{ok:false,message:'fixture rejected save'}}}if(request.expectedRevision!==window.snapshot.revision)throw Error('revision conflict');window.writes.push(request.ops);const value={...window.snapshot.value};for(const op of request.ops)value[op.path[0]]=JSON.parse(JSON.stringify(op.value));window.snapshot={...window.snapshot,value,revision:window.snapshot.revision+1};for(const fn of window.listeners)fn();return {result:{ok:true}}}}}}};"+
    "window.apiMode="+JSON.stringify(process.env.WCU_SETTINGS_TEST_API||'modern')+";window.remoteMutations=0;window.acceptedViews=0;window.ctx.configForms={get:ns=>{window.namespace=ns;return window.scope},describe:()=>({acceptView:view=>{window.acceptedViews++;if(view.ns!==window.namespace)throw Error('wrong namespace');window.snapshot=view.snapshot;for(const fn of window.listeners)fn()},load:async()=>{}})};window.ctx.remote={settings:{mutate:async(ns,ops,revision)=>{window.remoteMutations++;if(ns!==window.namespace)throw Error('wrong remote namespace');const r=await window.ctx.connection.api.settings.mutate({ops,expectedRevision:revision});return r.result.ok?{ok:true,value:{ns,snapshot:window.snapshot}}:{ok:false,error:{message:r.result.message}}}}};if(window.apiMode==='modern')window.scope.mutate=async(ops,revision)=>{const r=await window.ctx.connection.api.settings.mutate({ops,expectedRevision:revision});return r.result.ok};window.ctx.inject=(names,fn)=>{if(names.includes('uiConversation')||(window.apiMode==='modern'&&names.includes('remote.settings'))||(window.apiMode==='modern'&&names.includes('configForms'))||(window.apiMode==='legacy'&&names.includes('settingsScope')))fn(window.ctx)};window.clientModule.apply(window.ctx);window.page=window.entries.find(x=>x.entry.name==='settings.section');"+
    "window.root=ReactDOM.createRoot(document.getElementById('app'));"+
    "window.renderPage=lang=>window.root.render(React.createElement(window.page.card,{...window.page.entry.inject(),t:key=>window.dictionary[lang][key]}));"+
    "window.renderPage('zh');"+
    "window.chooseTool=name=>document.getElementById('wincu-page-tool-'+name).click();window.choosePosition=value=>document.getElementById('wincu-page-indicatorPosition-'+value).click();"+
    "window.clickButton=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text).click();void 0;"
  );
  await until("!!document.getElementById('wincu-page-tool-screenshot')");
  // The check ran at start, without asking the market to skip its short cache,
  // and found this version current: the button offers a check by hand.
  await until("window.fetchCalls.some(c=>c.url.startsWith('/dsh-market/api/v1/updates?name=dsh-computer-use-win'))&&window.__wcuUpdateTest.state().phase==='latest'");
  assert.equal(await evaluate("(b=>b&&b.textContent+'|'+b.title)(document.querySelector('[data-wincu-update-check]'))"),'检查更新|当前版本 v'+await evaluate('window.V'),'Without an update the one button checks for one; its tooltip names this version');
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-now]')"),false);
  assert.equal(await evaluate("document.querySelector('.wcu-title-row h2').textContent"),'电脑操控','The title is the name alone');
  assert.equal(await evaluate("document.querySelector('.wcu-section').getAttribute('aria-labelledby')"),'wincu-page-tools-title','Tools come first');
  assert.equal(await evaluate("window.fetchCalls.find(c=>c.url.startsWith('/dsh-market/api/v1/updates')).url.includes('force=1')"),false,'Automatic checks use the market cache');
  assert.equal(await evaluate("window.fetchCalls[0].url"),'/dsh-market/api/v1/capabilities','Discovery comes first');
  assert.equal(await evaluate("document.querySelector('#fake-nav button').hasAttribute('data-wincu-nav')&&!document.querySelector('#fake-nav button').hasAttribute('data-wincu-update')"),true,'No dot without an update');
  assert.equal(await evaluate("document.getElementById('wincu-page-progressOverlayEnabled').checked"),true,'Overlay is on by default');
  assert.ok(await evaluate("!!document.querySelector('[data-wincu-open-progress]')"));
  assert.equal(await evaluate("document.querySelector('[data-wincu-progress-details]').open"),false,'Detailed overlay settings must start collapsed');
  // Enable/open must work immediately while unrelated settings remain unsaved.
  await evaluate("document.getElementById('wincu-page-browserVisible').click()");
  await evaluate("document.getElementById('wincu-page-progressOverlayEnabled').click()");
  await until("window.snapshot.value.progressOverlayEnabled===false");
  assert.notEqual(await evaluate("window.snapshot.value.browserVisible"),false,'Do not auto-save the browser draft');
  assert.equal(await evaluate("document.querySelector('[data-wincu-open-progress]').disabled"),false);
  await evaluate("document.querySelector('[data-wincu-open-progress]').click()");
  await until("window.snapshot.value.progressPreviewToken>0&&window.snapshot.value.progressOverlayEnabled===true");
  assert.equal(await evaluate("document.getElementById('wincu-page-browserVisible').checked"),false,'Keep the unrelated draft visible');
  assert.notEqual(await evaluate("window.snapshot.value.browserVisible"),false,'Opening applies overlay fields only');
  assert.match(await evaluate("document.querySelector('.wcu-status').textContent"),/未保存/,'A section save must still show unrelated unsaved changes');
  await evaluate("window.clickButton('放弃更改')");
  await evaluate("document.getElementById('wincu-page-progressOverlayEnabled').click()");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.progressOverlayEnabled===false");
  await evaluate("document.getElementById('wincu-page-progressOverlayEnabled').click()");
  // The overlay switches save at once and the form waits for that save; act after it settles.
  await until("window.snapshot.value.progressOverlayEnabled===true");
  await evaluate("document.getElementById('wincu-page-browserAttachUser').click()");
  await until("!!document.querySelector('[data-wincu-attach-notice]')");
  assert.ok(await evaluate("document.querySelector('[data-wincu-attach-notice]').textContent.includes('允许远程调试')"));
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.progressOverlayEnabled===true&&window.snapshot.value.browserAttachUser===true");
  // One click per tick, as a person clicks: the next switch reads the rendered draft.
  await evaluate("document.getElementById('wincu-page-browserAttachUser').click()");
  await until("!document.getElementById('wincu-page-browserAttachUser').checked");
  await evaluate("document.getElementById('wincu-page-progressOverlayLocked').click()");
  await until("window.snapshot.value.progressOverlayLocked===false");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.browserAttachUser===false&&window.snapshot.value.progressOverlayLocked===false");
  await evaluate("document.getElementById('wincu-page-progressOverlayLocked').click()");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.progressOverlayLocked===true");
  await evaluate("document.querySelector('[data-wincu-progress-details]>summary').click()");
  await until("document.querySelector('[data-wincu-progress-details]').open");
  assert.equal(await evaluate("document.getElementById('wincu-page-progressOverlayMode').value"),'source');
  assert.ok(await evaluate("document.getElementById('wincu-page-progressOverlayMode').textContent.includes('多耗 token')"));
  await evaluate("window.setOverlayMode=value=>{const element=document.getElementById('wincu-page-progressOverlayMode');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('change',{bubbles:true}))};window.setOverlayMode('summary');window.clickButton('保存更改')");
  await until("window.snapshot.value.progressOverlayMode==='summary'");
  await evaluate("window.setOverlayMode('source');window.clickButton('保存更改')");
  await until("window.snapshot.value.progressOverlayMode==='source'");
  await evaluate("window.setOverlayInput=(key,value)=>{const element=document.getElementById('wincu-page-'+key);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(value));element.dispatchEvent(new Event('input',{bubbles:true}))};window.setOverlayInput('progressOverlayOpacity',65);window.setOverlayInput('progressOverlayWidth',570);window.setOverlayInput('progressOverlayHeight',410);window.setOverlayInput('progressLockShortcut','Ctrl+Alt+P')");
  await evaluate("const element=document.getElementById('wincu-page-progressOverlayPosition');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,'custom');element.dispatchEvent(new Event('change',{bubbles:true}))");
  await until("!document.getElementById('wincu-page-progressOverlayX').disabled");
  await evaluate("window.setOverlayInput('progressOverlayX',-500);window.setOverlayInput('progressOverlayY',200);window.clickButton('保存更改')");
  await until("window.snapshot.value.progressOverlayWidth===570&&window.snapshot.value.progressOverlayX===-500");
  assert.deepEqual(await evaluate("['progressOverlayOpacity','progressOverlayWidth','progressOverlayHeight','progressOverlayPosition','progressOverlayX','progressOverlayY','progressLockShortcut'].map(key=>window.snapshot.value[key])"),[65,570,410,'custom',-500,200,'Ctrl+Alt+P']);

  assert.equal(await evaluate("document.querySelector('[data-wincu-tools]').open"),false,'Tool checklist must be collapsed by default');
  assert.equal(await evaluate("[...document.querySelectorAll('[data-wincu-tool]')].filter(x=>x.checked).length"),26,'All tools must be selected by default, including in an older lite profile');
  assert.equal(await evaluate("document.getElementById('wincu-page-toolPreset-full').checked"),true);
  assert.equal(await evaluate("document.querySelector('[data-wincu-tools]').hidden"),true,'Custom list belongs inside the Custom preset');
  await evaluate("document.getElementById('wincu-page-toolPreset-lite').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('12 / 26')");
  await evaluate("window.clickButton('放弃更改')");
  await until("document.getElementById('wincu-page-toolPreset-full').checked");
  assert.equal(await evaluate("document.getElementById('wincu-page-browserFirst').checked"),true);
  assert.equal(await evaluate("document.getElementById('wincu-page-browserVisible').checked"),true);
  await evaluate("document.getElementById('wincu-page-browserVisible').click()");
  await until("!document.getElementById('wincu-page-browserVisible').checked");
  await evaluate("window.clickButton('放弃更改')");
  await until("document.getElementById('wincu-page-browserVisible').checked");
  // Browser choice follows the Windows default and sign-ins are not kept.
  // Turning them on shows, before anything is saved, how to sign in, where
  // the sign-ins stay and the risks: nothing to set up in the user's browser.
  // The copy button is not clicked: it writes the real clipboard.
  const chooseApp=value=>evaluate("(()=>{const s=document.getElementById('wincu-page-browserApp');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,"+JSON.stringify(value)+");s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  const readNotice=()=>evaluate("(()=>{const n=document.querySelector('[data-wincu-signin-notice]'),r=n.getBoundingClientRect(),s=document.querySelector('[data-wincu-settings]').getBoundingClientRect();return {text:n.textContent,codes:[...n.querySelectorAll('code')].map(c=>c.textContent),copies:n.querySelectorAll('.wcu-address button').length,edge:!!n.querySelector('[data-wincu-signin-edge]'),hidden:!!n.querySelector('[data-wincu-signin-hidden]'),inside:r.left>=s.left-1&&r.right<=s.right+1,fits:n.scrollWidth<=n.clientWidth+1}})()");
  assert.equal(await evaluate("document.getElementById('wincu-page-browserApp').value"),'default');
  assert.equal(await evaluate("document.getElementById('wincu-page-browserSignIn').checked"),false);
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-signin-notice]')"),false,'No sign-in notice while sign-ins are not kept');
  await evaluate("document.getElementById('wincu-page-browserSignIn').click()");
  await until("!!document.querySelector('[data-wincu-signin-notice]')");
  let notice=await readNotice();
  assert.deepEqual(notice.codes,['%LOCALAPPDATA%\\dsh-computer-use-win\\agent-browser'],'The notice shows the folder that keeps the sign-ins');
  assert.equal(notice.copies,1);
  assert.ok(notice.text.includes('登录一次')&&notice.text.includes('不代填')&&notice.text.includes('以你的身份')&&notice.text.includes('本机其他程序'),'The notice says how to sign in and names the risks');
  assert.ok(!/inspect|remote-debugging|允许提示/.test(notice.text.replace('也不会弹出允许提示','')),'Nothing to set up in the user\'s own browser');
  assert.ok(notice.edge&&!notice.hidden,'The default browser may be Edge, so its Microsoft account sign-in is named');
  assert.ok(notice.inside&&notice.fits,'The notice fits the page');
  await chooseApp('firefox');
  await until("!!document.querySelector('[data-wincu-firefox-notice]')");
  assert.match(await evaluate("document.querySelector('[data-wincu-firefox-notice]').textContent"),/实验|隐藏|BiDi/);
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-signin-notice]')"),false,'Firefox must not offer Chromium visible sign-in instructions');
  assert.deepEqual(await evaluate("(()=>{const s=document.getElementById('wincu-page-browserVisible');return [s.checked,s.disabled]})()"),[false,true],'The Firefox that DSH starts has no window, so choosing Firefox turns the window switch off');
  assert.deepEqual(await evaluate("(()=>{const art=document.querySelector('label.wcu-art[for=\"wincu-page-browserApp\"]'),cap=art.querySelector('text').getBoundingClientRect(),box=art.getBoundingClientRect();return [art.querySelector('text').textContent,cap.left>=box.left&&cap.right<=box.right]})()"),['Firefox',true],'The browser picture names Firefox inside its frame');
  await new Promise(resolve=>setTimeout(resolve,300));
  await savePicture('settings-firefox.png');
  await chooseApp('chrome');
  await until("!document.querySelector('[data-wincu-signin-edge]')");
  assert.deepEqual(await evaluate("(()=>{const s=document.getElementById('wincu-page-browserVisible');return [s.checked,s.disabled]})()"),[true,false],'Leaving Firefox turns the window switch back');
  await evaluate("document.getElementById('wincu-page-browserVisible').click()");
  await until("!!document.querySelector('[data-wincu-signin-hidden]')");
  await evaluate("document.getElementById('wincu-page-browserVisible').click()");
  await until("!document.querySelector('[data-wincu-signin-hidden]')");
  await chooseApp('edge');
  await until("!!document.querySelector('[data-wincu-signin-edge]')");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.browserSignIn===true&&window.snapshot.value.browserApp==='edge'");
  await evaluate("window.renderPage('en')");
  await until("(document.querySelector('[data-wincu-signin-notice]')?.textContent||'').includes('Risks')");
  // #74: an unchanged banner text shows in the interface language.
  assert.equal(await evaluate("window.snapshot.value.indicatorText==='DSH 正在控制电脑'&&document.getElementById('wincu-page-text').value"),'DSH is controlling your computer');
  await evaluate("window.renderPage('zh')");
  await until("document.getElementById('wincu-page-text').value==='DSH 正在控制电脑'");
  await evaluate("document.getElementById('wincu-page-browserSignIn').click()");
  await until("!document.querySelector('[data-wincu-signin-notice]')");
  await chooseApp('default');
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.browserSignIn===false&&window.snapshot.value.browserApp==='default'");
  // The draft checks below count host writes from here on.
  await evaluate('window.writes=[]');
  const community=await evaluate("({links:[...document.querySelectorAll('[data-wincu-community] a')].map(a=>({href:a.href,target:a.target,rel:a.rel})),text:document.querySelector('[data-wincu-settings]').textContent,first:document.querySelector('.wcu-header').firstElementChild.hasAttribute('data-wincu-community')})");
  assert.deepEqual(community.links.map(a=>a.href),['https://github.com/Yu-tao-Li/dsh-computer-use-win','https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new']);
  assert.ok(community.first&&community.links.every(a=>a.target==='_blank'&&a.rel.includes('noopener')));
  assert.ok(await evaluate("document.querySelector('[data-wincu-community]').getBoundingClientRect().bottom<=document.querySelector('.wcu-title-row').getBoundingClientRect().top"),'Expanded Star/Issue note must be above the title');
  assert.equal(await evaluate("document.querySelector('[data-wincu-note-toggle]').textContent"),'折叠');
  assert.ok(await evaluate("(()=>{const box=document.querySelector('[data-wincu-community]'),button=document.querySelector('[data-wincu-note-toggle]'),a=box.getBoundingClientRect(),b=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button.previousSibling);const last=[...range.getClientRects()].at(-1);return box.contains(button)&&b.right<=a.right&&b.bottom<=a.bottom&&a.right-b.right<16&&b.top<last.bottom&&b.bottom>last.top})()"),'Collapse must be inside the note at bottom right and share its last text line');
  const externalLinks=await evaluate("[...document.querySelectorAll('[data-wincu-community] a')].map(a=>({icons:a.querySelectorAll('svg').length,label:a.getAttribute('aria-label'),border:getComputedStyle(a).borderTopStyle,cursor:getComputedStyle(a).cursor}))");
  assert.ok(externalLinks.every(a=>a.icons===2&&a.label.includes('新窗口')&&a.border==='solid'&&a.cursor==='pointer'),'External actions must have visible button borders, icons and accessible destinations');
  assert.ok(community.text.includes('您的 Star 就是我更新的动力')&&community.text.includes('您来许愿，我来实现'));
  assert.ok(community.text.includes('自定义停止方式')&&!community.text.includes('急停')&&!community.text.includes('用鼠标停止操作'));
  assert.equal(await evaluate('window.namespace'),process.env.WCU_SETTINGS_TEST_API==='legacy'?'windows-computer-use':'mcp-dsh-computer-use-win');
  assert.equal(await evaluate('window.page.entry.id'),'computer-use');
  // Hints open above their icon: a pointer of any size hangs below and to the
  // right of its tip. The pointer can rest on an open hint, a click keeps it
  // open after the pointer leaves, and Escape closes it.
  const hint=()=>evaluate("(()=>{const icon=document.querySelector('[data-wincu-browser-policy] .wcu-item .wcu-info'),tip=icon.querySelector('.wcu-tip'),a=icon.getBoundingClientRect(),b=tip.getBoundingClientRect();return {x:Math.round(a.x+a.width/2),y:Math.round(a.y+a.height/2),open:tip.matches(':popover-open'),above:b.bottom<=a.top,tipX:Math.round(b.x+b.width/2),tipY:Math.round(b.y+b.height/2),switchOn:document.getElementById('wincu-page-browserFirst').checked}})()");
  const pointer=(type,{x,y})=>win.webContents.sendInputEvent({type,x,y,button:'left',clickCount:1});
  const icon=await hint();
  pointer('mouseMove',icon);
  await until("document.querySelector('[data-wincu-browser-policy] .wcu-item .wcu-tip').matches(':popover-open')");
  const opened=await hint();
  assert.ok(opened.above,'A hint must open above its icon, where the pointer does not cover it');
  pointer('mouseMove',{x:opened.tipX,y:opened.tipY});
  await new Promise(r=>setTimeout(r,500));
  assert.equal((await hint()).open,true,'The pointer can rest on an open hint');
  pointer('mouseMove',{x:2,y:2});
  await until("!document.querySelector('[data-wincu-browser-policy] .wcu-item .wcu-tip').matches(':popover-open')");
  pointer('mouseDown',icon);pointer('mouseUp',icon);pointer('mouseMove',{x:2,y:2});
  await new Promise(r=>setTimeout(r,500));
  const pinned=await hint();
  assert.ok(pinned.open&&pinned.switchOn,'A clicked hint stays open and leaves its switch alone');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  await until("!document.querySelector('[data-wincu-browser-policy] .wcu-item .wcu-tip').matches(':popover-open')");
  assert.equal(await evaluate('window.page.entry.label()'),'电脑操控');
  assert.equal(await evaluate('window.dictionary.en.nav'),'Computer Use','The English tab keeps its name');
  // DSH draws a gear for plugin sections. Only this section's nav button swaps it for the mouse.
  const nav=await evaluate(`new Promise(resolve=>{
    const layer=document.createElement('div');
    layer.innerHTML='<div role="dialog"><button class="x_navCell"><svg></svg><span>电脑操控</span></button><button class="x_navCell"><svg></svg><span>模型</span></button></div>';
    document.body.append(layer);
    setTimeout(()=>{
      const [mine,other]=layer.querySelectorAll('button'),mouse=getComputedStyle(mine,'::before');
      resolve({mine:mine.hasAttribute('data-wincu-nav'),other:other.hasAttribute('data-wincu-nav'),gear:getComputedStyle(mine.firstElementChild).display,width:mouse.width,mask:mouse.maskImage||mouse.webkitMaskImage});
      layer.remove();
    },0);
  })`);
  assert.deepEqual({mine:nav.mine,other:nav.other,gear:nav.gear,width:nav.width},{mine:true,other:false,gear:'none',width:'16px'});
  assert.match(nav.mask,/^url\("data:image\/svg\+xml,/);
  assert.equal(await evaluate("window.entries.some(x=>x.entry.name==='settings.plugin.item')"),true);
  // DSH 0.1.x declares settings.plugin.item as a keyed slot and shows the card
  // registered under the namespace it edits; an id is rejected there (#76).
  assert.deepEqual(await evaluate("(()=>{const e=window.entries.find(x=>x.entry.name==='settings.plugin.item').entry;return {key:e.key===window.namespace,id:'id' in e};})()"),{key:true,id:false});
  await evaluate("document.getElementById('wincu-page-indicatorEnabled').click()");
  await until("!document.getElementById('wincu-page-indicatorEnabled').checked");
  assert.equal(await evaluate("document.getElementById('wincu-page-cursorIndicatorEnabled').disabled"),false,'Pointer control must remain independent of the screen indicator');
  await evaluate("document.getElementById('wincu-page-cursorIndicatorEnabled').click()");
  await until("!document.getElementById('wincu-page-cursorIndicatorEnabled').checked");
  assert.equal(await evaluate('window.snapshot.value.cursorIndicatorEnabled'),undefined,'Pointer change must stay a draft');
  await evaluate("window.clickButton('放弃更改')");
  await until("document.getElementById('wincu-page-cursorIndicatorEnabled').checked");
  await evaluate("document.getElementById('wincu-page-toolPreset-custom').click()");
  await until("!document.getElementById('wincu-page-tool-drag').disabled");
  await evaluate("window.chooseTool('drag')");
  await until("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存更改').disabled");
  assert.equal(await evaluate("document.getElementById('wincu-page-tool-group-input').indeterminate"),true,'Partial group must be indeterminate');
  assert.deepEqual(await evaluate('window.writes'),[],'Draft must not persist');
  await evaluate("window.clickButton('放弃更改')");
  await until("document.getElementById('wincu-page-tool-drag').checked");
  await evaluate("document.getElementById('wincu-page-toolPreset-custom').click()");
  await until("!document.getElementById('wincu-page-tool-drag').disabled");
  await evaluate("window.chooseTool('drag');window.choosePosition('bottom');document.getElementById('wincu-page-cursorIndicatorEnabled').click()");
  await evaluate("window.clickButton('保存更改')");
  await until("document.body.textContent.includes('已保存')");
  assert.equal(await evaluate('window.writes.length'),1,'Save all changed fields in a single host transaction');
  assert.equal(await evaluate("window.snapshot.value.enabledTools.includes('drag')"),false);
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),25);
  assert.equal(await evaluate('window.snapshot.value.indicatorPosition'),'bottom');
  assert.equal(await evaluate('window.snapshot.value.cursorIndicatorEnabled'),false,'Pointer switch must persist in the same atomic save');
  assert.equal(await evaluate("document.getElementById('wincu-page-remoteIndicatorVisible').checked"),true);
  await evaluate("document.getElementById('wincu-page-remoteIndicatorVisible').click()");
  await until("!document.getElementById('wincu-page-remoteIndicatorVisible').checked");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.remoteIndicatorVisible===false");
  await until("!document.getElementById('wincu-page-remoteIndicatorVisible').disabled");
  await evaluate("document.getElementById('wincu-page-remoteIndicatorVisible').click()");
  await until("document.getElementById('wincu-page-remoteIndicatorVisible').checked");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.remoteIndicatorVisible===true");
  await until("!document.getElementById('wincu-page-cursorIndicatorEnabled').disabled");
  await evaluate("document.getElementById('wincu-page-cursorIndicatorEnabled').click();window.clickButton('保存更改')");
  await until("window.snapshot.value.cursorIndicatorEnabled===true");
  await evaluate("window.failSave=true;window.chooseTool('click')");
  await evaluate("window.clickButton('保存更改')");
  await until("document.body.textContent.includes('保存失败')");
  assert.equal(await evaluate("window.snapshot.value.enabledTools.includes('click')"),true);
  await evaluate("window.clickButton('放弃更改')");
  await until("document.getElementById('wincu-page-tool-click').checked");
  await evaluate("window.clickButton('全部关闭')");
  await until("[...document.querySelectorAll('[data-wincu-tool]')].every(x=>!x.checked)");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.enabledTools.length===0");
  await evaluate("document.getElementById('wincu-page-tool-group-input').click()");
  await until("[...document.querySelectorAll('[data-wincu-tool]')].filter(x=>x.checked).length===7");
  await evaluate("window.clickButton('全选')");
  await until("[...document.querySelectorAll('[data-wincu-tool]')].every(x=>x.checked)");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.enabledTools.length===26");
  await evaluate("window.chooseTool('drag')");
  await until("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存更改').disabled");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.enabledTools.length===25");
  // A saved Custom selection comes back as saved after an unsaved detour.
  await evaluate("document.getElementById('wincu-page-toolPreset-full').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('26 / 26')");
  await evaluate("document.getElementById('wincu-page-toolPreset-custom').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('25 / 26')");
  assert.equal(await evaluate("document.getElementById('wincu-page-tool-drag').checked"),false,'A saved Custom selection stays as saved');
  await evaluate("document.getElementById('wincu-page-toolPreset-full').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('26 / 26')");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='full'");
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),25,'Switching presets does not rewrite the stored list');
  await evaluate("document.getElementById('wincu-page-toolPreset-lite').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('12 / 26')");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='lite'");
  await evaluate("document.getElementById('wincu-page-toolPreset-lazy').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('启动 1 项')");
  assert.equal(await evaluate("document.querySelector('[data-wincu-tools]').hidden"),true);
  assert.equal(await evaluate('window.snapshot.value.toolPreset'),'lite','Lazy stays a draft until saved');
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='lazy'");
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),25,'Lazy preserves custom restrictions for a later Custom selection');
  await evaluate("window.renderPage('en')");
  await until("document.getElementById('wincu-page-toolPreset-lazy').checked&&document.body.textContent.includes('1 at startup')");
  await evaluate("window.renderPage('zh')");
  await until("document.getElementById('wincu-page-toolPreset-lazy').checked&&document.body.textContent.includes('懒启动')");
  await new Promise(resolve=>setTimeout(resolve,100));
  await savePicture('settings-lazy.png');
  // Choosing Custom from another saved preset starts with every tool checked.
  await evaluate("document.getElementById('wincu-page-toolPreset-custom').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('26 / 26')");
  assert.equal(await evaluate("document.getElementById('wincu-page-tool-drag').checked"),true,'Custom starts with every tool checked');
  await evaluate("window.clickButton('全选')");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('26 / 26')");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='custom'&&window.snapshot.value.enabledTools.length===26");
  await evaluate("document.getElementById('wincu-page-browserVisible').click()");
  await evaluate("window.clickButton('预览')");
  await until("window.snapshot.value.previewToken>0");
  assert.match(await evaluate("document.querySelector('.wcu-status').textContent"),/未保存/,'Preview must still show unrelated unsaved changes');
  assert.match(await evaluate("document.querySelector('.wcu-status').textContent"),/预览/,'The preview result remains visible');
  assert.equal(await evaluate("document.getElementById('wincu-page-browserVisible').checked"),false);
  assert.notEqual(await evaluate("window.snapshot.value.browserVisible"),false,'Preview must not save browser settings');
  await evaluate("window.clickButton('放弃更改')");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='恢复桌面控制')"),false,'A new task resumes automatically; no settings resume button is needed');
  await evaluate("window.key=init=>{if(!window.nativeRecording&&['Escape','F8'].includes(init.code)){if(init.code==='Escape')window.hostEsc++;return false}return window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...init}))};window.clickButton('录制快捷键')");
  await until("document.querySelector('[data-recording=true]')!==null");
  assert.equal(await evaluate('window.nativeRecording'),true,'Suspend native Desktop shortcuts before recording');
  assert.equal(await evaluate("window.key({key:'Control',code:'ControlLeft',ctrlKey:true})"),false,'Recording must consume modifier keys');
  await evaluate("window.key({key:'F8',code:'F8',repeat:true})");
  assert.equal(await evaluate("!!document.querySelector('[data-recording=true]')"),true,'Auto-repeat must not record');
  await evaluate("window.key({key:'F8',code:'F8'})");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='F8'");
  assert.equal(await evaluate('window.nativeRecording'),false,'Release native shortcuts after capture');
  assert.equal(await evaluate('window.snapshot.value.stopShortcut'),'','Recorded shortcut remains a draft');
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.stopShortcut==='F8'");
  assert.equal(await evaluate("window.key({key:'k',code:'KeyK'})"),true,'Recorder must release the keyboard after capture');
  await evaluate("window.clickButton('重新录制')");
  await until("!!document.querySelector('[data-recording=true]')");
  await evaluate("window.key({key:'k',code:'KeyK',ctrlKey:true,altKey:true})");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='Ctrl + Alt + K'");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.stopShortcut==='Ctrl+Alt+K'");
  await evaluate("window.clickButton('重新录制')");
  await until("!!document.querySelector('[data-recording=true]')");
  await evaluate("window.key({key:'Escape',code:'Escape'})");
  await until("!document.querySelector('[data-recording=true]')");
  assert.equal(await evaluate('window.hostEsc'),0,'Escape cancels the recorder without reaching the native modal shortcut');
  assert.equal(await evaluate('window.nativeRecording'),false);
  assert.equal(await evaluate("document.querySelector('.wcu-shortcut-value').textContent"),'Ctrl + Alt + K');
  await evaluate("window.clickButton('重新录制')");
  await until("!!document.querySelector('[data-recording=true]')");
  await evaluate("window.dispatchEvent(new Event('blur'))");
  await until("!document.querySelector('[data-recording=true]')");
  assert.equal(await evaluate('window.nativeRecording'),false,'Release native shortcuts after blur');
  assert.equal(await evaluate("window.key({key:'z',code:'KeyZ'})"),true,'Blur must remove recording listeners');
  await evaluate("window.clickButton('恢复默认（Esc）')");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='Esc（默认）'");
  assert.equal(await evaluate('window.snapshot.value.stopShortcut'),'Ctrl+Alt+K','Clearing remains a draft');
  await evaluate("window.clickButton('放弃更改')");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='Ctrl + Alt + K'");
  await evaluate("window.clickButton('恢复默认（Esc）')");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='Esc（默认）'");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.stopShortcut===''");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='恢复默认（Esc）').disabled"),true,'Default reset must remain visible and disabled when already using Esc');
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),26,'Restoring the stop shortcut must preserve selected tools');
  // The support note collapses to one project link. The choice saves at once
  // and leaves a pending draft alone.
  await evaluate("document.getElementById('wincu-page-indicatorEnabled').click()");
  await until("!document.getElementById('wincu-page-indicatorEnabled').checked");
  await evaluate("document.querySelector('[data-wincu-note-toggle]').click()");
  await until("window.snapshot.value.communityNote==='link'&&!!document.querySelector('.wcu-header-actions a')");
  const compact=await evaluate("(()=>{const a=document.querySelector('.wcu-header-actions a');return {href:a.href,text:a.textContent,target:a.target,icons:a.querySelectorAll('svg').length,label:a.getAttribute('aria-label'),note:document.querySelector('[data-wincu-community]')?.textContent??'',toggle:document.querySelector('[data-wincu-note-toggle]').getAttribute('aria-label'),draft:!document.getElementById('wincu-page-indicatorEnabled').checked,saved:window.snapshot.value.indicatorEnabled}})()");
  assert.deepEqual([compact.href,compact.text,compact.target,compact.toggle],['https://github.com/Yu-tao-Li/dsh-computer-use-win','GitHub','_blank','展开']);
  assert.ok(compact.icons===1&&compact.label.includes('新窗口')&&!compact.note.includes('球球了'),'Compact note keeps one accessible project link');
  const expandButton=await evaluate("(()=>{const b=document.querySelector('[data-wincu-note-toggle]'),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect(),group=b.closest('.wcu-header-actions');return {text:b.textContent,width:r.width,height:r.height,iconWidth:s.width,border:getComputedStyle(b).borderTopStyle,groupBorder:getComputedStyle(group).borderTopStyle,includesGithub:group.contains(document.querySelector('.wcu-project-icon'))}})()");
  assert.equal(expandButton.text,'','The expand control uses an icon without visible text');
  assert.ok(expandButton.width>=32&&expandButton.height>=30&&expandButton.iconWidth>=16&&expandButton.border==='none'&&expandButton.groupBorder==='solid'&&expandButton.includesGithub,'One common border must enclose GitHub and the expand arrow; the arrow has no separate border');
  assert.ok(compact.draft&&compact.saved!==false,'Saving the note choice must neither save nor discard the pending draft');
  assert.ok(await evaluate("(()=>{const row=document.querySelector('.wcu-title-row').getBoundingClientRect(),link=document.querySelector('.wcu-header-actions a').getBoundingClientRect(),title=document.querySelector('.wcu-title-row h2').getBoundingClientRect();return !document.querySelector('[data-wincu-community]')&&link.left>title.right&&link.right<=row.right&&Math.abs(link.y-title.y)<20})()"),'Collapsed GitHub text link must stay at the upper right of the title');
  await savePicture('settings-compact.png');
  // The update control sits left of the GitHub group, on its line, and needs no
  // more room than one short button: Check for updates, or Update.
  await evaluate("window.__wcuUpdateTest.reset();window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.V,available:false});window.__wcuUpdateTest.check();void 0");
  await until("window.__wcuUpdateTest.state().phase==='latest'&&!!document.querySelector('[data-wincu-update-check]')");
  assert.ok(await evaluate("(()=>{const b=document.querySelector('[data-wincu-update-check]').getBoundingClientRect(),g=document.querySelector('.wcu-header-actions').getBoundingClientRect();return b.right<=g.left&&b.width<=96&&Math.abs((b.top+b.bottom)/2-(g.top+g.bottom)/2)<3&&getComputedStyle(document.querySelector('[data-wincu-update-check]')).backgroundColor==='rgba(0, 0, 0, 0)'})()"),'A transparent Check for updates sits left of GitHub, centred on its line');
  await savePicture('settings-compact-check.png');
  await evaluate("window.__wcuUpdateTest.reset();window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[]});window.__wcuUpdateTest.check();void 0");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  assert.ok(await evaluate("(()=>{const b=document.querySelector('[data-wincu-update-now]').getBoundingClientRect(),g=document.querySelector('.wcu-header-actions').getBoundingClientRect();return b.right<=g.left&&b.width<=72&&Math.abs((b.top+b.bottom)/2-(g.top+g.bottom)/2)<3&&getComputedStyle(document.querySelector('[data-wincu-update-now]')).backgroundColor==='rgba(0, 0, 0, 0)'})()"),'A transparent Update sits left of GitHub, centred on its line');
  await savePicture('settings-compact-update.png');
  await evaluate("window.__wcuUpdateTest.reset();window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.V,available:false});void 0");
  await evaluate("document.querySelector('[data-wincu-note-toggle]').click()");
  await until("window.snapshot.value.communityNote==='full'&&document.querySelector('[data-wincu-community]').textContent.includes('您来许愿，我来实现')");
  assert.equal(await evaluate("document.querySelector('[data-wincu-note-toggle]').textContent"),'折叠');
  await evaluate("window.clickButton('放弃更改')");
  await until("document.getElementById('wincu-page-indicatorEnabled').checked");
  await evaluate("document.getElementById('wincu-page-browserFirst').click()");
  await until("!document.getElementById('wincu-page-browserFirst').checked");
  await evaluate("document.getElementById('wincu-page-browserVisible').click()");
  await until("!document.getElementById('wincu-page-browserVisible').checked");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.browserFirst===false&&window.snapshot.value.browserVisible===false");
  await evaluate("window.renderPage('en')");
  await until("!document.getElementById('wincu-page-browserVisible').checked");
  await evaluate("window.renderPage('zh')");
  // Theme tokens are the values read from the real Desktop host. Check both
  // foreground/background contrast and native control theme propagation.
  await evaluate("document.querySelectorAll('[data-wincu-settings] details').forEach(d=>d.open=true)");
  const contrasts=await evaluate(`(async()=>{
    const root=document.documentElement;
    const pixels=document.createElement('canvas');pixels.width=pixels.height=1;const paint=pixels.getContext('2d',{willReadFrequently:true});
    function ratio(a,b){const lum=s=>{paint.clearRect(0,0,1,1);paint.fillStyle=s;paint.fillRect(0,0,1,1);const c=[...paint.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
    function check(){return [...document.querySelectorAll('.wcu-control')].map(e=>{const s=getComputedStyle(e);return ratio(s.color,s.backgroundColor)})}
    function actions(){return [...document.querySelectorAll('.wcu-community a,.wcu-segment label:has(input:checked),[data-wincu-tool-count]')].map(e=>{const s=getComputedStyle(e);return ratio(s.color,s.backgroundColor)})}
    await new Promise(r=>setTimeout(r,200));const light=check(),lightActions=actions();
    for(const [k,v] of Object.entries({'--dsw-alias-bg-layer-1':'#232324','--dsw-alias-bg-layer-2':'#2c2c2e','--dsw-alias-bg-layer-3':'#353638','--dsw-alias-label-primary':'#f9fafb','--dsw-alias-label-secondary':'#b7b9bd','--dsw-alias-border-l2':'#ffffff1f'}))root.style.setProperty(k,v);
    document.body.style.background='#2c2c2e';document.body.style.color='#f9fafb';await new Promise(r=>setTimeout(r,200));return {light,dark:check(),lightActions,darkActions:actions()};
  })()`);
  assert.ok(contrasts.light.every(x=>x>=4.5)&&contrasts.dark.every(x=>x>=4.5),'Native control text must remain readable in both themes');
  assert.ok(contrasts.lightActions.every(x=>x>=4.5)&&contrasts.darkActions.every(x=>x>=4.5),'Links, selected presets and tool counts must remain readable in both themes: '+JSON.stringify(contrasts));
  // A missing host form must never masquerade as editable default values.
  await evaluate("window.savedSnapshot=window.snapshot;window.snapshot={status:'unavailable',writable:true};for(const fn of window.listeners)fn()");
  await until("!!document.querySelector('[data-wincu-unavailable]')");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-settings]')"),false);
  await evaluate("window.snapshot={...window.savedSnapshot,status:'ready'};for(const fn of window.listeners)fn()");
  await until("!!document.querySelector('[data-wincu-settings]')");
  await evaluate("window.root.render(React.createElement(window.page.card,{...window.page.entry.inject(),t:key=>window.dictionary.zh[key],view:'summary'}))");
  await until("!!document.querySelector('[data-wincu-summary]')");
  assert.equal(await evaluate("document.body.textContent.includes('点击进行具体设置')&&document.querySelectorAll('input').length===0"),true,'Plugin list summary must contain no settings form');
  // Reconstruct a complete series from durable events, then reconstruct again
  // to model reopening the conversation without process-local UI history.
  const activity=await evaluate(`(()=>{
   const def=window.definitions.find(d=>d.kind==='wincu-series');
   const call=(seq,id,name,args)=>({seq,type:'tool/call',data:{turn:1,callId:id,name:'mcp__wincu__windows_computer_use_'+name,arguments:args}});
   const result=(seq,id,value)=>({seq,type:'tool/result',data:{turn:1,message:{callId:id,content:[{type:'text',text:JSON.stringify(value)}]}}});
   window.events=[{seq:0,type:'turn/start',data:{turn:1}},call(1,'a','type_text',{text:'测试',windowTitle:'Edge 搜索'}),result(2,'a',{verification:'sent'}),call(3,'b','keypress',{keys:['enter']}),result(4,'b',{verification:'sent'}),call(5,'c','screenshot',{}),result(6,'c',{window:{title:'测试 - Bing'},verification:'observed'}),{seq:7,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}];
   const replay=()=>{let state;for(const event of window.events){const match={...def.match(event),event};state=state===undefined?def.start({},match):def.update({state},match);}return def.buildViewNode({key:'wcu:1',id:'1',state});};
   const node=replay(),reopened=replay();window.seriesNode=node;
   const row=window.entries.find(x=>x.entry.name==='conversation.chat.node'&&x.entry.key==='wincu-series');
   window.root.render(React.createElement(row.card,{node,t:key=>window.dictionary.zh[key]}));
   return {same:JSON.stringify(node)===JSON.stringify(reopened),count:node.data.calls.length,ended:node.data.ended};
  })()`);
  assert.deepEqual(activity,{same:true,count:3,ended:true});
  // One start per turn, from turn/start only, as DSH's own turn-tail Definition
  // does: DSH 0.1.5 throws on a second start and history paging stops (#76).
  // test/host-conversation-replay.mjs replays this through real DSH assemblers.
  const roles=await evaluate(`(()=>{
   const def=window.definitions.find(d=>d.kind==='wincu-series');
   const other={seq:8,type:'tool/call',data:{turn:1,callId:'x',name:'read_file',arguments:{}}};
   return [...window.events,other].map(event=>{const match=def.match(event);return match.id+':'+match.role;});
  })()`);
  assert.deepEqual(roles,['1:start','1:update','1:update','1:update','1:update','1:update','1:update','1:update','1:update']);
  await until("!!document.querySelector('[data-wincu-series]')");
  assert.equal(await evaluate("document.body.textContent.includes('在浏览器中搜索了「测试」')&&!!document.querySelector('[data-wincu-series] svg')"),true);
  await evaluate("document.querySelector('[data-wincu-series]').open=true");
  assert.equal(await evaluate("document.querySelectorAll('[data-wincu-series] li').length"),3);
  const statusChecks=await evaluate(`(()=>{
   const def=window.definitions.find(d=>d.kind==='wincu-series'),row=window.entries.find(x=>x.entry.name==='conversation.chat.node'&&x.entry.key==='wincu-series');
   const replay=events=>{let state;for(const event of events){const match={...def.match(event),event};state=state===undefined?def.start({},match):def.update({state},match);}return def.buildViewNode({key:'negative',id:'1',state});};
   const failed=structuredClone(window.events);failed[2].data.message.isError=true;
   const failedNode=replay(failed),stopped=structuredClone(failed);stopped[2].data.message.content=[{type:'text',text:'COMPUTER_USE_STOPPED_BY_USER'}];
   const stoppedNode=replay(stopped),unfinished=replay(window.events.filter(e=>e.seq!==6));
   window.negativeNode=failedNode;window.negativeRow=row;
   window.root.render(React.createElement(row.card,{node:failedNode,t:key=>window.dictionary.zh[key]}));
   return {failed:failedNode.data.calls[0].status,stopped:stoppedNode.data.calls[0].status,unfinished:unfinished.data.calls[2].status};
  })()`);
  assert.deepEqual(statusChecks,{failed:'failed',stopped:'stopped',unfinished:'working'});
  await until("document.body.textContent.includes('未完成')&&!document.body.textContent.includes('在浏览器中搜索了')");
  const factory=await evaluate(`(()=>{
   const node=structuredClone(window.seriesNode);node.data.calls[2].message.content.push({type:'image',attachment:{id:'test-image',mediaType:'image/png'}});
   window.factoryCalls=[];window.root.render(React.createElement(window.negativeRow.card,{node,t:key=>window.dictionary.zh[key],loadImage:async()=>'',renderFactorySlot:(name,props)=>{window.factoryCalls.push({name,count:props.images.length,loader:typeof props.loadImage});return React.createElement('span',{'data-image-factory':true},'image');}}));return true;
  })()`);
  await until("!!document.querySelector('[data-image-factory]')");
  assert.deepEqual(await evaluate('window.factoryCalls.at(-1)'),{name:'conversation.images.content',count:1,loader:'function'});
  await evaluate("window.renderPage('zh')");
  await until("!!document.querySelector('[data-wincu-settings]')");
  const before=paintCount;
  win.webContents.invalidate();
  const paintDeadline=Date.now()+5000;
  while(paintCount<=before){if(Date.now()>paintDeadline)throw Error('Settings page did not repaint');await new Promise(r=>setTimeout(r,20))}
  assert.ok(paintedImage&&!paintedImage.isEmpty());
  await savePicture('settings-page.png');
  await evaluate("document.querySelector('[data-wincu-progress-settings]').scrollIntoView({block:'start'});window.scrollBy(0,-12)");
  await savePicture('settings-progress.png');
  assert.equal(await evaluate("document.querySelector('[data-wincu-progress-details]').open"),false);
  await evaluate("document.querySelector('[data-wincu-progress-details]>summary').click()");
  await evaluate("document.querySelector('[data-wincu-progress-settings]').scrollIntoView({block:'start'});window.scrollBy(0,-12)");
  await new Promise(r=>setTimeout(r,100));
  await savePicture('settings-progress-expanded.png');
  // Live external overlay geometry updates while draft edits are pending must
  // merge into the form instead of being overwritten on Save.
  await evaluate("document.getElementById('wincu-page-browserFirst').click()");
  await until("document.getElementById('wincu-page-browserFirst').checked");
  await evaluate("window.snapshot={...window.snapshot,value:{...window.snapshot.value,progressOverlayX:321,progressOverlayWidth:612,progressOverlayPosition:'custom'},revision:window.snapshot.revision+1};for(const fn of window.listeners)fn()");
  await until("document.getElementById('wincu-page-progressOverlayX').value==='321'&&document.getElementById('wincu-page-progressOverlayWidth').value==='612'");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.browserFirst===true&&window.snapshot.value.progressOverlayX===321&&window.snapshot.value.progressOverlayWidth===612");
  // Indicator Preview applies only indicator fields directly even while unrelated draft edits remain unsaved.
  await evaluate("document.getElementById('wincu-page-browserFirst').click();window.choosePosition('top')");
  await until("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='预览').disabled");
  const prevPreview=await evaluate("window.snapshot.value.previewToken||0");
  await evaluate("window.clickButton('预览')");
  await until("window.snapshot.value.previewToken>"+prevPreview+"&&window.snapshot.value.indicatorPosition==='top'");
  assert.equal(await evaluate("window.snapshot.value.browserFirst"),true,'Preview must not commit unrelated browser draft edits');
  assert.equal(await evaluate("document.getElementById('wincu-page-browserFirst').checked"),false,'Unrelated browser draft remains visible');
  await evaluate("window.clickButton('放弃更改')");
  await until("document.getElementById('wincu-page-browserFirst').checked===true");
  // Typed lock shortcuts normalize case/whitespace on Save and detect stop-shortcut collisions clearly.
  await evaluate("window.setOverlayInput('progressLockShortcut','ctrl + shift + l');window.clickButton('保存更改')");
  await until("window.snapshot.value.progressLockShortcut==='Ctrl+Shift+L'");
  await evaluate("window.clickButton('录制快捷键')");
  await until("!!document.querySelector('[data-recording=true]')");
  await evaluate("window.key({key:'L',code:'KeyL',ctrlKey:true,shiftKey:true})");
  await until("!document.querySelector('[data-recording=true]')");
  await evaluate("window.clickButton('保存更改')");
  await until("document.body.textContent.includes('锁定快捷键不能与停止快捷键相同')");
  assert.equal(await evaluate("window.snapshot.value.stopShortcut"),'','Conflicting shortcut must not be sent to host');
  await evaluate("window.clickButton('放弃更改')");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='Esc（默认）'");
  await evaluate("window.setOverlayInput('progressLockShortcut','Ctrl+Alt+P');window.clickButton('保存更改')");
  await until("window.snapshot.value.progressLockShortcut==='Ctrl+Alt+P'");
  await evaluate("window.failNativeRecording=true;window.clickButton('录制快捷键')");
  await until("document.body.textContent.includes('无法暂停桌面快捷键')&&!document.querySelector('[data-recording=true]')");
  assert.equal(await evaluate('window.nativeRecording'),false,'A failed native lease must cancel recording');
  await evaluate("window.failNativeRecording=false;window.desktopBridge=window.dshDesktop;delete window.dshDesktop;window.clickButton('录制快捷键')");
  await until("!!document.querySelector('[data-recording=true]')");
  await evaluate("window.key({key:'x',code:'KeyX'})");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='X'");
  await evaluate("window.clickButton('放弃更改');window.dshDesktop=window.desktopBridge;void 0");
  await evaluate("window.clickButton('录制快捷键')");
  await until("window.nativeRecording===true");
  await evaluate("window.root.render(React.createElement('span',null,'unmounted recorder'))");
  await until("window.nativeRecording===false");
  await evaluate("window.renderPage('zh')");
  await until("!!document.querySelector('[data-wincu-settings]')&&!document.querySelector('[data-recording=true]')");
  // Plugin updates through the market's update API, then npm, then nothing.
  const updateText="(document.querySelector('[data-wincu-update]')?.textContent||'')";
  const noteText="(document.querySelector('[data-wincu-update-note]')?.textContent||'')";
  const posts="window.fetchCalls.filter(c=>c.method==='POST'&&c.url==='/dsh-market/api/v1/updates')";
  // Report a problem: the plugin writes the file and opens the Downloads folder
  // and the new-issue page; the page shows a modal dialog saying where the file
  // went. The issue link stays available regardless of the browser launch.
  const ISSUE_PAGE='https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new';
  const reportFileName='wincu-diagnostics-20261118-020304.txt';
  const reportFilePath=path.win32.join('D:\\已重定向的下载目录',reportFileName);
  const reportReply={status:200,body:{ok:true,fileName:reportFileName,filePath:reportFilePath,folderOpened:true,issueOpened:true}};
  await evaluate("window.opened=[];window.open=url=>{window.opened.push(String(url));return null;};window.reportReply="+JSON.stringify(reportReply)+";window.baseFetch=window.fakeFetch;window.fakeFetch=call=>call.url==='/dsh-computer-use-win/api/diagnostics'?window.reportReply:window.baseFetch?window.baseFetch(call):{status:404,body:null};void 0");
  assert.ok(await evaluate("(()=>{const b=document.querySelector('[data-wincu-report=idle]');return !!b&&b.textContent==='反馈问题'&&getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)'})()"),'A transparent Report a problem button');
  await evaluate("document.querySelector('[data-wincu-report=idle]').click()");
  await until("document.querySelector('dialog[data-wincu-report-dialog=saved]')?.open");
  const reportCall=await evaluate("window.fetchCalls.filter(c=>c.url==='/dsh-computer-use-win/api/diagnostics').map(c=>({method:c.method,header:c.headers['x-wcu-request'],type:c.headers['content-type']}))");
  assert.deepEqual(reportCall,[{method:'POST',header:'1',type:'application/json'}],'One POST with the plugin header');
  const savedDialog=await evaluate("(()=>{const d=document.querySelector('dialog[data-wincu-report-dialog=saved]'),ok=d.querySelector('button'),box=d.getBoundingClientRect();return {open:d.open,modal:d.matches(':modal'),texts:[...d.querySelectorAll('p')].map(p=>p.textContent),path:d.querySelector('[data-wincu-report-path]')?.textContent,button:ok.textContent,focused:document.activeElement===ok,centered:Math.abs(box.left+box.width/2-document.documentElement.clientWidth/2)<2,idle:!!document.querySelector('[data-wincu-report=idle]')};})()");
  assert.deepEqual(savedDialog,{open:true,modal:true,texts:['已保存诊断文件',reportFileName,'已打开 GitHub 新建问题页。请描述问题并附上此文件。'],path:reportFilePath,button:'确定',focused:true,centered:true,idle:true},'The modal names the file, shows its full path and confirms the page opened');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('dialog a')].map(a=>[a.href,a.textContent])"),[[ISSUE_PAGE,'GitHub 新建问题页']],'The page name also links directly to the issue form');
  assert.deepEqual(await evaluate('window.opened'),[],'The settings UI requests no additional browser launch');
  await evaluate("document.querySelector('dialog[data-wincu-report-dialog=saved] button').click()");
  await until("!document.querySelector('dialog[data-wincu-report-dialog]')");
  const resetReport=async reply=>{await evaluate("window.reportReply="+reply+";window.root.render(React.createElement('span',null,'closed'))");await evaluate("window.renderPage('zh')");await until("!!document.querySelector('[data-wincu-report=idle]')");await evaluate("document.querySelector('[data-wincu-report=idle]').click()");};
  await resetReport(JSON.stringify({status:200,body:{...reportReply.body,folderOpened:false,issueOpened:false}}));
  await until("document.querySelector('dialog[data-wincu-report-dialog=saved]')?.open");
  assert.equal(await evaluate("document.querySelector('dialog a').href"),ISSUE_PAGE,'The exact issue URL is available when launch fails');
  assert.equal(await evaluate("document.querySelector('[data-wincu-report-path]').textContent"),reportFilePath,'The path is available even when neither window opens');
  assert.equal(await evaluate("document.querySelector('.wcu-dialog-detail').textContent"),'请打开 GitHub 新建问题页，描述问题并附上此文件。');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  await until("!document.querySelector('dialog[data-wincu-report-dialog]')");
  await resetReport("{status:500,body:{ok:false,issueOpened:true}}");
  await until("!!document.querySelector('dialog[data-wincu-report-dialog=failed]')");
  assert.equal(await evaluate("document.querySelector('dialog a').href"),ISSUE_PAGE,'A failed write can still be reported directly');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('dialog[data-wincu-report-dialog=failed] p')].map(p=>p.textContent)"),['诊断文件未能保存。','你仍可在 GitHub 新建问题页描述问题。']);
  await evaluate("document.querySelector('dialog[data-wincu-report-dialog=failed] button').click()");
  await until("!document.querySelector('dialog[data-wincu-report-dialog]')");
  await resetReport("{status:200,body:{ok:false,cancelled:true}}");
  await until("!!document.querySelector('dialog[data-wincu-report-dialog=failed]')");
  assert.equal(await evaluate("document.querySelector('#wcu-report-dialog-text').textContent"),'已取消保存诊断文件。');
  await evaluate("document.querySelector('dialog[data-wincu-report-dialog=failed] button').click()");
  await until("!document.querySelector('dialog[data-wincu-report-dialog]')");
  await evaluate("window.fakeFetch=window.baseFetch;void 0");
  const recheck=async market=>{await evaluate("window.__wcuUpdateTest.reset();window.fetchCalls=[];window.fakeFetch="+market+";window.__wcuUpdateTest.check();void 0");};
  // The npm version controls the button, including during a market hold.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:false})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),npm:window.V,available:true})");
  await until("window.__wcuUpdateTest.state().phase==='latest'");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-now]')"),false,'A newer market channel cannot override npm latest');
  // Check for updates by hand: the market skips its cache, "Checking…" while it
  // runs, the result for a moment, then the button again.
  await evaluate("window.__wcuUpdateResultMs=400;window.fetchCalls=[];window.slowMarket=window.fakeMarket({installed:window.V,latest:window.V,available:false});window.fakeFetch=call=>new Promise(r=>setTimeout(()=>r(window.slowMarket(call)),300));document.querySelector('[data-wincu-update-check]').click()");
  await until(updateText+"==='检查中…'");
  await savePicture('update-checking.png');
  await until("document.querySelector('[data-wincu-update-result=latest]')?.textContent==='已是最新版本'");
  await savePicture('update-latest.png');
  assert.equal(await evaluate("window.fetchCalls.some(c=>c.url.startsWith('/dsh-market/api/v1/updates?name=dsh-computer-use-win')&&c.url.includes('force=1'))"),true,'A check by hand skips the market cache');
  await until("!!document.querySelector('[data-wincu-update-check]')");
  await evaluate("window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[]});document.querySelector('[data-wincu-update-check]').click()");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-result]')"),false,'A found update goes straight to Update');
  await recheck("null");
  await until("window.__wcuUpdateTest.state().phase==='unknown'&&!!document.querySelector('[data-wincu-update-check]')");
  await evaluate("document.querySelector('[data-wincu-update-check]').click()");
  await until("document.querySelector('[data-wincu-update-result=unknown]')?.textContent==='暂时无法检查更新'");
  await until("!!document.querySelector('[data-wincu-update-check]')");
  // Right after a release the market's mirror can trail npm: the one click
  // waits for it, says why it takes longer, then installs.
  await evaluate("window.__wcuUpdateSyncMs=40;void 0");
  await recheck("window.fakeMarket({installed:window.V,latest:window.V,npm:window.bump(window.V),available:false})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-note=syncing]')?.textContent.includes('正在等插件市场同步')&&"+updateText+".includes('更新中')");
  await savePicture('update-syncing.png');
  assert.equal(await evaluate(posts+'.length'),0,'Nothing is installed before the market lists the version');
  await evaluate("window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'succeeded',installedVersion:window.bump(window.V)}]});void 0");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'&&!document.querySelector('[data-wincu-update-note=syncing]')");
  assert.deepEqual(await evaluate(posts+".map(c=>c.body)"),[{packageName:'dsh-computer-use-win'}],'One install once the market caught up');
  // A market that never catches up: no install, one plain sentence and a retry.
  await recheck("window.fakeMarket({installed:window.V,latest:window.V,npm:window.bump(window.V),available:false})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("window.__wcuUpdateTest.state().failure?.code==='MARKET_NOT_SYNCED'&&!!document.querySelector('[data-wincu-update-retry]')");
  assert.equal(await evaluate(posts+'.length'),0,'A stale market must not install a different version');
  assert.ok(await evaluate("window.fetchCalls.filter(c=>c.url.includes('force=1')).length>1"),'The market is asked again while it catches up');
  assert.ok(await evaluate(noteText+".startsWith('插件市场还没同步到新版本')"));
  // A local (file:/link:) install: the market reports it as linked and cannot
  // replace it, so Update opens the upgrade steps instead of installing.
  await recheck("window.fakeMarket({source:'linked',installed:window.V,latest:null,npm:window.bump(window.V),operations:[]})");
  await until("!!document.querySelector('[data-wincu-update-help]')");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-now]')"),false,'No in-place update for a local install');
  // Without the market: npm tells the version, the page links the upgrade steps.
  await recheck("window.fakeMarket({absent:true,npm:window.bump(window.V)})");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='available'");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-now]')"),false,'npm alone cannot update in place');
  assert.equal(await evaluate("(a=>a.textContent==='更新'&&a.href.includes('#12-')&&a.title.includes('v'+window.bump(window.V)))(document.querySelector('[data-wincu-update-help]'))"),true);
  assert.equal(await evaluate("(b=>b.hasAttribute('data-wincu-nav')&&!b.hasAttribute('data-wincu-update')&&getComputedStyle(b,'::after').content==='none')(document.querySelector('#fake-nav button'))"),true,'An available update leaves the nav button without a dot');
  // npm's registry first; when it cannot be reached, a mirror answers.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,npmDown:true,mirror:window.bump(window.V),operations:[]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  assert.deepEqual(await evaluate("window.fetchCalls.filter(c=>c.url.endsWith('/dsh-computer-use-win/latest')).map(c=>c.url).slice(0,2)"),['https://registry.npmjs.org/dsh-computer-use-win/latest','https://mirrors.cloud.tencent.com/npm/dsh-computer-use-win/latest'],'npm first, then a mirror');
  await recheck("window.fakeMarket({installed:window.V,latest:window.V,available:false,operations:[]})");
  await until("window.__wcuUpdateTest.state().phase==='latest'");
  assert.equal(await evaluate("window.fetchCalls.some(c=>c.url.includes('mirrors.cloud.tencent.com')||c.url.includes('npmmirror'))"),false,'A mirror is not asked while npm answers');
  // The market is busy with another install: the page waits for it, says so,
  // then installs.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,busy:true,operations:[]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  assert.equal(await evaluate("(b=>b.textContent+'|'+b.title)(document.querySelector('[data-wincu-update-now]'))"),'更新|有新版本 v'+await evaluate('window.bump(window.V)'),'One word on the button, the version in its tooltip');
  await savePicture('update-available.png');
  await evaluate("window.__wcuUpdateSyncMs=200;document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-note=busy]')?.textContent.includes('插件市场正在处理别的安装')&&"+updateText+".includes('更新中')");
  await savePicture('update-busy-waiting.png');
  await evaluate("window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'succeeded',installedVersion:window.bump(window.V)}]});void 0");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'");
  // Success opens a dialog with the new version. Neither the market nor the
  // plugin restarts this host, so it says how to restart by hand.
  await until("document.querySelector('[data-wincu-update-dialog]')?.open===true&&document.querySelector('[data-wincu-update-dialog]').dataset.wincuUpdateDialog==='manual'");
  assert.equal(await evaluate("document.querySelector('[data-wincu-update-dialog]').querySelector('p').textContent"),'已更新到 v'+await evaluate('window.bump(window.V)'));
  assert.ok(await evaluate("document.querySelector('[data-wincu-update-dialog]').textContent.includes('托盘')"));
  await evaluate("document.querySelector('[data-wincu-update-dialog] button').click()");
  await until("!document.querySelector('[data-wincu-update-dialog]')");
  // A market that stays busy ends in one short word and a retry.
  await evaluate("window.__wcuUpdateSyncMs=40;void 0");
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,busy:true,operations:[]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='failed'&&!!document.querySelector('[data-wincu-update-retry]')");
  assert.ok(await evaluate(updateText+".includes('插件市场正忙')"));
  assert.ok(await evaluate(posts+'.length>10'),'The busy market was asked again before the page gave up');
  // An agent is running: the market does not update meanwhile, and the page
  // says to retry after it.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'failed',failure:{code:'AGENTS_RUNNING',message:'agents are running',retryable:true}}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='failed'&&!!document.querySelector('[data-wincu-update-retry]')");
  assert.ok(await evaluate(noteText+".startsWith('有 agent 正在运行')"));
  assert.equal(await evaluate("document.querySelector('[data-wincu-update-note=failed]').title"),'agents are running','The market’s own words are in the tooltip');
  // A release younger than the market's waiting period: the same click goes on
  // with force, with no second question.
  await recheck("window.market=window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'failed',failure:{code:'RELEASE_TOO_FRESH',message:'release age',retryable:true}},{state:'running',progress:{percent:40}},{state:'succeeded',installedVersion:window.bump(window.V)}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-note-toggle]').click()");
  await until("window.snapshot.value.communityNote==='link'&&!document.querySelector('[data-wincu-community]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until(updateText+".includes('40%')");
  await savePicture('update-running.png');
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'&&document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='manual'");
  await savePicture('update-dialog-manual.png');
  await evaluate("document.querySelector('[data-wincu-update-dialog] button').click()");
  await until("!document.querySelector('[data-wincu-update-dialog]')");
  assert.deepEqual(await evaluate(posts+".map(c=>c.body)"),[{packageName:'dsh-computer-use-win'},{packageName:'dsh-computer-use-win',force:true}],'The first request leaves the waiting period on; a hold sends one forced request');
  assert.equal(await evaluate("document.querySelector('[data-wincu-update=updated] span').title"),'已更新到 v'+await evaluate('window.bump(window.V)'));
  assert.ok(await evaluate(noteText+".includes('托盘')"),'Desktop owns the restart: the page says how');
  await savePicture('update-done.png');
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-restart]')"),false,'No restart button the market does not offer');
  await evaluate("window.root.render(React.createElement('span',null,'closed'))");
  await evaluate("window.renderPage('zh')");
  await until("document.querySelector('[data-wincu-note-toggle]')?.getAttribute('aria-label')==='展开'");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-community]')"),false,'The saved note stays collapsed when the settings page reopens after an update');
  // A success that installed an older build is not reported as an update.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'succeeded',installedVersion:window.V}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='failed'");
  assert.ok(await evaluate(noteText+".includes('装上的不是新版本')"));
  // A lost operation is checked against the versions before any second POST.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),lost:true})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("!!document.querySelector('[data-wincu-update-recheck]')");
  await evaluate("window.fakeFetch=window.fakeMarket({installed:window.bump(window.V),latest:window.bump(window.V)});document.querySelector('[data-wincu-update-recheck]').click()");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'");
  assert.equal(await evaluate(posts+'.length'),1,'Confirming the outcome cannot issue a second install');
  // dsh web with a market that restarts it: the dialog warns that the task in
  // progress stops and offers Restart now; no tray note.
  await recheck("window.fakeMarket({runtime:'web',restart:true,installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'succeeded',installedVersion:window.bump(window.V)}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='restart'");
  assert.ok(await evaluate("document.querySelector('[data-wincu-update-dialog]').textContent.includes('重启会中断正在进行的任务')"));
  assert.equal(await evaluate("document.activeElement.textContent"),'稍后','A stray Enter must not restart DSH');
  assert.equal(await evaluate(noteText),'');
  await savePicture('update-dialog-restart.png');
  // A scheduled version check must not overwrite the verified install with a
  // stale or unavailable registry/market result.
  await evaluate("window.fakeFetch=window.fakeMarket({absent:true,installed:window.V,latest:null});window.__wcuUpdateTest.check()");
  assert.equal(await evaluate("document.querySelector('[data-wincu-update-dialog]').dataset.wincuUpdateDialog"),'restart');
  // Recreate just the UI's update state as on a reload. The market still owns
  // the original operation. Poll it, and never send another install request.
  await evaluate("window.__wcuUpdateTest.reset({keepReceipt:true});window.fakeFetch=window.fakeMarket({runtime:'web',restart:true,installed:window.V,latest:window.bump(window.V),operations:[{state:'succeeded',installedVersion:window.bump(window.V)}]});window.__wcuUpdateTest.check()");
  await until("document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='restart'");
  assert.equal(await evaluate(posts+'.length'),1,'Recovering confirmation must not submit another update');
  // DSH's outer Settings layer also closes on Escape. Only the confirmation
  // should close, and its reminder can reopen it.
  await evaluate("window.outerEscape=0;document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented)window.outerEscape++;});document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));void 0");
  await until("!document.querySelector('[data-wincu-update-dialog]')&&document.querySelector('[data-wincu-update-restart]')?.textContent==='重启以完成更新'");
  assert.equal(await evaluate('window.outerEscape'),0,'Escape must not close the surrounding DSH settings');
  await evaluate("window.__wcuUpdateTest.reset({keepReceipt:true});window.fakeFetch=window.fakeMarket({runtime:'web',restart:true,installed:window.bump(window.V),latest:window.bump(window.V),operations:[{state:'succeeded',installedVersion:window.bump(window.V)}]});window.__wcuUpdateTest.check()");
  await until("!!document.querySelector('[data-wincu-update-restart]')");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-dialog]')"),false,'An explicitly dismissed confirmation stays closed after reload');
  await evaluate("window.__wcuRestartWaitMs=300;document.querySelector('[data-wincu-update-restart]').click()");
  await until("!!document.querySelector('[data-wincu-update-restart-now]')");
  await evaluate("document.querySelector('[data-wincu-update-restart-now]').click()");
  await until("window.fetchCalls.some(c=>c.method==='POST'&&c.url==='/dsh-market/api/v1/restart')");
  // Still open after the wait: DSH did not restart, and the dialog says how to by hand.
  await until("document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='failed'");
  assert.ok(await evaluate("document.querySelector('[data-wincu-update-dialog]').textContent.includes('DSH 没有重启')&&document.querySelector('[data-wincu-update-dialog]').textContent.includes('dsh web')"));
  await evaluate("document.querySelector('[data-wincu-update-dialog] button').click()");
  await until("!document.querySelector('[data-wincu-update-dialog]')");
  // DSH Desktop: the market does not restart a host it does not supervise, so
  // the plugin's own route does, and the dialog says DSH opens again.
  await recheck("window.fakeMarket({pluginRestart:true,installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'succeeded',installedVersion:window.bump(window.V)}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='restart'");
  await evaluate("window.__wcuRestartWaitMs=60000;document.querySelector('[data-wincu-update-restart-now]').click()");
  await until("window.fetchCalls.some(c=>c.method==='POST'&&c.url==='/dsh-computer-use-win/api/restart'&&c.headers['x-wcu-request']==='1')");
  await until("document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='restarting'");
  assert.ok(await evaluate("document.querySelector('[data-wincu-update-dialog]').textContent.includes('稍后会自动重新打开')"));
  assert.equal(await evaluate("window.fetchCalls.some(c=>c.method==='POST'&&c.url==='/dsh-market/api/v1/restart')"),false);
  await savePicture('update-dialog-restarting.png');
  await evaluate("document.querySelector('[data-wincu-update-dialog]').close()");
  await until("!document.querySelector('[data-wincu-update-dialog]')");
  // A market that only needs the page reloaded offers that, and no restart note.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'succeeded',installedVersion:window.bump(window.V),outcome:{refreshRequired:true,restartRequired:false}}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='refresh'");
  await evaluate("document.querySelector('[data-wincu-update-dialog] button').click()");
  await until("!document.querySelector('[data-wincu-update-dialog]')");
  await until("!!document.querySelector('[data-wincu-update-refresh]')");
  assert.ok(await evaluate(updateText+".startsWith('已更新')"));
  assert.equal(await evaluate(noteText),'');
  // One that applied it live says so and nothing more.
  await recheck("window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'succeeded',installedVersion:window.bump(window.V),outcome:{refreshRequired:false,restartRequired:false}}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'&&document.querySelector('[data-wincu-update-dialog]')?.dataset.wincuUpdateDialog==='done'");
  await evaluate("document.querySelector('[data-wincu-update-dialog] button').click()");
  await until("!document.querySelector('[data-wincu-update-dialog]')");
  assert.equal(await evaluate(updateText),'已更新');
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-refresh],[data-wincu-update-restart]')"),false);
  // A newer version already on disk is an update waiting for the restart.
  await recheck("window.fakeMarket({installed:window.bump(window.V),latest:window.bump(window.V),available:false})");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'");
  assert.equal(await evaluate("document.querySelector('[data-wincu-update=updated] span').title"),'已更新到 v'+await evaluate('window.bump(window.V)'));
  // Progress: the step the market reports, the bytes while the package
  // downloads, and Stop update until the market starts replacing the files.
  // The plugin is asked first whether its folder can be replaced.
  await recheck("window.market=window.fakeMarket({ready:'free',installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'running',progress:{phase:null}},{state:'running',progress:{phase:'resolving'}},{state:'running',progress:{phase:'downloading',downloaded:131072,size:524288}},{state:'running',progress:{phase:'downloading',downloaded:393216,size:524288}},{state:'running',progress:{phase:'linking'}},{state:'running',progress:{phase:'linking'}},{state:'succeeded',installedVersion:window.bump(window.V)}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("window.seenStages=[];window.stageWatch=setInterval(()=>{const s=document.querySelector('[data-wincu-update-stage]')?.dataset.wincuUpdateStage;if(s&&window.seenStages.at(-1)!==s)window.seenStages.push(s);},20);document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-stage=download] [data-wincu-update-bytes]')?.textContent.trim()==='384 KB / 512 KB'");
  assert.ok(await evaluate("(b=>!!b&&!b.disabled&&b.textContent==='停止更新')(document.querySelector('[data-wincu-update-stop]'))"),'Stop update is offered while the package downloads');
  assert.equal(await evaluate("document.querySelector('[data-wincu-update-stage] [role=progressbar]').getAttribute('aria-valuenow')"),'75','The bar shows the bytes');
  await savePicture('update-progress-download.png');
  await until("!!document.querySelector('[data-wincu-update-stage=install]')");
  assert.ok(await evaluate("(b=>b.disabled&&b.title.includes('不能停止'))(document.querySelector('[data-wincu-update-stop]'))"),'Stop is unavailable while the market replaces the files, and says why');
  assert.ok(await evaluate("document.querySelector('[data-wincu-update-stage=install]').textContent.startsWith('正在安装')"));
  await savePicture('update-progress-install.png');
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'");
  await evaluate("clearInterval(window.stageWatch);document.querySelector('[data-wincu-update-dialog] button')?.click()");
  assert.ok(await evaluate("(s=>['resolve','download','install'].every((x,i,a)=>s.includes(x)&&(i===0||s.indexOf(x)>s.indexOf(a[i-1]))))(window.seenStages)"),'Steps in order: '+await evaluate("window.seenStages.join(',')"));
  assert.ok(await evaluate("(c=>{const ready=c.findIndex(x=>x.url==='/dsh-computer-use-win/api/update-ready'),post=c.findIndex(x=>x.method==='POST'&&x.url==='/dsh-market/api/v1/updates');return ready>=0&&ready<post})(window.fetchCalls)&&window.market.o.readyHeader==='1'"),'The folder check comes before the update request');
  // Stop update while the package downloads: a cancel the market cannot take
  // yet (pnpm not started) is sent again, the market stops, and the plugin is
  // the version it was.
  await recheck("window.market=window.fakeMarket({ready:'free',cancelStatus:[400,200],installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'running',progress:{phase:'downloading',downloaded:65536,size:524288}},...Array(40).fill({state:'running',progress:{phase:'downloading',downloaded:65536,size:524288}})]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("!!document.querySelector('[data-wincu-update-stage=download] [data-wincu-update-stop]:not(:disabled)')");
  await evaluate("document.querySelector('[data-wincu-update-stop]').click()");
  await until("document.querySelector('[data-wincu-update-note=stopped]')?.textContent==='已停止更新，插件还是 v'+window.V+'。'&&!!document.querySelector('[data-wincu-update-now]')");
  assert.equal(await evaluate("window.market.o.cancels"),2,'The cancel is sent again once the market can take it');
  assert.equal(await evaluate("window.__wcuUpdateTest.state().failure"),null,'A stop is not a failure');
  await savePicture('update-stopped.png');
  // A stop that comes as the market begins replacing the files is not sent:
  // the update finishes, and the page says why it went on.
  await recheck("window.market=window.fakeMarket({ready:'free',installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'running',progress:{phase:'downloading',downloaded:65536,size:524288}},{state:'running',progress:{phase:'linking'}},{state:'running',progress:{phase:'linking'}},{state:'running',progress:{phase:'linking'}},{state:'succeeded',installedVersion:window.bump(window.V)}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("!!document.querySelector('[data-wincu-update-stage=download] [data-wincu-update-stop]:not(:disabled)')");
  await evaluate("document.querySelector('[data-wincu-update-stop]').click()");
  await until("document.querySelector('[data-wincu-update-stop-late]')?.textContent.startsWith('已经开始安装')");
  await until("document.querySelector('[data-wincu-update]')?.dataset.wincuUpdate==='updated'");
  await evaluate("document.querySelector('[data-wincu-update-dialog] button')?.click()");
  assert.equal(await evaluate("window.market.o.cancels??0"),0,'No cancel reaches the market once the swap began');
  // Stop update while waiting for the market to pick up the release: nothing
  // was sent to the market.
  await recheck("window.market=window.fakeMarket({ready:'free',installed:window.V,latest:window.V,npm:window.bump(window.V),available:false,operations:[]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("window.__wcuUpdateSyncMs=200;window.fetchCalls=[];document.querySelector('[data-wincu-update-now]').click()");
  await until("!!document.querySelector('[data-wincu-update-note=syncing] [data-wincu-update-stop]:not(:disabled)')");
  await evaluate("document.querySelector('[data-wincu-update-stop]').click()");
  await until("!!document.querySelector('[data-wincu-update-note=stopped]')&&!!document.querySelector('[data-wincu-update-now]')");
  assert.equal(await evaluate(posts+".length"),0,'Stopping while the market catches up sends no update');
  await evaluate("window.__wcuUpdateSyncMs=40;void 0");
  // Something holds the plugin's folder: the update is not started, so the
  // plugin cannot be left half replaced, and the market is not offered (it
  // would meet the same folder).
  await recheck("window.market=window.fakeMarket({ready:'locked',installed:window.V,latest:window.bump(window.V),available:true,operations:[]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("window.fetchCalls=[];document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-failure=UPDATE_LOCKED]')?.textContent.startsWith('插件的文件夹正被别的程序占用')&&!!document.querySelector('[data-wincu-update-retry]')");
  assert.equal(await evaluate(posts+".length"),0,'A held plugin folder starts no update');
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-fallback]')"),false);
  await savePicture('update-locked.png');
  // An update that fails: the page offers the plugin market's Installed tab,
  // through the market's own client service, searched for this plugin.
  await evaluate("window.marketRenders=[];window.ctx.reflect={get:name=>name==='market'?{version:1,render:props=>{window.marketRenders.push(props);return React.createElement('div',{'data-fake-market-panel':props.preferredSubsectionId},'market panel')}}:undefined};void 0");
  const failingMarket="window.market=window.fakeMarket({ready:'free',installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'failed',failure:{code:'UPDATE_FAILED',message:'pnpm exited 1',retryable:true}}]})";
  await recheck(failingMarket);
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-fallback]')?.textContent.includes('市场收录新版本比 npm 晚一些')&&document.querySelector('[data-wincu-update-failure=UPDATE_FAILED]').title==='pnpm exited 1'");
  await savePicture('update-failed-fallback.png');
  await evaluate("document.querySelector('[data-wincu-open-market]').click()");
  await until("document.querySelector('[data-wincu-market-dialog] [data-fake-market-panel]')?.dataset.fakeMarketPanel==='installed:dsh-computer-use-win'&&document.querySelector('[data-wincu-market-dialog]').open");
  await savePicture('update-market-dialog.png');
  await evaluate("window.fetchCalls=[];document.querySelector('[data-wincu-market-close]').click()");
  await until("!document.querySelector('[data-wincu-market-dialog]')&&window.fetchCalls.some(c=>c.url==='/dsh-market/api/v1/updates?name=dsh-computer-use-win&force=1')");
  // Without that service: the market's settings entry, then its Installed tab.
  await evaluate("window.ctx.reflect=undefined;window.marketNav=0;window.marketTab=0;document.getElementById('fake-nav').insertAdjacentHTML('beforeend','<button class=\"x_navCell_2\" id=\"fake-market-nav\"><svg></svg><span>插件市场</span></button>');document.getElementById('fake-market-nav').onclick=()=>{window.marketNav++;document.body.insertAdjacentHTML('beforeend','<div id=\"fake-market\"><button id=\"fake-installed\">已安装</button></div>');document.getElementById('fake-installed').onclick=()=>window.marketTab++;};void 0");
  await recheck(failingMarket);
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("!!document.querySelector('[data-wincu-open-market]')");
  await evaluate("document.querySelector('[data-wincu-open-market]').click()");
  await until("window.marketNav===1&&window.marketTab===1");
  await evaluate("document.getElementById('fake-market-nav').remove();document.getElementById('fake-market').remove();void 0");
  // Neither: the page says where to go.
  await recheck(failingMarket);
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("!!document.querySelector('[data-wincu-open-market]')");
  await evaluate("document.querySelector('[data-wincu-open-market]').click()");
  await until("document.querySelector('[data-wincu-market-missing]')?.textContent.includes('设置 → 插件市场 → 已安装')");
  // A failure after which the market no longer lists the plugin: the page
  // says how to get it back, and offers no fallback that cannot help.
  await recheck("window.market=window.fakeMarket({ready:'free',removeOnFailure:true,installed:window.V,latest:window.bump(window.V),available:true,operations:[{state:'failed',failure:{code:'UPDATE_FAILED',message:'EPERM',retryable:true}}]})");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("document.querySelector('[data-wincu-update-now]').click()");
  await until("document.querySelector('[data-wincu-update-failure=PLUGIN_REMOVED]')?.textContent.startsWith('这次没有更新成功，插件市场还把插件从 DSH 里移除了')");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-update-fallback]')"),false);
  await evaluate("window.__wcuUpdateTest.reset();window.fetchCalls=[];window.fakeFetch=null;window.__wcuUpdateTest.check()");
  await until("window.__wcuUpdateTest.state().phase==='unknown'");
  await evaluate("window.fakeFetch=window.fakeMarket({installed:window.V,latest:window.bump(window.V),available:true,operations:[]});window.root.render(React.createElement('span',null,'closed'))");
  await evaluate("window.renderPage('zh')");
  await until("!!document.querySelector('[data-wincu-update-now]')");
  await evaluate("window.selectDesktop=value=>document.getElementById('wincu-page-desktopTarget-'+value).click();window.selectDesktop('hyperv')");
  await until("!!document.getElementById('wincu-page-hypervVm')");
  assert.equal(await evaluate("document.getElementById('wincu-page-browserAttachUser').disabled"),true,'An isolated task cannot attach to the host browser');
  await evaluate("window.setOverlayInput('hypervVm','Wincu fixture VM');window.clickButton('保存更改')");
  await until("window.snapshot.value.desktopTarget==='hyperv'&&window.snapshot.value.hypervVm==='Wincu fixture VM'");
  await evaluate("window.previousFetch=window.fakeFetch;window.fakeFetch=call=>call.url==='/dsh-computer-use-win/api/hyperv'?{status:200,body:{ok:true}}:window.previousFetch(call);window.clickButton('配置连接')");
  await until("document.querySelector('[data-wincu-hyperv-result]')?.textContent.includes('连接已配置')");
  assert.equal(await evaluate("window.fetchCalls.filter(call=>call.url==='/dsh-computer-use-win/api/hyperv'&&call.method==='POST').length"),1,'Credential setup starts only after the explicit action');
  // The Hyper-V choice explains itself and lists its setup steps; a result
  // names the step that fixes it, in its tone, with Windows' words in the tooltip.
  assert.equal(await evaluate("document.querySelector('[data-wincu-desktop-hint]').textContent.startsWith('在 Hyper-V 虚拟机里操作')"),true);
  assert.equal(await evaluate("document.querySelectorAll('[data-wincu-hyperv-steps] li').length"),6);
  assert.equal(await evaluate("document.querySelector('[data-wincu-hyperv-steps] li:nth-child(2) code').textContent"),'Add-LocalGroupMember -SID S-1-5-32-578 -Member (whoami)');
  await evaluate("window.fakeFetch=call=>call.url==='/dsh-computer-use-win/api/hyperv'?{status:500,body:{ok:false,error:'WCU_HYPERV_PERMISSION: add your Windows account to the Hyper-V Administrators group, then sign out and back in.'}}:window.previousFetch(call);window.clickButton('配置连接')");
  await until("document.querySelector('[data-wincu-hyperv-result]')?.textContent.includes('见第 2 步')");
  assert.equal(await evaluate("(li=>li.dataset.tone+'|'+[...li.parentNode.children].indexOf(li))(document.querySelector('[data-wincu-hyperv-steps] li[data-tone]'))"),'error|1','The step to fix is marked');
  assert.ok(await evaluate("document.querySelector('[data-wincu-hyperv-result]').title.startsWith('WCU_HYPERV_PERMISSION')"));
  await evaluate("window.fakeFetch=call=>call.url==='/dsh-computer-use-win/api/hyperv'?{status:200,body:{ok:true,missing:'WCU_HYPERV_NODE_REQUIRED'}}:window.previousFetch(call);window.clickButton('配置连接')");
  await until("document.querySelector('[data-wincu-hyperv-result]')?.textContent.startsWith('登录信息已保存。还差第 3 步')");
  assert.equal(await evaluate("(li=>li.dataset.tone+'|'+[...li.parentNode.children].indexOf(li))(document.querySelector('[data-wincu-hyperv-steps] li[data-tone]'))"),'warning|2');
  await evaluate("window.selectDesktop('quiet')");
  await until("document.querySelector('[data-wincu-desktop-hint]').textContent.includes('照常用电脑')&&document.querySelectorAll('[data-wincu-quiet-notes] li').length===4&&!document.querySelector('[data-wincu-hyperv-steps]')");
  // Low disruption's notes start folded under 更多说明, like 更多选项 below, and open from it.
  assert.equal(await evaluate("(d=>[d.localName,d.open,d.querySelector('summary').textContent,d.querySelector('li').checkVisibility()].join('|'))(document.querySelector('[data-wincu-quiet-notes]'))"),'details|false|更多说明|false','The Low disruption notes start folded');
  await evaluate("document.querySelector('[data-wincu-quiet-notes] summary').click()");
  await until("document.querySelector('[data-wincu-quiet-notes]').open&&[...document.querySelectorAll('[data-wincu-quiet-notes] li')].every(li=>li.checkVisibility())");
  await evaluate("window.selectDesktop('hyperv')");
  await until("!!document.querySelector('[data-wincu-hyperv-steps]')&&!document.querySelector('[data-wincu-hyperv-result]')");
  await evaluate("window.selectDesktop('fast');window.clickButton('保存更改')");
  await until("window.snapshot.value.desktopTarget==='fast'&&document.querySelector('[data-wincu-desktop-hint]').textContent.includes('按 Esc 停止')");
  assert.equal(await evaluate("!!document.querySelector('[data-wincu-quiet-notes]')||!!document.getElementById('wincu-page-hypervVm')"),false);
  assert.ok(await evaluate("['browserVisible','browserSignIn','browserAttachUser'].every(key=>!document.getElementById('wincu-page-'+key).disabled)"),'Both local modes keep every browser control');
  await savePicture('work-mode-fast.png');
  // A choice saved before 0.6.3 (current or background desktop) reads as Low disruption.
  await evaluate("window.snapshot={...window.snapshot,value:{...window.snapshot.value,desktopTarget:'background'}};for(const fn of window.listeners)fn()");
  await until("document.getElementById('wincu-page-desktopTarget-quiet').checked&&document.querySelectorAll('[data-wincu-quiet-notes] li').length===4");
  await savePicture('work-mode-quiet.png');
  await evaluate("window.renderPage('en')");
  await until("document.body.textContent.includes('Press Esc to stop')");
  await evaluate("window.snapshot={...window.snapshot,writable:false};for(const fn of window.listeners)fn()");
  await until("document.getElementById('wincu-page-tool-click').disabled");
  if((process.env.WCU_SETTINGS_TEST_API||'modern')==='modern'){assert((await evaluate('window.remoteMutations'))>10);assert((await evaluate('window.acceptedViews'))>10);}
  const report={passed:true,hintAbovePointer:true,api:process.env.WCU_SETTINGS_TEST_API||'modern',navigation:'settings.section/computer-use',compatibilityCard:true,atomicSave:true,draft:true,discard:true,errorPreservesValue:true,readOnly:true,preview:true,noSettingsResumeButton:true,allToolsDefault:true,outerPresets:['lite','full','lazy','custom'],lazySaveAndRemount:true,customSelectionPreserved:true,toolsCollapsedByDefault:true,quietNotesCollapsedByDefault:true,updateProgressSteps:true,updateStop:true,updateStopNotDuringSwap:true,updateFolderCheck:true,updateMarketFallback:true,updatePluginRemoved:true,individualAndGroupSelection:true,emptySelection:true,restoreAllTools:true,shortcutRecording:true,shortcutCombination:true,shortcutCancelAndBlurCleanup:true,shortcutClearDraft:true,restoreDefaultEsc:true,externalLinkButtons:true,cursorIndicatorIndependent:true,cursorIndicatorSaved:true,remoteVisibilityDefault:true,remoteVisibilitySaveAndRestore:true,themes:['light','dark'],nativeControlContrast:contrasts,languages:['zh','en'],physicalInputSent:false,screenshot:path.join(process.env.WCU_SETTINGS_TEST_ROOT,'settings-page.png')};
  fs.writeFileSync(path.join(process.env.WCU_SETTINGS_TEST_ROOT,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));win.destroy();app.quit();
}).catch(error=>{console.error(error.stack);app.exit(1)});

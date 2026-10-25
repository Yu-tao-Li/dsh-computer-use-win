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
  const savePicture=async name=>{for(let attempt=1;;attempt++){try{fs.writeFileSync(path.join(process.env.WCU_SETTINGS_TEST_ROOT,name),(await win.webContents.capturePage()).toPNG());return;}catch(error){if(attempt===3){console.error('capturePage failed for '+name+': '+error.message);return;}await new Promise(r=>setTimeout(r,200));}}};
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
  await evaluate(
    "window.writes=[];window.listeners=new Set();window.snapshot={value:{mode:'lite',indicatorEnabled:true,indicatorText:'DSH 正在控制电脑',indicatorPosition:'top',indicatorIdleMs:800,stopShortcut:''},revision:1,writable:true};window.failSave=false;window.entries=[];"+
    "window.scope={getSnapshot:()=>window.snapshot,subscribe:fn=>{window.listeners.add(fn);return ()=>window.listeners.delete(fn)},load:async()=>{},set:async(field,value)=>{window.writes.push({field,value});window.snapshot={...window.snapshot,value:{...window.snapshot.value,[field]:value}};for(const fn of window.listeners)fn()}};"+
    "window.definitions=[];window.ctx={effect:fn=>fn(),uiConversation:{events:{register:def=>window.definitions.push(def)}},locale:{register:(_ns,dict)=>{window.dictionary=dict;return ()=>{}},bind:()=>key=>window.dictionary.zh[key]},settingsScope:{bind:options=>{window.namespace=options.namespace;return window.scope}},slots:{inject:(_name,fn)=>{const result=fn();if(result&&typeof result.next==='function')for(const item of result){};return result},register:(entry,card)=>{window.entries.push({entry,card});return ()=>{}}},"+
    "connection:{api:{settings:{mutate:async request=>{if(window.failSave){window.failSave=false;return {result:{ok:false,message:'fixture rejected save'}}}if(request.expectedRevision!==window.snapshot.revision)throw Error('revision conflict');window.writes.push(request.ops);const value={...window.snapshot.value};for(const op of request.ops)value[op.path[0]]=JSON.parse(JSON.stringify(op.value));window.snapshot={...window.snapshot,value,revision:window.snapshot.revision+1};for(const fn of window.listeners)fn();return {result:{ok:true}}}}}}};"+
    "window.apiMode="+JSON.stringify(process.env.WCU_SETTINGS_TEST_API||'modern')+";window.ctx.configForms={get:ns=>{window.namespace=ns;return window.scope}};if(window.apiMode==='modern')window.scope.mutate=async(ops,revision)=>{const r=await window.ctx.connection.api.settings.mutate({ops,expectedRevision:revision});return r.result.ok};window.ctx.inject=(names,fn)=>{if(names.includes('uiConversation')||(window.apiMode==='modern'&&names.includes('configForms'))||(window.apiMode==='legacy'&&names.includes('settingsScope')))fn(window.ctx)};window.clientModule.apply(window.ctx);window.page=window.entries.find(x=>x.entry.name==='settings.section');"+
    "window.root=ReactDOM.createRoot(document.getElementById('app'));"+
    "window.renderPage=lang=>window.root.render(React.createElement(window.page.card,{...window.page.entry.inject(),t:key=>window.dictionary[lang][key]}));"+
    "window.renderPage('zh');"+
    "window.chooseTool=name=>document.getElementById('wincu-page-tool-'+name).click();window.choosePosition=value=>document.getElementById('wincu-page-indicatorPosition-'+value).click();"+
    "window.clickButton=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text).click();void 0;"
  );
  await until("!!document.getElementById('wincu-page-tool-screenshot')");
  assert.equal(await evaluate("document.querySelector('[data-wincu-tools]').open"),false,'Tool checklist must be collapsed by default');
  assert.equal(await evaluate("[...document.querySelectorAll('[data-wincu-tool]')].filter(x=>x.checked).length"),24,'All tools must be selected by default, including in an older lite profile');
  assert.equal(await evaluate("document.getElementById('wincu-page-toolPreset-full').checked"),true);
  assert.equal(await evaluate("document.querySelector('[data-wincu-tools]').hidden"),true,'Custom list belongs inside the Custom preset');
  await evaluate("document.getElementById('wincu-page-toolPreset-lite').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('10 / 24')");
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
  assert.ok(notice.text.includes('登录一次')&&notice.text.includes('不代填')&&notice.text.includes('以你的身份')&&notice.text.includes('调试端口'),'The notice says how to sign in and names the risks');
  assert.ok(!/inspect|remote-debugging|允许提示/.test(notice.text.replace('也不会弹出允许提示','')),'Nothing to set up in the user\'s own browser');
  assert.ok(notice.edge&&!notice.hidden,'The default browser may be Edge, so its Microsoft account sign-in is named');
  assert.ok(notice.inside&&notice.fits,'The notice fits the page');
  await chooseApp('chrome');
  await until("!document.querySelector('[data-wincu-signin-edge]')");
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
  await evaluate("window.renderPage('zh')");
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
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),23);
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
  await until("window.snapshot.value.enabledTools.length===24");
  await evaluate("window.chooseTool('drag')");
  await until("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存更改').disabled");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.enabledTools.length===23");
  await evaluate("document.getElementById('wincu-page-toolPreset-full').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('24 / 24')");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='full'");
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),23,'Presets must keep the custom selection');
  await evaluate("document.getElementById('wincu-page-toolPreset-lite').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('10 / 24')");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='lite'");
  await evaluate("document.getElementById('wincu-page-toolPreset-lazy').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('启动 1 项')");
  assert.equal(await evaluate("document.querySelector('[data-wincu-tools]').hidden"),true);
  assert.equal(await evaluate('window.snapshot.value.toolPreset'),'lite','Lazy stays a draft until saved');
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='lazy'");
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),23,'Lazy preserves custom restrictions for a later Custom selection');
  await evaluate("window.renderPage('en')");
  await until("document.getElementById('wincu-page-toolPreset-lazy').checked&&document.body.textContent.includes('1 at startup')");
  await evaluate("window.renderPage('zh')");
  await until("document.getElementById('wincu-page-toolPreset-lazy').checked&&document.body.textContent.includes('懒启动')");
  await new Promise(resolve=>setTimeout(resolve,100));
  await savePicture('settings-lazy.png');
  await evaluate("document.getElementById('wincu-page-toolPreset-custom').click()");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('23 / 24')");
  assert.equal(await evaluate("document.getElementById('wincu-page-tool-drag').checked"),false);
  await evaluate("window.clickButton('全选')");
  await until("document.querySelector('[data-wincu-tool-count]').textContent.includes('24 / 24')");
  await evaluate("window.clickButton('保存更改')");
  await until("window.snapshot.value.toolPreset==='custom'&&window.snapshot.value.enabledTools.length===24");
  await evaluate("window.clickButton('预览')");
  await until("window.snapshot.value.previewToken>0");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='恢复桌面控制')"),false,'A new task resumes automatically; no settings resume button is needed');
  await evaluate("window.key=init=>window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...init}));window.clickButton('录制快捷键')");
  await until("document.querySelector('[data-recording=true]')!==null");
  assert.equal(await evaluate("window.key({key:'Control',code:'ControlLeft',ctrlKey:true})"),false,'Recording must consume modifier keys');
  await evaluate("window.key({key:'F8',code:'F8',repeat:true})");
  assert.equal(await evaluate("!!document.querySelector('[data-recording=true]')"),true,'Auto-repeat must not record');
  await evaluate("window.key({key:'F8',code:'F8'})");
  await until("document.querySelector('.wcu-shortcut-value').textContent==='F8'");
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
  assert.equal(await evaluate("document.querySelector('.wcu-shortcut-value').textContent"),'Ctrl + Alt + K');
  await evaluate("window.clickButton('重新录制')");
  await until("!!document.querySelector('[data-recording=true]')");
  await evaluate("window.dispatchEvent(new Event('blur'))");
  await until("!document.querySelector('[data-recording=true]')");
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
  assert.equal(await evaluate('window.snapshot.value.enabledTools.length'),24,'Restoring the stop shortcut must preserve selected tools');
  // The support note collapses to one project link. The choice saves at once
  // and leaves a pending draft alone.
  await evaluate("document.getElementById('wincu-page-indicatorEnabled').click()");
  await until("!document.getElementById('wincu-page-indicatorEnabled').checked");
  await evaluate("document.querySelector('[data-wincu-note-toggle]').click()");
  await until("window.snapshot.value.communityNote==='link'&&document.querySelectorAll('[data-wincu-community] a').length===1");
  const compact=await evaluate("(()=>{const a=document.querySelector('[data-wincu-community] a');return {href:a.href,text:a.textContent,target:a.target,icons:a.querySelectorAll('svg').length,label:a.getAttribute('aria-label'),note:document.querySelector('[data-wincu-community]').textContent,toggle:document.querySelector('[data-wincu-note-toggle]').textContent,draft:!document.getElementById('wincu-page-indicatorEnabled').checked,saved:window.snapshot.value.indicatorEnabled}})()");
  assert.deepEqual([compact.href,compact.text,compact.target,compact.toggle],['https://github.com/Yu-tao-Li/dsh-computer-use-win','dsh-computer-use-win','_blank','展开']);
  assert.ok(compact.icons===2&&compact.label.includes('新窗口')&&!compact.note.includes('球球了'),'Compact note keeps one accessible project link');
  assert.ok(compact.draft&&compact.saved!==false,'Saving the note choice must neither save nor discard the pending draft');
  await evaluate("document.querySelector('[data-wincu-note-toggle]').click()");
  await until("window.snapshot.value.communityNote==='full'&&document.querySelector('[data-wincu-community]').textContent.includes('您来许愿，我来实现')");
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
  const contrasts=await evaluate(`(()=>{
    const root=document.documentElement;
    function ratio(a,b){const lum=s=>{const c=s.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
    function check(){return [...document.querySelectorAll('.wcu-control')].map(e=>{const s=getComputedStyle(e);return ratio(s.color,s.backgroundColor)})}
    const light=check();
    for(const [k,v] of Object.entries({'--dsw-alias-bg-layer-1':'#232324','--dsw-alias-bg-layer-2':'#2c2c2e','--dsw-alias-bg-layer-3':'#353638','--dsw-alias-label-primary':'#f9fafb','--dsw-alias-label-secondary':'#b7b9bd','--dsw-alias-border-l2':'#ffffff1f'}))root.style.setProperty(k,v);
    document.body.style.background='#2c2c2e';document.body.style.color='#f9fafb';return {light,dark:check()};
  })()`);
  assert.ok(contrasts.light.every(x=>x>=4.5)&&contrasts.dark.every(x=>x>=4.5),'Native control text must remain readable in both themes');
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
  await evaluate("window.renderPage('en')");
  await until("document.body.textContent.includes('Press Esc to stop')");
  await evaluate("window.snapshot={...window.snapshot,writable:false};for(const fn of window.listeners)fn()");
  await until("document.getElementById('wincu-page-tool-click').disabled");
  const report={passed:true,hintAbovePointer:true,api:process.env.WCU_SETTINGS_TEST_API||'modern',navigation:'settings.section/computer-use',compatibilityCard:true,atomicSave:true,draft:true,discard:true,errorPreservesValue:true,readOnly:true,preview:true,noSettingsResumeButton:true,allToolsDefault:true,outerPresets:['lite','full','lazy','custom'],lazySaveAndRemount:true,customSelectionPreserved:true,toolsCollapsedByDefault:true,individualAndGroupSelection:true,emptySelection:true,restoreAllTools:true,shortcutRecording:true,shortcutCombination:true,shortcutCancelAndBlurCleanup:true,shortcutClearDraft:true,restoreDefaultEsc:true,externalLinkButtons:true,cursorIndicatorIndependent:true,cursorIndicatorSaved:true,remoteVisibilityDefault:true,remoteVisibilitySaveAndRestore:true,themes:['light','dark'],nativeControlContrast:contrasts,languages:['zh','en'],physicalInputSent:false,screenshot:path.join(process.env.WCU_SETTINGS_TEST_ROOT,'settings-page.png')};
  fs.writeFileSync(path.join(process.env.WCU_SETTINGS_TEST_ROOT,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));win.destroy();app.quit();
}).catch(error=>{console.error(error.stack);app.exit(1)});

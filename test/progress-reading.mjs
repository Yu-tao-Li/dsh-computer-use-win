// Real WinForms reading and paint regression. No physical input, model calls,
// or user windows are manipulated. Screen samples have a synthetic backdrop.
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TakeoverControl} from '../mcp/takeover.mjs';
import {DEFAULT_SETTINGS} from '../mcp/settings.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'wcu-progress-reading-'));
const control=new TakeoverControl({testMode:true,powershell:process.env.WINDOWS_CU_POWERSHELL||'powershell.exe',config:{...DEFAULT_SETTINGS}});
control.disabledForTest=false;control.layoutFile=path.join(root,'layout.json');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let settings={...DEFAULT_SETTINGS,progressOverlayPosition:'custom',progressOverlayX:80,progressOverlayY:80,progressOverlayLocked:false};
let data={step:1,status:'thinking',tool:'阅读测试',reasoning:Array.from({length:26},(_,i)=>`思考第${i+1}行：正在核对当前页面。`).join('\n'),reply:Array.from({length:26},(_,i)=>`回复第${i+1}行：这是便于滚动阅读的进度。`).join('\n')};
const show=async()=>{await control.command('progress',{enabled:true,settings,progress:data});await pause(80);return control.command('status');};
const layout=async(width,height)=>{await control.command('test_progress_layout',{x:80,y:80,width,height});await pause(35);return control.command('status');};
const capture=async(name,screen=false)=>(await control.command('test_render_progress',{path:path.join(root,name),screen})).capture;
try{
 const initial=await control.command('status');
 let status=await show();
 assert.equal(status.foreground,initial.foreground,'Opening the reading pane must not activate');
 assert.equal(status.armed,false);assert.equal(status.progressReading.scrollbar,true);
 assert.equal(status.progressReading.resizeRedraw,true);
 assert.equal(status.progressBounds.width,360);assert.equal(status.progressBounds.height,240);
 assert.equal(status.progressOpacity,.6);
 {const reading=status.progressReading,free=status.progressBounds.height-reading.viewport.y-26*reading.dpiScale;
  assert.equal(reading.viewport.height%reading.lineHeight,0,'The reading area holds whole lines only, so no line is cut in half');
  assert.ok(reading.viewport.height>=2*reading.lineHeight&&reading.viewport.height>free-reading.lineHeight-1,'The smaller default must use every whole line that fits: '+JSON.stringify({...reading,text:undefined}));}
 assert.equal(status.progressReading.textAlpha,255);
 assert.ok(status.progressReading.scrollbarTrackAlpha<status.progressReading.scrollbarThumbAlpha);
 assert.ok(status.progressReading.scrollbarThumbAlpha<255);
 assert.ok(status.progressReading.lineHeight>=status.progressReading.emPixels,'Compact lines must still fit the glyph height');
 assert.ok(status.progressReading.lineHeight<=status.progressReading.emPixels*1.5+2,'Use compact single line spacing');
 assert.ok(!status.progressContent.includes('最近'));
 assert.ok(status.progressReading.maximum>status.progressReading.page);
 await control.command('test_progress_scroll',{lines:-10000});
 status=await control.command('status');assert.equal(status.progressReading.position,0);assert.equal(status.progressReading.following,false);
 data={...data,reply:data.reply+'\n新输出：保持正在阅读的位置。'};status=await show();
 assert.equal(status.progressReading.position,0,'New output must not pull a reader back to the bottom');
 await capture('reading-from-top.png');
 await control.command('test_progress_scroll',{lines:10000});
 status=await control.command('status');assert.equal(status.progressReading.atBottom,true);
 data={...data,reply:data.reply+'\n继续跟随最后一行。'};status=await show();
 assert.equal(status.progressReading.following,true,JSON.stringify({...status.progressReading,text:undefined}));assert.equal(status.progressReading.atBottom,true,JSON.stringify({...status.progressReading,text:undefined}));
 const bottom=status.progressReading.position;
 await control.command('test_progress_scroll',{wheel:true,delta:120});
 status=await control.command('status');assert.ok(status.progressReading.position<bottom,'Mouse wheel must scroll the native reader');
 assert.equal(status.progressReading.following,false);
 assert.equal((await control.command('test_progress_hittest',{x:25,y:20})).hit,2,'Header drags the window');
 assert.equal((await control.command('test_progress_hittest',{x:25,y:100})).hit,1,'Body is for reading, not window dragging');
 assert.equal((await control.command('test_progress_hittest',{x:359,y:150})).hit,11,'Right edge remains resizable');
 await control.command('test_progress_scroll',{lines:-10000});status=await control.command('status');
 const thumb=status.progressReading.thumb;
 await control.command('test_progress_scrollbar',{x:thumb.x+2,y:thumb.y+2,endY:thumb.y+65});
 status=await control.command('status');assert.ok(status.progressReading.position>0,'Dragging the translucent thumb scrolls the reader');
 for(const scale of [1,1.25,1.5,2]){
   await control.command('test_progress_dpi',{scale});status=await control.command('status');
   assert.equal(status.progressReading.dpiScale,scale);
   assert.ok(Math.abs(status.progressReading.emPixels-14.667*scale)<.1,'Fonts render at physical monitor resolution');
   await capture('reading-dpi-'+scale+'.png');
 }
 await control.command('test_progress_dpi',{scale:1});
 await control.command('test_progress_backdrop');
 await control.command('test_progress_resize_redraw',{enabled:false});
 for(let width=460;width<=800;width+=20)await layout(width,320+(width-440)/2);
 await pause(100);
 const legacy=await capture('resize-without-full-redraw.png',true);
 await control.command('test_progress_resize_redraw',{enabled:true});
 await layout(440,320);
 for(let width=460;width<=800;width+=20)await layout(width,320+(width-440)/2);
 await pause(100);
 const fixed=await capture('resize-with-full-redraw.png',true);
 assert.equal(legacy.strayHeaderPixels,0,'Per-pixel composition always replaces the full surface');
 assert.equal(fixed.strayHeaderPixels,0,'Continuous enlargement must leave no old borders or close buttons');
 for(let i=0;i<40;i++)await layout(i%2?440:820,i%2?320:620);
 assert.equal((await capture('resize-after-40-changes.png',true)).strayHeaderPixels,0);
 // Windows caps a window at its maximum tracking size, about the size of the
 // screen, so on a small screen (CI runners have 1024x768) the 1600 case comes
 // back narrower and shorter than asked.
 for(const [width,height] of [[240,160],[1600,1600],[440,320]]){
   status=await layout(width,height);
   if(width<=1000)assert.equal(status.progressBounds.width,width);
   else assert.ok(status.progressBounds.width>=1000&&status.progressBounds.width<=width,'Respect Windows maximum tracking width');
   assert.ok(status.progressBounds.height>=160&&status.progressBounds.height<=height,'Respect Windows maximum tracking height');
   assert.ok(status.progressReading.viewport.width>0&&status.progressReading.viewport.height>0);
   assert.ok(status.progressReading.viewport.y+status.progressReading.viewport.height<=status.progressBounds.height-24);
 }
 const unlockedLines=status.progressReading.viewport.height/status.progressReading.lineHeight;
 settings={...settings,progressOverlayLocked:true};status=await show();
 assert.equal(status.progressClickThrough,true);
 assert.ok(status.progressReading.viewport.height/status.progressReading.lineHeight>=unlockedLines,'A locked window gives its footer line to the text');
 assert.equal(status.progressReading.position%status.progressReading.lineHeight,0,'Following the output keeps the top line whole');
 assert.equal((await control.command('test_progress_hittest',{x:25,y:100})).hit,-1);
 settings={...settings,progressOverlayLocked:false};status=await show();assert.equal(status.progressClickThrough,false);
 data={step:2,status:'acting',tool:'',displayMode:'summary',summaries:[{step:2,text:'正在核对页面上的设置，确认保存后的结果。',final:false}]};
 status=await show();assert.equal(status.progressReading.text,'AI 总结 · 第 2 步\n正在核对页面上的设置，确认保存后的结果。');
 // Step history: one heading per step, older steps shortened, then the reply;
 // the finished state names the outcome, step count and time taken.
 const history={step:3,status:'done',startedAt:1000,endedAt:39000,steps:[
   {step:1,actions:[{label:'打开新标签页',state:'done'}],reasoning:'A'.repeat(600),reply:''},
   {step:2,actions:[{label:'连续执行 4 个操作：滚动页面',state:'done'},{label:'截图查看页面',state:'error'}],reasoning:'Scrolling to the end.',reply:''},
   {step:3,actions:[],reasoning:'Confirmed.',reply:'已经滚动到页面底部。'}]};
 data=history;status=await show();
 assert.ok(status.progressContent.startsWith('DSH · 已完成 · 3 步 · 38 秒'),status.progressContent.slice(0,80));
 assert.equal(status.progressReading.text,['第 1 步 · 打开新标签页','…'+'A'.repeat(239),'第 2 步 · 连续执行 4 个操作：滚动页面、截图查看页面（出错）','Scrolling to the end.','第 3 步','Confirmed.','回复','已经滚动到页面底部。'].join('\n'));
 data={...history,status:'stopped'};status=await show();assert.ok(status.progressContent.startsWith('DSH · 已停止 · 第 3 步'));
 data={...history,status:'acting',endedAt:0,action:'截图查看页面'};status=await show();
 assert.ok(status.progressContent.startsWith('DSH · 第 3 步 · 执行中\n截图查看页面'),status.progressContent.slice(0,60));
 data={...history,displayMode:'summary',summaries:[],summaryStatus:'working'};status=await show();
 assert.ok(status.progressReading.text.startsWith('第 1 步 · 打开新标签页\n第 2 步'),'Before the first summary the step names stand in');
 assert.ok(status.progressReading.text.endsWith('正在总结结果…'));
 data={...history,displayMode:'summary',summaries:[{step:2,text:'已打开搜索页并向下滚动。',final:false},{step:3,text:'已滚动到页面底部。',final:true}]};status=await show();
 assert.equal(status.progressReading.text,'AI 总结 · 第 2 步\n已打开搜索页并向下滚动。\nAI 总结 · 结果\n已滚动到页面底部。');
 await capture('history-finished.png');
 await capture('compact-summary.png');
 data={step:3,status:'waiting',tool:'',reasoning:'',reply:''};status=await show();
 assert.equal(status.progressReading.text,'等待 DSH 输出…');
 // The lock button. Resting the user's own pointer on the padlock unlocks the
 // window for adjusting; DSH's pointer never does (injected input, or a cursor
 // that got there without a physical move); being away locks it again. The
 // pointer is a test seam and moves are hook records fed through the real
 // parser, so the real cursor is never touched.
 settings={...settings,progressOverlayPosition:'custom',progressOverlayX:80,progressOverlayY:80,progressOverlayWidth:360,progressOverlayHeight:240,progressOverlayLocked:true};
 status=await show();assert.equal(status.progressClickThrough,true);
 assert.equal(status.pointerWatchActive,true,'A locked overlay installs the physical pointer watch');
 const lockCenter=value=>{const zone=value.progressHover.lockZone;return [value.progressBounds.x+zone.x+(zone.width>>1),value.progressBounds.y+zone.y+(zone.height>>1)];};
 const point=(x,y,hookFlags)=>control.command('test_progress_pointer',hookFlags===undefined?{x,y}:{x,y,hookFlags});
 let [bx,by]=lockCenter(status);
 await point(bx-150,by+150,0);await pause(80);
 await point(bx,by,1);await pause(700);
 status=await control.command('status');assert.equal(status.progressClickThrough,true,'Injected input resting on the lock button never unlocks');
 await point(bx-150,by+150,0);await point(bx,by);await pause(700);
 status=await control.command('status');assert.equal(status.progressClickThrough,true,'A cursor moved there without a physical move does not count');
 await point(bx,by,0);status=await control.command('status');
 assert.equal(status.progressHover.dwelling,true);assert.equal(status.progressClickThrough,true,'Passing over the button does not unlock at once');
 await capture('lock-button-dwell.png');
 await pause(650);status=await control.command('status');
 assert.equal(status.progressLocked,false);assert.equal(status.progressClickThrough,false,'Resting on the lock button unlocks the native window');
 assert.equal(status.progressHover.unlocked,true);assert.equal(status.armed,false);
 assert.equal((await control.command('test_progress_hittest',{x:25,y:20})).hit,2,'The unlocked header drags the window');
 await capture('lock-button-unlocked.png');
 await control.command('test_progress_layout',{x:120,y:90,width:420,height:300});
 let saved=JSON.parse(await readFile(control.layoutFile,'utf8'));
 assert.equal(saved.patch.progressOverlayWidth,420);assert.equal(saved.patch.progressOverlayLocked,true,'Adjusting saves the size and position, never an unlocked state');
 // Two quick adjustments: the settings keep the first, and its echo must not
 // move the window back; the newer layout is reported against the echo.
 await control.command('test_progress_layout',{x:140,y:100,width:440,height:310});
 settings={...settings,...saved.patch};status=await show();
 assert.equal(status.progressBounds.x,140,'An echo of an earlier report never moves the window back');assert.equal(status.progressBounds.width,440);
 saved=JSON.parse(await readFile(control.layoutFile,'utf8'));
 assert.equal(saved.patch.progressOverlayX,140);assert.equal(saved.base.progressOverlayX,120,'The newer layout is reported against the settings that arrived');
 settings={...settings,...saved.patch};status=await show();assert.equal(status.progressBounds.x,140);
 assert.equal(status.progressHover.unlocked,true,'Settings echoes keep a hover unlock');
 await point(bx+900,by+600);await pause(700);
 status=await control.command('status');assert.equal(status.progressLocked,false,'A short trip away keeps the window unlocked');
 await pause(1300);status=await control.command('status');
 assert.equal(status.progressLocked,true,'Being away locks the window again');assert.equal(status.progressClickThrough,true);
 [bx,by]=lockCenter(status);await point(bx,by,0);await pause(600);
 status=await control.command('status');assert.equal(status.progressLocked,false);
 const beforeLockClick=await readFile(control.layoutFile,'utf8');
 await control.command('test_progress_lock_click');
 status=await control.command('status');assert.equal(status.progressLocked,true,'Clicking the open padlock locks at once');assert.equal(status.progressClickThrough,true);
 await pause(700);status=await control.command('status');
 assert.equal(status.progressLocked,true,'A pointer still on the button after locking must leave before it unlocks again');
 assert.equal(await readFile(control.layoutFile,'utf8'),beforeLockClick,'Ending a hover unlock changes no setting');
 await point(bx-150,by+150,0);await point(bx,by,0);await pause(600);
 status=await control.command('status');assert.equal(status.progressLocked,false,'Coming back to the button unlocks again');
 // A window being adjusted stays when the task's overlay ends, until the user is done.
 await control.command('progress',{enabled:false,settings,progress:data});
 status=await control.command('status');assert.equal(status.progressVisible,true,'The overlay does not vanish under the pointer');
 await point(bx+900,by+600);await pause(2000);
 status=await control.command('status');assert.equal(status.progressVisible,false,'It goes once the pointer has left');
 // A window unlocked in the settings has no pointer watch; its padlock locks and saves.
 settings={...settings,progressOverlayLocked:false};status=await show();
 assert.equal(status.progressClickThrough,false);await pause(80);
 assert.equal((await control.command('status')).pointerWatchActive,false,'An unlocked window needs no pointer watch');
 assert.equal((await control.command('test_progress_hittest',{x:status.progressBounds.width-46,y:18})).hit,1,'Close sits beside the lock button');
 await control.command('test_progress_lock_click');
 assert.deepEqual(JSON.parse(await readFile(control.layoutFile,'utf8')).patch,{progressOverlayLocked:true},'Locking a window unlocked in the settings saves the lock');
 status=await control.command('status');assert.equal(status.progressLocked,true);
 // The adjustment preview unlocks the window only while it lasts: no lock
 // change is written back, a corner preset survives, and the next real
 // update is locked again.
 settings={...settings,progressOverlayPosition:'top-right',progressOverlayLocked:true};
 const layoutBefore=await readFile(control.layoutFile,'utf8').catch(()=>'');
 await control.command('progress',{enabled:true,preview:true,settings,progress:data});
 status=await control.command('status');assert.equal(status.progressLocked,false,'The preview can be dragged and resized');
 assert.equal(await readFile(control.layoutFile,'utf8').catch(()=>''),layoutBefore,'Opening the preview saves no lock change');
 await control.command('progress',{enabled:true,settings,progress:data});
 status=await control.command('status');assert.equal(status.progressLocked,true,'A real run after the preview is locked again');
 assert.equal(status.progressClickThrough,true);
 await control.command('progress',{enabled:true,preview:true,settings,progress:data});
 await control.command('test_progress_close_click');
 status=await control.command('status');assert.equal(status.progressVisible,false);
 assert.equal(JSON.parse(await readFile(control.layoutFile,'utf8')).patch.progressOverlayEnabled,false);
 console.log(JSON.stringify({passed:true,root,scrollbar:true,wheel:true,preservesReadingPosition:true,followsOnlyAtBottom:true,
   captionOnlyDrag:true,edgeResize:true,legacyTrailPixels:legacy.strayHeaderPixels,fixedTrailPixels:fixed.strayHeaderPixels,
   stressResizeChanges:76,minMaxSize:true,lockClickThrough:true,wholeLines:true,stepHistory:true,finishedHeader:true,compactSpacing:true,noRecentLabels:true,presetSurvivesUnlock:true,previewUnlockNotSaved:true,
   hoverUnlock:true,injectedHoverIgnored:true,movedCursorIgnored:true,dwellBeforeUnlock:true,relocksWhenAway:true,lockClickHolds:true,hoverUnlockNotSaved:true,echoNoSnapBack:true,closeWaitsForAdjusting:true,lockButtonSavesWhenUnlocked:true,
   nativeCloseClick:true,perPixelAlpha:true,opaqueText:true,translucentScrollbar:true,thumbDragging:true,dpiScales:[1,1.25,1.5,2],physicalInputSent:false,paidApiCalls:0}));
}finally{await control.close();}

// Real Win32 overlay/hook and event objects; key events are simulated inside
// the test-only helper seam. No keyboard/mouse input is sent to the desktop.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TakeoverControl, STOPPED } from '../mcp/takeover.mjs';
import { DEFAULT_SETTINGS, normalizeSettings } from '../mcp/settings.mjs';

assert.equal(normalizeSettings({stopShortcut:'Alt+Ctrl+K'}).stopShortcut,'Ctrl+Alt+K');
for(const stopShortcut of ['Esc','Ctrl','Ctrl+Ctrl+K','F25','Ctrl+😀',null])assert.throws(()=>normalizeSettings({stopShortcut}));

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-takeover-native-'));
const configFile = path.join(root, 'settings.json'), stateFile = path.join(root, 'state.json');
async function saveConfig(value) {
  const temporary = configFile + '.test-pending';
  await writeFile(temporary, JSON.stringify(value));
  // Unlike production's separate writer process, this fixture shares the event
  // loop with the watcher. Yield so its pending read can close the Windows handle.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, configFile); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 100) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
await saveConfig({ ...DEFAULT_SETTINGS, indicatorEnabled: false, indicatorIdleMs: 200 });
const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
// Settings are watched concurrently; publish complete JSON with an atomic rename.
const control = new TakeoverControl({ powershell, configFile, stateFile, testMode: true });
control.disabledForTest = false;
try {
  const initial = await control.command('status');
  await control.command('test_pointer_source',{x:200,y:200});
  await control.begin();
  const pointerOnly=await control.command('status');assert.equal(pointerOnly.armed, true);
  assert.equal(pointerOnly.windows,0,'Screen indicator can be off independently');
  assert.equal(pointerOnly.pointerVisible,true,'Pointer marker must work with screen indicator off: '+JSON.stringify(pointerOnly));
  assert.equal(pointerOnly.pointerClickThrough,true,'Pointer layer must be click-through and non-activating');
  assert.equal(pointerOnly.pointerCaptureExcluded,false,'Pointer marker must be visible to remote capture by default');
  assert.equal((await control.command('test_key', { vk: 0x1b, injected: true })).paused, false, 'Agent Esc must not stop takeover');
  assert.equal((await control.command('test_key', { vk: 0x41, injected: false })).paused, false, 'Other physical keys must not stop takeover');
  const stopped = await control.command('test_key', { vk: 0x1b, injected: false });
  assert.equal(stopped.paused, true); assert.equal(stopped.cancelled, true); assert.equal(stopped.windows, 0);
  assert.equal(stopped.pointerVisible,false,'Stop must immediately remove the pointer marker');
  assert.equal((await control.command('test_key',{vk:0x1b,down:false})).consumed,true,'Stopped Esc release must be consumed');
  const eventProbe = spawnSync(process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe', ['-NoProfile','-File',fileURLToPath(new URL('./takeover-event.ps1',import.meta.url)),'-CancelEvent',control.eventName,'-ExpectCancelled'],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(eventProbe.status,0,eventProbe.stderr);
  await control.end();
  const replacement = new TakeoverControl({ powershell, configFile, stateFile });
  await replacement.begin();
  assert.equal(replacement.paused,false,'A new standalone operation must not require a settings resume');
  await replacement.end();
  await replacement.close();
  await saveConfig({ ...DEFAULT_SETTINGS, indicatorEnabled: false, indicatorIdleMs: 200, resumeToken: 1 });
  await control.sync();
  assert.equal(control.paused, false); assert.equal((await control.command('status')).cancelled, false);
  let resumeToken=1;
  const configure=async stopShortcut=>{await saveConfig({...DEFAULT_SETTINGS,indicatorEnabled:false,indicatorIdleMs:200,resumeToken,stopShortcut});await control.sync();};
  const resume=async stopShortcut=>{await control.end();resumeToken++;await configure(stopShortcut);assert.equal(control.paused,false);};
  const key=async(vk,extra={})=>control.command('test_key',{vk,...extra});
  await configure('F8');await control.begin();
  assert.equal((await key(0x77,{injected:true})).paused,false,'Injected custom key must not stop');
  assert.equal((await key(0x78)).paused,false,'Unconfigured function key must not stop');await key(0x78,{down:false});
  assert.equal((await key(0x77)).paused,true,'Physical custom key must stop');
  assert.equal((await key(0x77)).consumed,true,'Stopped key repeat must be consumed');
  assert.equal((await key(0x77,{injected:true,down:false})).consumed,false,'Injected release must not reset physical state');
  assert.equal((await key(0x77,{down:false})).consumed,true,'Stopped custom key release must be consumed');
  await assert.rejects(control.begin(),error=>error.message===STOPPED);
  await resume('Ctrl+Alt+K');await control.begin();
  await key(0xA2,{injected:true});await key(0xA4,{injected:true});
  assert.equal((await key(0x4B)).paused,false,'Injected modifiers must not satisfy a physical combination');await key(0x4B,{down:false});
  await key(0xA3);await key(0xA4);await key(0xA0);
  assert.equal((await key(0x4B)).paused,false,'Additional modifiers must not match');await key(0x4B,{down:false});await key(0xA0,{down:false});
  assert.equal((await key(0x4B)).paused,true,'Physical combination must stop');
  assert.equal((await key(0xA3,{down:false})).consumed,false,'Modifier release must pass through');
  assert.equal((await key(0xA4,{down:false})).consumed,false);assert.equal((await key(0x4B,{down:false})).consumed,true);
  await resume('F9');await control.begin();const helperPid=control.child.pid;
  const cursorConfig=JSON.parse(await readFile(configFile,'utf8'));
  await saveConfig({...cursorConfig,cursorIndicatorEnabled:false});await control.sync();
  assert.equal((await control.command('status')).pointerVisible,false,'Pointer marker must turn off live');
  await saveConfig({...cursorConfig,cursorIndicatorEnabled:true});await control.sync();
  assert.equal((await control.command('status')).pointerVisible,true,'Pointer marker must turn on live');
  assert.equal(control.child.pid,helperPid,'Changing the marker must keep the worker alive');
  await configure('F10');assert.equal(control.child.pid,helperPid,'Shortcut changes must not restart active worker');
  assert.equal((await key(0x78)).paused,false,'Old shortcut must stop matching after update');await key(0x78,{down:false});
  assert.equal((await key(0x79)).paused,true,'Updated shortcut must stop');await key(0x79,{down:false});
  await resume('');await control.begin();assert.equal((await key(0x79)).paused,false,'Cleared shortcut must not stop');await key(0x79,{down:false});
  assert.equal((await key(0x1b)).paused,true,'Esc must remain available after clearing');await key(0x1b,{down:false});
  await resume('');
  const shown = await control.command('begin', { indicatorEnabled: true, indicatorIdleMs: 200 });
  assert.ok(shown.windows >= 1); assert.equal(shown.foreground, initial.foreground, 'Overlay must not activate');
  assert.equal(shown.overlayCaptureExcluded,false);assert.equal(shown.overlayClickThrough,true);
  const visibleConfig=JSON.parse(await readFile(configFile,'utf8'));
  await saveConfig({...visibleConfig,remoteIndicatorVisible:false});await control.sync();
  const excluded=await control.command('status');assert(excluded.overlayCaptureExcluded&&excluded.pointerCaptureExcluded,'Opt-out must exclude both layers live');
  await saveConfig({...visibleConfig,remoteIndicatorVisible:true});await control.sync();
  const visible=await control.command('status');assert(!visible.overlayCaptureExcluded&&!visible.pointerCaptureExcluded);
  const waitDisplays=async expected=>{const deadline=Date.now()+2500;for(;;){const state=await control.command('status');if(JSON.stringify(state.overlayBounds)===JSON.stringify(expected))return state;if(Date.now()>deadline)throw Error('Display topology did not refresh: '+JSON.stringify(state));await new Promise(r=>setTimeout(r,50));}};
  const virtualScreens=[{left:-1280,top:0,width:1280,height:720},{left:0,top:0,width:1920,height:1080}];
  await control.command('test_displays',{displays:virtualScreens});const attached=await waitDisplays(virtualScreens);
  assert(attached.displayRevision>shown.displayRevision);assert.equal(attached.foreground,initial.foreground);
  const resizedScreens=[{left:0,top:-900,width:1600,height:900}];
  await control.command('test_displays',{displays:resizedScreens});await waitDisplays(resizedScreens);
  await control.command('test_displays',{displays:[]});await waitDisplays([]);
  await control.command('test_displays',{displays:virtualScreens});await waitDisplays(virtualScreens);
  await control.command('test_restore_displays');await waitDisplays(shown.displays);
  const preview = path.join(root, 'takeover-preview.png');
  await control.command('test_render', { path: preview });
  const cursorPreview=path.join(root,'cursor-preview.png');
  await control.command('test_render_pointer',{path:cursorPreview});
  const negative=await control.command('test_pointer_layout',{x:-1000,y:100,left:-1920,top:0,width:1920,height:1080,scale:1.5});
  assert.equal(negative.left+36,-1000);assert.equal(negative.top+36,100);assert.equal(negative.width,180);
  const edge=await control.command('test_pointer_layout',{x:1919,y:1079,scale:2});
  assert.equal(edge.left+192,1919);assert.equal(edge.top+120,1079);
  await control.command('end');
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal((await control.command('status')).windows, 0, 'Idle overlay must fade and close');
  assert.equal((await control.command('status')).pointerVisible,false,'Idle marker must also disappear');
  const previewOnly=await control.command('preview',{indicatorEnabled:false,cursorIndicatorEnabled:true});
  assert.equal(previewOnly.windows,0);assert.equal(previewOnly.pointerVisible,true,'Preview must respect independent screen and pointer settings');
  await new Promise(resolve=>setTimeout(resolve,2150));
  assert.equal((await control.command('status')).pointerVisible,false,'Preview marker must clean itself up');
  const report = { passed: true, physicalInputSent: false, nativeHook: true, injectedEscIgnored: true,
    normalKeyIgnored: true, physicalEscStops: true, cancellationEvent: true, standaloneNextOperationAutoResumes: true,
    legacyResumeSignal: true, customKeyStops:true,customCombinationStops:true,injectedShortcutIgnored:true,injectedModifiersIgnored:true,exactModifiers:true,keyupAndRepeatConsumed:true,shortcutChangesLive:true,shortcutClearKeepsEsc:true,nativeOverlay: true, overlayWindows: shown.windows, noFocusSteal: true, idleCleanup: true,pointerMarker:true,pointerClickThrough:true,remoteCaptureVisibleByDefault:true,captureOptOutLive:true,virtualDisplayAttachResizeDetachReconnect:true,topologySource:'EnumDisplayMonitors',pointerIndependentSwitch:true,pointerLiveUpdates:true,pointerStopAndIdleCleanup:true,pointerNegativeMonitorAndDpiLayout:true,pointerPositionSource:'test-seam',liveCursorAvailable:initial.liveCursorAvailable,preview, cursorPreview, state: JSON.parse(await readFile(stateFile, 'utf8')) };
  await writeFile(path.join(root, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root, ...report }, null, 2));
} finally { await control.close(); }

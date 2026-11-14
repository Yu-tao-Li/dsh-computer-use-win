import assert from 'node:assert/strict';
import { TakeoverControl } from '../mcp/takeover.mjs';
const control=new TakeoverControl({testMode:true,locale:'zh',config:{indicatorEnabled:false,cursorIndicatorEnabled:false}});
control.disabledForTest=false;
try {
  const initial=await control.command('status');await control.begin();
  const status=await control.command('status');
  assert.equal(status.uiWindowCount,0,'Arming with decorative indicators disabled must not create an extra screen control');
  assert.equal(status.foreground,initial.foreground,'Arming must never activate a window');
  assert.equal((await control.command('test_key',{vk:0x1b,injected:true})).paused,false,'Marked agent Esc must pass');
  const remote=await control.command('test_key',{vk:0x1b,injected:true,extra:0});
  assert.equal(remote.paused,true,'Unmarked remote Esc must stop');assert.equal(remote.cancelled,true);
  assert.equal(remote.uiWindowCount,0);
  await control.command('test_key',{vk:0x1b,injected:true,extra:0,down:false});
  await control.end();await control.resumeOperation();await control.begin();
  await control.command('configure',{stopShortcut:'Ctrl+Alt+K'});
  await control.command('test_key',{vk:0x11,injected:true,extra:0});
  await control.command('test_key',{vk:0x12,injected:true,extra:0});
  const shortcut=await control.command('test_key',{vk:0x4b,injected:true,extra:0});
  assert.equal(shortcut.cancelled,true);assert.equal(shortcut.paused,true);assert.equal(shortcut.uiWindowCount,0);
  console.log('PASS marked agent Esc, unmarked remote Esc/custom shortcut parser, no extra screen UI and no activation');
} finally {await control.close();}

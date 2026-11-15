// Real helper processes, isolated shared-stop group and native cancellation events.
// Test-only keys run through the listener seam; no keys reach other applications.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TakeoverControl } from '../mcp/takeover.mjs';
const previous=process.env.WCU_TEST_STOP_GROUP;
const controls=[];
function control(group){
  process.env.WCU_TEST_STOP_GROUP=group;
  const result=new TakeoverControl({testMode:true,config:{indicatorEnabled:false,cursorIndicatorEnabled:false}});
  result.disabledForTest=false;controls.push(result);return result;
}
const group=`Local\\DSH-WCU-Test-Stop-${randomUUID()}`;
try {
  const a=control(group);await a.command('status');
  const b=control(group);await b.command('status');
  const other=control(group+'-other');await other.command('status');
  await a.begin();await b.begin();await other.begin();
  const stoppedAt=Date.now();
  await a.command('test_key',{vk:0x1b});
  let remote;
  do{remote=await b.command('status');if(remote.cancelled)break;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()-stoppedAt<1500);
  assert.equal(remote.cancelled,true,'Stopping one helper must cancel its peer');
  assert.equal(remote.paused,true);assert.equal(remote.armed,false);
  assert.equal((await other.command('status')).cancelled,false,'Other Windows/test groups must remain isolated');
  // Starting a new helper must not reset an already-stopped peer's event.
  const newcomer=control(group);await newcomer.command('status');
  assert.equal((await b.command('status')).cancelled,true);
  await newcomer.begin();
  assert.equal((await newcomer.command('status')).cancelled,false,'A new helper starts at the current generation');
  console.log(`PASS real cross-process stop broadcast (${Date.now()-stoppedAt} ms including newcomer startup), group isolation and cancellation retention`);
} finally {
  if(previous===undefined)delete process.env.WCU_TEST_STOP_GROUP;else process.env.WCU_TEST_STOP_GROUP=previous;
  await Promise.all(controls.map(c=>c.close()));
}

import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {McpTestClient} from './mcp-test-client.mjs';
const client=new McpTestClient(process.execPath,[fileURLToPath(new URL('../mcp/server.mjs',import.meta.url))],{env:{...process.env,WINDOWS_CU_POWERSHELL:process.env.WINDOWS_CU_POWERSHELL||'pwsh'}});
const call=(name,args)=>client.request('tools/call',{name:'windows_computer_use_'+name,arguments:args},15000);
try{
  await client.init();
  let sample;
  for(let n=0;n<3;n++){
    const result=await call('list_windows',{maxWindows:1,includeInvisible:false});
    assert.equal(result.isError,undefined);
    const data=JSON.parse(result.content.find(x=>x.type==='text').text);
    assert.equal(data.ok,true);assert.ok(data.windows.length<=1);
    for(const win of data.windows){assert.match(win.id,/^uia:hwnd:\d+:pid:\d+$/);assert.equal(win.isOffscreen,false);sample=win;}
  }
  assert.ok(sample,'An interactive desktop with a visible window is required');
  const wrongOwner=sample.id.replace(/:pid:\d+$/,':pid:0');
  const stale=await call('element_info',{elementId:wrongOwner});
  assert.equal(stale.isError,true);
  console.log('PASS three bounded native enumerations and mismatched HWND/PID rejection; no window titles printed');
}finally{
  client.child.stdin.end();
  const timer=setTimeout(()=>client.child.kill(),4000);
  if(client.child.exitCode===null)await new Promise(resolve=>client.child.once('exit',resolve));
  clearTimeout(timer);
}

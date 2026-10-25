// Exercise the shipped server over MCP without desktop input or mock backends.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {McpTestClient} from './mcp-test-client.mjs';
import {TOOL_NAMES,enabledToolsForSettings,toolSelectionKey,normalizeSettings} from '../mcp/settings.mjs';
import {bridgeConfig} from '../mcp/dsh-plugin.mjs';
const prefix='windows_computer_use_',reports=[];
const data=result=>{assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content[0].text)};
assert.deepEqual(enabledToolsForSettings({toolPreset:'lazy',enabledTools:[]}),TOOL_NAMES);
assert.notEqual(toolSelectionKey({toolPreset:'full'}),toolSelectionKey({toolPreset:'lazy'}));
assert.equal(normalizeSettings({}).toolPreset,'full');
const lazy=bridgeConfig({toolPreset:'lazy',enabledTools:['wait']});
assert.equal(lazy.env.WCU_TOOL_MODE,'lazy');
assert.deepEqual(JSON.parse(lazy.env.WCU_ENABLED_TOOLS),TOOL_NAMES);
for(const [preset,selection] of [['lazy',TOOL_NAMES],['lazy',null],['lite',enabledToolsForSettings({toolPreset:'lite'})],['custom',['wait','tools']],['custom',['tools']],['full',TOOL_NAMES]]){
  const env={...process.env,WCU_TOOL_MODE:preset==='lazy'?'lazy':'full',WCU_TEST_NO_TAKEOVER:'1'};
  delete env.WCU_ENABLED_TOOLS;
  if(selection)env.WCU_ENABLED_TOOLS=JSON.stringify(selection);
  const client=new McpTestClient(process.execPath,[fileURLToPath(new URL('../mcp/server.mjs',import.meta.url))],{env});
  const manage=args=>client.call(prefix+'tools',args),list=async()=>(await client.request('tools/list')).tools;
  try{
    const init=await client.init();
    assert.equal(init.capabilities.tools.listChanged,true);
    const initial=await list(),allowed=(selection||TOOL_NAMES).filter(n=>n!=='tools');
    // A management-only startup advertises no tool whose name states a desktop
    // capability, so the server must state it in instructions instead. A Custom
    // checklist that allows no desktop tool is excluded: enabling one is refused,
    // so claiming the capability would contradict the user's setting.
    const managementOnly=initial.length===1&&initial[0].name===prefix+'tools'&&allowed.length>0;
    assert.equal(Object.hasOwn(init,'instructions'),allowed.length>0,'Routing guidance accompanies every usable preset, including lazy startup');
    if(managementOnly){
      assert.match(init.instructions,/screenshots/i);
      assert.match(init.instructions,/OCR/i);
      assert.match(init.instructions,/enable/);
    }
    if(initial.length===1&&initial[0].name===prefix+'tools'&&!allowed.length){
      assert.doesNotMatch(initial[0].description,/reads and operates real Windows apps/,'A no-desktop-tool selection must not advertise the capability');
    }
    if(preset==='lazy'){
      assert.deepEqual(initial.map(t=>t.name),[prefix+'tools']);
      assert.match(initial[0].description,/enable tools before desktop use/);
      assert.equal(data(await manage({})).mode,'lazy');
      assert.ok(data(await manage({})).tools.every(t=>t.available&&!t.enabled));
      assert.ok(!initial.some(t=>t.name===prefix+'wait'),'Desktop schemas are absent until enabled');
    }
    for(const args of [{operation:'enable',names:['*','drag']},{operation:'disable',names:['*','unknown']},{operation:'describe',names:['*']},{operation:'reset',names:['*']},{operation:'enable',names:['wait','unknown']}]){
      const count=client.notifications.length;
      assert.equal((await manage(args)).isError,true);
      assert.deepEqual(await list(),initial,'Invalid batches must not partially mutate');
      assert.equal(client.notifications.length,count);
    }
    const before=client.notifications.length;
    data(await manage({operation:'enable',names:['*']}));
    const loaded=await list();
    assert.deepEqual(loaded.map(t=>t.name).sort(),[...allowed,'tools'].map(n=>prefix+n).sort());
    assert.equal(client.notifications.length,before+(loaded.length===initial.length?0:1));
    const count=client.notifications.length;
    data(await manage({operation:'enable',names:['*']}));
    assert.equal(client.notifications.length,count,'Repeated enable is idempotent');
    if(!allowed.includes('drag'))assert.equal((await manage({operation:'enable',names:['drag']})).isError,true);
    data(await manage({operation:'disable',names:['*']}));
    assert.deepEqual((await list()).map(t=>t.name),[prefix+'tools'],'Wildcard cannot remove management');
    if(allowed.includes('wait')&&allowed.includes('drag')){
      data(await manage({operation:'enable',names:['wait',prefix+'drag','wait']}));
      assert.equal((await list()).length,3,'Existing multi-name batches and prefixes still work');
      const bad=await client.call(prefix+'drag',{path:[{x:1,y:2},{x:2,y:'bad'}]});
      assert.equal(bad.isError,true,'Execution schema validation remains intact');
      const described=data(await manage({operation:'describe',names:['drag']}));
      assert.ok(described.inputSchema.properties.path);
    }
    data(await manage({operation:'reset'}));
    assert.deepEqual(await list(),initial);
    reports.push({preset,explicitSelection:selection!==null,startupTools:initial.length,characters:JSON.stringify({tools:initial}).length,allowedDesktopTools:allowed.length,batchAtomicity:true,wildcard:true,reset:true});
  }finally{client.close()}
}
// #39: settings the adapter reset to defaults reach the agent through the
// tools list, and stay out of it when nothing was reset.
const notice={settingsRepaired:['enabledTools: "removed_tool"']};
assert.deepEqual(JSON.parse(bridgeConfig({},{notices:notice}).env.WCU_ADAPTER_NOTICES),notice);
assert.equal(bridgeConfig({},{}).env.WCU_ADAPTER_NOTICES,undefined);
for(const notices of [notice,null]){
  const env={...process.env,WCU_TOOL_MODE:'full',WCU_TEST_NO_TAKEOVER:'1'};
  delete env.WCU_ENABLED_TOOLS;delete env.WCU_ADAPTER_NOTICES;
  if(notices)env.WCU_ADAPTER_NOTICES=JSON.stringify(notices);
  const client=new McpTestClient(process.execPath,[fileURLToPath(new URL('../mcp/server.mjs',import.meta.url))],{env});
  try{
    await client.init();
    const listed=data(await client.call(prefix+'tools',{operation:'list'}));
    assert.deepEqual(listed.notices,notices??undefined);
  }finally{client.close()}
}
console.log(JSON.stringify({passed:true,reports,adapterNotices:true},null,2));

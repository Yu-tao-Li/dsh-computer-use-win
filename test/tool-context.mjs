// Public MCP discovery, schema parity and load/reset behavior; no desktop input.
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,writeFile,readFile,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpTestClient} from './mcp-test-client.mjs';
import {TOOL_NAMES,LITE_TOOL_NAMES,normalizeEnabledTools,normalizeSettings,enabledToolsForSettings} from '../mcp/settings.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-tool-context-'));
await cp(new URL('../mcp',import.meta.url),path.join(root,'mcp'),{recursive:true,filter:source=>!/^FILE_(LOG|INDEX|HISTORY)\./.test(path.basename(String(source)))&&!String(source).endsWith('.file-log.lock')});
await mkdir(path.join(root,'scripts'));
const marker=path.join(root,'started.txt').replaceAll("'","''");
await writeFile(path.join(root,'scripts/windows-uia.ps1'),`param([switch]$Persistent)
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
[IO.File]::AppendAllText('${marker}','started')
while($null -ne ($line=[Console]::In.ReadLine())) {
  $r=$line | ConvertFrom-Json
  [Console]::WriteLine((@{id=$r.id;ok=$true;action=$r.action;args=$r.args} | ConvertTo-Json -Depth 20 -Compress))
}
`);
const prefix='windows_computer_use_', reports=[];
const data=r=>JSON.parse(r.content[0].text);
const stripDescriptions=value=>Array.isArray(value)?value.map(stripDescriptions):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='description').map(([key,child])=>[key,stripDescriptions(child)])):value;
for(const mode of ['lite','full']) {
  const env={...process.env,WCU_TOOL_MODE:mode};delete env.WCU_ENABLED_TOOLS;
  const client=new McpTestClient(process.execPath,[path.join(root,'mcp/server.mjs')],{env});
  const manage=args=>client.call(prefix+'tools',args);
  try {
    assert.equal((await client.init()).capabilities.tools.listChanged,true);
    const initial=(await client.request('tools/list')).tools;
    assert.equal(initial.length,mode==='lite'?LITE_TOOL_NAMES.length:TOOL_NAMES.length);
    const catalogue=data(await manage({}));assert.equal(catalogue.tools.length,TOOL_NAMES.length-1);
    for(const advertised of initial.filter(t=>t.name!==prefix+'tools')) {
      const described=data(await manage({operation:'describe',names:[advertised.name]}));
      assert.deepEqual(stripDescriptions(advertised.inputSchema),stripDescriptions(described.inputSchema));
    }
    if(mode==='lite') assert.equal(await access(path.join(root,'started.txt')).then(()=>true,()=>false),false,'Discovery must not start PowerShell');
    const notificationCount=client.notifications.length;
    assert.equal((await manage({operation:'enable',names:['drag','unknown']})).isError,true);
    assert.equal(client.notifications.length,notificationCount);
    assert.deepEqual((await client.request('tools/list')).tools,initial,'Invalid names cannot partially enable tools');
    assert.equal((await manage({operation:'describe',names:[]})).isError,true);
    assert.equal((await manage({operation:'enable'})).isError,true);
    assert.equal((await manage({operation:'reset',names:['drag']})).isError,true);
    await manage({operation:'disable',names:['wait']});
    let count=client.notifications.length;
    await manage({operation:'enable',names:['wait','drag']});
    assert.equal(client.notifications.length,count+1);
    assert.ok((await client.request('tools/list')).tools.some(t=>t.name===prefix+'wait'));
    count=client.notifications.length;
    await manage({operation:'enable',names:['wait','drag']});
    assert.equal(client.notifications.length,count,'Idempotent load must not notify');
    const invalid=await client.call(prefix+'drag',{path:[{x:1,y:2},{x:2,y:'3'}]});assert.equal(invalid.isError,true);
    const result=data(await client.call(prefix+'wait',{milliseconds:1}));assert.equal(result.args.milliseconds,1);
    await manage({operation:'disable',names:['drag']});
    assert.ok(!(await client.request('tools/list')).tools.some(t=>t.name===prefix+'drag'));
    await manage({operation:'reset'});assert.deepEqual((await client.request('tools/list')).tools,initial);
    reports.push({mode,toolCount:initial.length,characters:JSON.stringify({tools:initial}).length,transcript:client.transcript});
  } finally {client.close()}
}
const ui=await readFile(new URL('../mcp/client.js',import.meta.url),'utf8');
assert.deepEqual(ui.match(/const allToolNames='([^']+)'/)[1].split(' '),TOOL_NAMES,'UI and backend must use the same catalogue');
assert.deepEqual(normalizeSettings({mode:'lite'}).enabledTools,TOOL_NAMES,'Legacy profiles default to all tools');
assert.equal(normalizeSettings({}).toolPreset,'full');
assert.equal(normalizeSettings({enabledTools:['wait']}).toolPreset,'custom','Migrate saved .11 selections');
assert.deepEqual(enabledToolsForSettings({toolPreset:'lite',enabledTools:[]}),LITE_TOOL_NAMES);
assert.deepEqual(enabledToolsForSettings({toolPreset:'full',enabledTools:[]}),TOOL_NAMES);
assert.deepEqual(enabledToolsForSettings({toolPreset:'custom',enabledTools:[]}),[]);
assert.throws(()=>normalizeSettings({toolPreset:'unknown'}));
assert.deepEqual(normalizeEnabledTools(['wait','screenshot','wait']),TOOL_NAMES.filter(x=>['wait','screenshot'].includes(x)));
for(const invalid of [null,'wait',['unknown'],['wait',1],Array(TOOL_NAMES.length+1).fill('wait')])assert.throws(()=>normalizeEnabledTools(invalid));
for(const selection of [['screenshot','wait','tools'],['wait'],[],[...TOOL_NAMES]]){
  const client=new McpTestClient(process.execPath,[path.join(root,'mcp/server.mjs')],{env:{...process.env,WCU_TOOL_MODE:'lite',WCU_ENABLED_TOOLS:JSON.stringify(selection)}});
  try {
    await client.init();
    const initial=(await client.request('tools/list')).tools;
    assert.deepEqual(initial.map(t=>t.name).sort(),selection.map(x=>prefix+x).sort());
    if(!selection.includes('click')){
      const denied=await client.call(prefix+'click',{x:1,y:1});
      assert.equal(denied.isError,true);assert.match(denied.content[0].text,/TOOL_DISABLED_IN_SETTINGS/);
    }
    if(selection.includes('tools')){
      const catalogue=data(await client.call(prefix+'tools',{}));
      assert.equal(catalogue.mode,selection.length===TOOL_NAMES.length?'full':'custom');
      assert.equal(catalogue.tools.find(x=>x.name==='drag').available,selection.includes('drag'));
      if(!selection.includes('drag')){
        const denied=await client.call(prefix+'tools',{operation:'enable',names:['wait','drag']});
        assert.equal(denied.isError,true);assert.match(denied.content[0].text,/TOOL_DISABLED_IN_SETTINGS/);
        assert.deepEqual((await client.request('tools/list')).tools,initial);
      }
      await client.call(prefix+'tools',{operation:'disable',names:['wait']});
      await client.call(prefix+'tools',{operation:'reset'});
      assert.deepEqual((await client.request('tools/list')).tools,initial,'Reset must preserve user restrictions');
    }else{
      const denied=await client.call(prefix+'tools',{});
      assert.equal(denied.isError,true);assert.match(denied.content[0].text,/TOOL_DISABLED_IN_SETTINGS/);
    }
    reports.push({selection,toolCount:initial.length,disabledToolsBlocked:true,transcript:client.transcript});
  }finally{client.close();}
}
await writeFile(path.join(root,'results.json'),JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify({passed:true,artifacts:root,modes:reports.filter(x=>x.mode).map(({mode,toolCount,characters})=>({mode,toolCount,characters})),selections:reports.filter(x=>x.selection).map(({selection,toolCount})=>({selection,toolCount})),catalogueParity:true,invalidSelectionsRejected:true}));

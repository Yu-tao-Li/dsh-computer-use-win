import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {TOOL_CATALOG,TOOL_NAMES,LITE_TOOL_NAMES,INPUT_ACTIONS,isQuietCall,toolAnnotations} from '../mcp/catalog.mjs';
import {McpTestClient} from './mcp-test-client.mjs';
assert.equal(TOOL_NAMES.length,26);assert.equal(new Set(TOOL_NAMES).size,26);assert.equal(LITE_TOOL_NAMES.length,12);
assert(LITE_TOOL_NAMES.includes('screenshot'));
const backend=await readFile(new URL('../scripts/windows-uia.ps1',import.meta.url),'utf8');
const guard=backend.match(/if \(\$Action -in @\(([^)]+)\) -or \(Get-Prop \$inputObject 'activate' \$false\)\) \{\s+\$inputLease = Enter-DesktopInput/);
assert(guard,'Find the native input guard action list');
assert.deepEqual(guard[1].split(',').map(x=>x.trim().replaceAll("'",'')).sort(),[...INPUT_ACTIONS,'launch_app'].sort());
const cases=[
 ['click',{elementId:'uia:rt:1-2'},true],['click',{x:1,y:2},false],
 ['click',{elementId:'uia:rt:1-2',dispatch:'foreground'},false],
 ['click',{elementId:'t123:1'},true],['snapshot',{},true],['snapshot',{activate:true},false],
 ['launch_app',{target:'app.exe'},true],['launch_app',{target:'app.lnk'},false],
 ['launch_app',{target:'app.exe',arguments:'arg'},false],['type_text',{method:'clipboard'},false]
];
for(const [name,args,want]of cases)assert.equal(isQuietCall(name,args),want,name);
for(const mode of ['full','lite']){
 const env={...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_TOOL_MODE:mode};delete env.WCU_ENABLED_TOOLS;
 const client=new McpTestClient(process.execPath,[path.resolve(import.meta.dirname,'../mcp/server.mjs')],{env});
 try{
  await client.init();const {tools}=await client.request('tools/list');
  assert.deepEqual(tools.map(x=>x.name.slice('windows_computer_use_'.length)).sort(),[...(mode==='full'?TOOL_NAMES:LITE_TOOL_NAMES)].sort());
  for(const tool of tools){
   assert.deepEqual(tool.annotations,toolAnnotations(tool.name));
   assert.equal(tool.annotations.readOnlyHint,TOOL_CATALOG.find(x=>tool.name.endsWith('_'+x.name)).readOnly===true);
  }
 }finally{client.close()}
}
console.log(JSON.stringify({passed:true,tools:26,lite:12,oneActionCatalog:true,nativeActionParity:true,annotations:true,classificationCases:cases.length}));

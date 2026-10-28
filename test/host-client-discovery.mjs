// Exercise the installed host's real discovery rules, including package-only
// loader rows and the dependency graph. No user profile or desktop input writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import yaml from 'js-yaml';
const modules=process.argv[2];
if(!modules)throw Error('Pass the target Desktop node_modules directory');
const require=createRequire(path.resolve(modules,'../package.json'));
const {ClientModuleRegistry}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-modules')));
const registry=Object.create(ClientModuleRegistry.prototype);
registry.ctx={loader:{}};
registry.pkgMeta=new Map();
const patch=yaml.load(await readFile(new URL('../cordis.patch.yml',import.meta.url),'utf8'));
const row=patch.flatMap(x=>x.insert||[]).find(x=>x.id==='mcp-dsh-computer-use-win');
const meta=registry.resolveMeta(row.name,new URL('../package.json',import.meta.url).href);
assert.ok(meta,'The host must discover the client from the actual bundle loader row');
assert.equal(meta.packageName,'dsh-computer-use-win');
assert.ok(meta.meta.clientPath.endsWith(path.join('mcp','client.js')));
for(const dependency of meta.meta.inject){
  assert.ok(registry.resolveMeta(dependency,pathToFileURL(path.resolve(modules,'../package.json')).href),`Host client dependency missing: ${dependency}`);
}
// Service getters enforce declared inject dependencies in the real browser.
// Plain object fixtures cannot catch an accidental read of legacy connection.
const {Context,Service}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
let client;
vm.runInNewContext(await readFile(new URL('../mcp/client.js',import.meta.url),'utf8'),{
  window:{__ModuleLoader__:{load:entry=>client=entry.factory(name=>require(name))}}
});
const {SlotCore}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-slots')));
const core=new SlotCore();
core.register({name:'root',children:Object.fromEntries(['settings.section','plugins.item','settings.plugin.item','tool.call.toolview','conversation.chat.node'].map(name=>[name,{kind:name.includes('toolview')||name==='conversation.chat.node'?'keyed':'list',scope:'root'}]))},()=>null);
const ctx=new Context(),slots=[];
ctx.provide('locale',{register:()=>()=>{},bind:()=>key=>key});
ctx.provide('slots',{inject:(_name,register)=>{const result=register();if(result&&typeof result.next==='function')for(const _item of result){};return result;},register:(entry,component)=>{slots.push(entry.name);return core.register(entry,component);}});
ctx.provide('configForms',{get:()=>({getSnapshot:()=>({value:{},writable:true}),subscribe:()=>()=>{},mutate:async()=>true})});
ctx.provide('uiConversation',{events:{register:()=>()=>{}}});
class Connection extends Service{constructor(ctx){super(ctx,'connection');}}
await ctx.plugin(Connection);
try{
 const fiber=ctx.plugin(client);await fiber;
 const children=[...ctx.registry.values()].flatMap(r=>[...r.fibers]).filter(f=>f.parent.fiber===fiber.ctx.fiber);
 assert.ok(children.some(f=>'configForms' in f.inject));
 for(const child of children)assert.notEqual(child.state,3,child._error?.message);
 assert.ok(slots.includes('settings.section'),'Modern settings must mount with real service access checks');
 assert.ok(slots.includes('conversation.chat.node'),'Activity summary must mount with real service access checks');
 assert.equal(slots.filter(name=>name==='tool.call.toolview').length,50,'All 25 tools must register both public name prefixes without duplicate child-slot declarations');
}finally{await ctx.fiber.dispose();}
console.log(JSON.stringify({passed:true,hostDiscovery:true,loaderRow:row.name,dependencies:meta.meta.inject,serviceInjectionChecked:true}));

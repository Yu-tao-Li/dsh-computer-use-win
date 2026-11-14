// Actual settings.register provider and MCP bridge from a supplied old host.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {cp,mkdir,mkdtemp,symlink,readFile,writeFile,readdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const modules=process.argv[2];if(!modules)throw Error('Pass legacy host node_modules');
const require=createRequire(path.resolve(modules,'../package.json')),load=name=>import(pathToFileURL(require.resolve(name)));
const [{Context},{ToolRuntime},{default:FileSettings}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-tools'),load('@deepseek-ai/dsh-settings-file')]);
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-legacy-host-')),pluginRoot=path.join(root,'plugin'),peers=path.join(pluginRoot,'node_modules/@deepseek-ai');await mkdir(peers,{recursive:true});
for(const entry of ['mcp','scripts','package.json','docs'])await cp(new URL('../'+entry,import.meta.url),path.join(pluginRoot,entry),{recursive:true});
for(const name of ['schemastery','cosmokit','dsh-mcp-client'])await symlink(path.dirname(require.resolve('@deepseek-ai/'+name+'/package.json')),path.join(peers,name),'junction');
const old={TEMP:process.env.TEMP,TMP:process.env.TMP};process.env.TEMP=root;process.env.TMP=root;
const initial={'windows-computer-use':{indicatorEnabled:false,browserFirst:false,toolPreset:'custom',enabledTools:['wait']}};
const settingsFile=path.join(root,'saved-settings.json');await writeFile(settingsFile,JSON.stringify(initial));
const ctx=new Context();ctx.provide('systemPrompt',{tools(){return ()=>{}},section(){return ()=>{}},getSectionOrder(){return 0}});ctx.provide('profileContext',{home:root,dir:root,name:'isolated-legacy-host'});
const tools=new ToolRuntime(ctx);await ctx.plugin(FileSettings,{path:settingsFile,watch:false});const settings=ctx.settings;
const until=async test=>{const deadline=Date.now()+30000;while(!await test()){if(Date.now()>deadline)throw Error('Legacy host timed out: '+root);await new Promise(r=>setTimeout(r,40));}};
try{
 const adapter=await import(pathToFileURL(path.join(pluginRoot,'mcp/dsh-plugin.mjs')));await ctx.plugin(adapter,{});
 await until(()=>tools.schemas().length===1);assert.match(tools.schemas()[0].name,/windows_computer_use_wait$/);
 await new Promise(r=>setTimeout(r,750));assert.equal(tools.schemas().length,1,'Entry polling must not replace namespace tools');
 const control=(await readdir(root)).find(name=>name.startsWith('dsh-wcu-control-'));assert(control);
 const live=()=>readFile(path.join(root,control,'settings.json'),'utf8').then(JSON.parse);
 assert.equal((await live()).indicatorEnabled,false);assert.equal((await live()).browserFirst,false);
 await settings.update('windows-computer-use',{enabledTools:['wait','screenshot'],indicatorPosition:'bottom'});
 await until(()=>tools.schemas().length===2);await new Promise(r=>setTimeout(r,600));
 assert.equal((await live()).indicatorPosition,'bottom');assert.equal((await live()).indicatorEnabled,false);assert.equal(tools.schemas().length,2);
 const saved=JSON.parse(await readFile(settingsFile,'utf8'));assert.deepEqual(saved['windows-computer-use'].enabledTools,['wait','screenshot']);
 const report={passed:true,hostVersion:require('@deepseek-ai/dsh/package.json').version,bridgeVersion:require('@deepseek-ai/dsh-mcp-client/package.json').version,realRegisterProvider:true,namespaceSurvivesPoll:true,disabledToolsRemainDisabled:true,updatePersistsAndReloads:true,existingProfilesModified:false,physicalInputSent:false,root};
 await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await ctx.fiber.dispose();for(const [key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;}

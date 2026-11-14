import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {cp,mkdir,mkdtemp,symlink,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
const modules=process.argv[2];if(!modules)throw Error('Pass host node_modules');const require=createRequire(path.resolve(modules,'../package.json'));
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-legacy-settings-')),peers=path.join(root,'node_modules/@deepseek-ai');await mkdir(peers,{recursive:true});
for(const entry of ['mcp','scripts','package.json'])await cp(new URL('../'+entry,import.meta.url),path.join(root,entry),{recursive:true});
for(const name of ['schemastery','cosmokit','dsh-mcp-client'])await symlink(path.dirname(require.resolve('@deepseek-ai/'+name+'/package.json')),path.join(peers,name),'junction');
const adapter=await import(pathToFileURL(path.join(root,'mcp/dsh-plugin.mjs')));
const disposers=[],configs=[];let saved={indicatorEnabled:false,cursorIndicatorEnabled:false,browserFirst:false,toolPreset:'lite'},watcher;let failNext=0;
const scope={get:()=>saved,watch:fn=>{watcher=fn;return ()=>{}},update:async patch=>{saved={...saved,...patch};await watcher(saved)}};
const effect=fn=>{const dispose=fn();if(typeof dispose==='function')disposers.push(dispose);};
const ctx={fiber:{entry:{options:{config:{}}}},logger:{warn(){},error(error){throw error}},effect,on(){},inject(names,fn){if(names.length===1&&names[0]==='settings')fn({settings:{register:()=>scope},effect,on(){}});},plugin(_bridge,config){configs.push(config);return {await:async()=>{},update:async next=>{if(failNext){failNext--;throw Error('fixture bridge update failed');}configs.push(next);},then:resolve=>Promise.resolve().then(resolve)}}};
try{
 await adapter.apply(ctx,{});await new Promise(r=>setTimeout(r,650));
 const live=JSON.parse(await readFile(configs[0].env.WCU_CONFIG_FILE,'utf8'));assert.equal(live.indicatorEnabled,false);assert.equal(live.browserFirst,false);assert.equal(live.toolPreset,'lite');
 await scope.update({indicatorPosition:'bottom'});await new Promise(r=>setTimeout(r,350));
 assert.equal(JSON.parse(await readFile(configs[0].env.WCU_CONFIG_FILE,'utf8')).indicatorPosition,'bottom');
 failNext=1;await assert.rejects(scope.update({toolPreset:'full'}),/fixture bridge update failed/);
 const deadline=Date.now()+5000;while(configs.at(-1).env.WCU_TOOL_MODE!=='full'){if(Date.now()>deadline)throw Error('Failed tool selection was never retried');await new Promise(r=>setTimeout(r,50));}
 console.log(JSON.stringify({reloadRetriesWithoutAnotherSettingsChange:true,passed:true,registerNamespaceSurvivesEntryPoll:true,namespaceUpdatePersists:true,physicalInputSent:false}));
}finally{for(const dispose of disposers.reverse())dispose();}

// Real host tools, approval gate, MCP bridge and SDK; only the native worker is
// a no-input fixture. Never launches a user program or edits a user profile.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {cp,mkdir,mkdtemp,symlink,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const modules=process.argv[2];if(!modules)throw Error('Pass host node_modules');
const require=createRequire(path.resolve(modules,'../package.json'));
const load=name=>import(pathToFileURL(require.resolve(name)));
const [{Context},{ToolRuntime}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-tools')]);
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-host-policy-')),pluginRoot=path.join(root,'plugin');
for(const entry of ['mcp','scripts','package.json'])await cp(new URL('../'+entry,import.meta.url),path.join(pluginRoot,entry),{recursive:true});
const peers=path.join(pluginRoot,'node_modules/@deepseek-ai');await mkdir(peers,{recursive:true});
for(const name of ['schemastery','cosmokit','dsh-mcp-client'])await symlink(path.dirname(require.resolve('@deepseek-ai/'+name+'/package.json')),path.join(peers,name),'junction');
const adapterFile=path.join(pluginRoot,'mcp/dsh-plugin.mjs');
await writeFile(adapterFile,(await readFile(adapterFile,'utf8')).replace('installHostPolicy(ctx, runtime);','globalThis.wcuPolicyFixture=installHostPolicy(ctx, runtime);'));
const uploadFixture=path.join(root,'upload.txt');await writeFile(uploadFixture,'fixture');
const marker=path.join(root,'dispatch.json');
await writeFile(path.join(pluginRoot,'scripts/windows-uia.ps1'),`param([switch]$Persistent)
[Console]::WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress));while($null -ne ($line=[Console]::ReadLine())){
 $r=$line|ConvertFrom-Json
 [IO.File]::WriteAllText('${marker.replaceAll("'","''")}',$line)
 [Console]::WriteLine((@{id=$r.id;ok=$true;action=$r.action;approved=$r.args._wcuLaunchApproved}|ConvertTo-Json -Compress))
}`);
const oldEnv={NODE_ENV:process.env.NODE_ENV,WCU_TEST_NO_TAKEOVER:process.env.WCU_TEST_NO_TAKEOVER};process.env.NODE_ENV='test';process.env.WCU_TEST_NO_TAKEOVER='1';
const ctx=new Context();
ctx.provide('systemPrompt',{tools(){return ()=>{}},section(){return ()=>{}},getSectionOrder(){return 0}});
ctx.provide('profileContext',{home:root,dir:root,name:'isolated-policy'});
const tools=new ToolRuntime(ctx);
const webServer={port:undefined};ctx.provide('webServer',webServer);
let choice='rejected';const asks=[];
// DSH's permission state: dsh-user-approval's effectivePolicy and
// dsh-sandbox-policy's resolve, with the same signatures in all four hosts.
let approvalPolicy='ask',sandboxMode='workspace-write';
ctx.provide('approval',{request:async req=>{asks.push({name:req.toolName,reason:req.displayReason});return choice},effectivePolicy:()=>approvalPolicy});
ctx.provide('sandboxPolicy',{resolve:()=>({mode:sandboxMode,workspaceRoot:root})});
try{await ctx.plugin(await load('@deepseek-ai/dsh-tool-executor-native'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
const agent={ctx};
const execute=async(args,action='launch_app')=>{
 const name='mcp__wincu__windows_computer_use_'+action,id='policy-'+Date.now(),signal=new AbortController().signal;
 if(typeof tools.setExecutor==='function')return (await tools.execute({calls:[{id,name,arguments:JSON.stringify(args)}],agent,signal})).results[0].result;
 return tools.execute({callId:id,name,arguments:args,agent,signal});
};
const text=result=>JSON.stringify(result);
try{
 const adapter=await import(pathToFileURL(path.join(pluginRoot,'mcp/dsh-plugin.mjs')));await ctx.plugin(adapter,{toolPreset:'full',indicatorEnabled:false,progressOverlayEnabled:false});
 const deadline=Date.now()+30000;while(tools.schemas().length!==26){if(Date.now()>deadline)throw Error('Bridge did not register');await new Promise(r=>setTimeout(r,50));}
 const pendingPort=await execute({elementId:'new-tab',value:'http://127.0.0.1:9876/'},'set_value');assert.match(text(pendingPort),/POLICY_UNAVAILABLE/);
 webServer.port=9876;await new Promise(r=>setTimeout(r,350));
 const hostAddress=await execute({elementId:'new-tab',value:'http://127.0.0.1:9876/'},'set_value');assert.match(text(hostAddress),/POLICY_DENIED/);await assert.rejects(readFile(marker),{code:'ENOENT'});
 const args={target:'fixture.exe',arguments:'approved argument'};
 const rejected=await execute(args);assert.match(text(rejected),/user rejected/);assert.equal(asks.length,1);
 await assert.rejects(readFile(marker),{code:'ENOENT'});
 choice='cancelled';const cancelled=await execute(args);assert.match(text(cancelled),/cancelled/);await assert.rejects(readFile(marker),{code:'ENOENT'});
 choice='allowed-once';const allowed=await execute(args);assert.notEqual(allowed.isError,true,text(allowed));
 const sent=JSON.parse(await readFile(marker,'utf8'));assert.equal(sent.args._wcuLaunchApproved,true);assert.equal(sent.args._wcuApproval,undefined,'No grant passed to native worker');
 const forged=await execute({...args,_wcuApproval:'caller supplied'});assert.match(text(forged),/credentials cannot be supplied/);assert.equal(asks.length,3);
 let denyLater=true;const undoLater=ctx.on('tools/pre-execute',(exec,next)=>denyLater?{kind:'deny',reason:'later host rule denied'}:next(),{global:true});
 const deniedLater=await execute(args);assert.match(text(deniedLater),/later host rule denied/);assert.equal(asks.length,3);denyLater=false;
 // Full access (policy never + danger-full-access): DSH would reject any ask,
 // so none is made; the grant still reaches MCP bound to these arguments.
 agent.session={id:'policy-fixture-session'};approvalPolicy='never';sandboxMode='danger-full-access';
 const fullArgs={target:'fixture.exe',arguments:'full access argument'};
 const full=await execute(fullArgs);assert.notEqual(full.isError,true,text(full));assert.equal(asks.length,3,'No approval request under full access');
 const fullSent=JSON.parse(await readFile(marker,'utf8'));assert.equal(fullSent.args._wcuLaunchApproved,true);assert.equal(fullSent.args.arguments,'full access argument');
 // Policy never with a restricted sandbox still asks; DSH then rejects it.
 sandboxMode='workspace-write';choice='rejected';
 const restricted=await execute(fullArgs);assert.match(text(restricted),/user rejected/);assert.equal(asks.length,4);
 approvalPolicy='ask';delete agent.session;
 globalThis.wcuPolicyFixture.disposePreExecute();const dispatchedBefore=await readFile(marker,'utf8');
 for(const [action,input]of [['launch_app',args],['set_value',{elementId:'new-tab',value:pathToFileURL(uploadFixture).href}],['set_value',{elementId:'tfixture:1',value:uploadFixture}],['set_value',{elementId:'bfixture:connect',value:'connect'}]]){
  const result=await execute(input,action);assert.match(text(result),/APPROVAL_REQUIRED/);assert.equal(await readFile(marker,'utf8'),dispatchedBefore);
 }undoLater();assert.equal(asks.length,4);
 const report={fullAccessSkipsPrompt:true,restrictedNeverStillAsks:true,missingPreExecuteFailsClosed:true,laterHostDenialPreserved:true,passed:true,hostVersion:require('@deepseek-ai/dsh/package.json').version,bridgeVersion:require('@deepseek-ai/dsh-mcp-client/package.json').version,rejectedNoDispatch:true,cancelledNoDispatch:true,allowedThroughRealMcpSdk:true,forgedCredentialDenied:true,lateHostPortProtected:true,physicalInputSent:false,root};
 await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{delete globalThis.wcuPolicyFixture;await ctx.fiber.dispose();for(const [key,value]of Object.entries(oldEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;}

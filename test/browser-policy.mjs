// Actual Chromium and MCP in an isolated profile, using local fixture pages.
import assert from 'node:assert/strict';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {mkdtemp,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
import {McpTestClient} from './mcp-test-client.mjs';import {mintGrant} from '../mcp/policy.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-browser-policy-'));
const local=path.join(root,'file.html'),upload=path.join(root,'fixture.txt');await writeFile(local,'<h1>approved local fixture</h1>');await writeFile(upload,'upload fixture');
const protectedServer=http.createServer((_req,res)=>res.end('<h1>PROTECTED_HOST_CONTENT</h1>'));
await new Promise(r=>protectedServer.listen(0,'127.0.0.1',r));const protectedPort=protectedServer.address().port;
const secrets=['PASSWORD_SECRET_42','12345678','4111111111111111','987'];
const server=http.createServer((req,res)=>{
 if(req.url==='/redirect'){res.writeHead(302,{location:`http://127.0.0.1:${protectedPort}/`});return res.end();}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><title>Policy fixture</title><h1>Policy fixture</h1>
 <label>Password field<input type=password value="${secrets[0]}"></label>
 <label>Code field<input autocomplete=one-time-code value="${secrets[1]}"></label>
 <label>Card field<input autocomplete=cc-number value="${secrets[2]}"></label>
 <label>CSC field<input autocomplete=cc-csc value="${secrets[3]}"></label>
 <label>Ordinary field<input value="ordinary visible value"></label>
 <label>Attachment<input type=file></label>`);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const site=`http://127.0.0.1:${server.address().port}`,key='isolated fixture grant secret';
const clientEnv={...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_BROWSER_HEADLESS:'1',WCU_BROWSER_PROFILE:path.join(root,'profiles'),WCU_APPROVAL_SECRET:key,WCU_APPROVAL_LEDGER:path.join(root,'approval-grants.json'),WCU_HOST_PORTS:String(protectedPort)};
const startClient=env=>new McpTestClient(process.execPath,[path.resolve(import.meta.dirname,'../mcp/server.mjs')],{env});
let client=startClient(clientEnv);
const restartClient=async env=>{const exited=new Promise(resolve=>client.child.once('exit',resolve));client.close();await exited;client=startClient(env);await client.init();};
const text=r=>r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
let checks=0;
const call=async(name,args,pattern)=>{const r=await client.call('windows_computer_use_'+name,args);checks++;if(pattern){assert.equal(r.isError,true,text(r));assert.match(text(r),pattern);return r;}assert.notEqual(r.isError,true,text(r));return r;};
const data=r=>JSON.parse(r.content[0].text);
const noSecrets=(result, observedTab)=>{
 let visible=text(result).replace(/wcu_untrusted_[0-9a-f]{32}/g,' ');
 // Generated fixture addresses and IDs can also contain the short test value.
 for(const marker of [site,observedTab?.id,observedTab?.browser]){
  if(marker)visible=visible.replaceAll(marker,' ');
 }
 for(const value of secrets)assert.equal(visible.includes(value),false,'Leaked sensitive field value');
};
try{
 const boundary='wcu_untrusted_987'+'a'.repeat(29);
 const response=body=>({content:[{type:'text',text:body}]});
 assert.doesNotThrow(()=>noSecrets(response(`<${boundary}>[redacted]</${boundary}>`)));
 assert.throws(()=>noSecrets(response(`<${boundary}>987</${boundary}>`)),/Leaked sensitive field value/);
 await client.init();
 await call('set_value',{elementId:'new-tab',value:pathToFileURL(local).href},/APPROVAL_REQUIRED/);
 await call('set_value',{elementId:'new-tab',value:`http://127.0.0.1:${protectedPort}/`},/POLICY_DENIED/);
 await call('set_value',{elementId:'new-tab',value:'http://169.254.169.254/'},/POLICY_DENIED/);
 const opened=await call('set_value',{elementId:'new-tab',value:site});const observedTab=data(opened).opened;const tab=observedTab.id;noSecrets(opened,observedTab);
 const snapshot=await call('snapshot',{browserTab:tab,includeScreenshot:false});noSecrets(snapshot,observedTab);assert.match(text(snapshot),/ordinary visible value/);
 const hits=data(await call('find',{browserTab:tab,query:'field',controlType:'Edit',maxResults:20})).results;
 assert.equal(hits.length,5);for(const hit of hits){const info=await call('element_info',{elementId:hit.id});noSecrets(info,observedTab);if(hit.name!=='Ordinary field')assert.match(text(info),/redacted/);}
 for(const keys of [['ctrl','v'],['ctrl','shift','v'],['ctrl','c'],['ctrl','x'],['shift','insert'],['shift','delete']])await call('keypress',{browserTab:tab,keys},/CLIPBOARD_SHORTCUT/);
 const attachment=data(await call('find',{browserTab:tab,query:'Attachment',maxResults:1})).results[0].id;
 const uploadArgs={elementId:attachment,value:upload};await call('set_value',uploadArgs,/APPROVAL_REQUIRED/);
 const grant=mintGrant('set_value',uploadArgs,key);await call('set_value',{...uploadArgs,_wcuApproval:grant});
 await call('set_value',{...uploadArgs,_wcuApproval:grant},/invalid, expired or already used/);
 await call('set_value',{elementId:'new-tab',value:site+'/redirect'},/POLICY_DENIED/);
 const fileArgs={elementId:'new-tab',value:pathToFileURL(local).href};const fileOpened=await call('set_value',{...fileArgs,_wcuApproval:mintGrant('set_value',fileArgs,key)});
 assert.match(text(await call('snapshot',{browserTab:data(fileOpened).opened.id,includeScreenshot:false})),/approved local fixture/);
 const batchArgs={browserTab:tab,steps:[{action:'set_value',arguments:{elementId:tab+':address',value:pathToFileURL(local).href}}]};
 await call('batch',batchArgs,/APPROVAL_REQUIRED/);
 const batched=await call('batch',{...batchArgs,_wcuApproval:mintGrant('batch',batchArgs,key)});assert.equal(data(batched).completed,1);
 const waitArgs={milliseconds:1},waitGrant=mintGrant('wait',waitArgs,key);
 await call('wait',{...waitArgs,_wcuApproval:waitGrant});
 await restartClient(clientEnv);
 await call('wait',{...waitArgs,_wcuApproval:waitGrant},/invalid, expired or already used/);
 await call('wait',{...waitArgs,_wcuApproval:mintGrant('wait',waitArgs,key)});
 const missingRegistryEnv={...clientEnv};delete missingRegistryEnv.WCU_APPROVAL_LEDGER;
 await restartClient(missingRegistryEnv);
 await call('wait',{...waitArgs,_wcuApproval:mintGrant('wait',waitArgs,key)},/APPROVAL_STATE_UNAVAILABLE/);
 await writeFile(path.join(root,'results.json'),JSON.stringify({passed:true,checks,realChromium:true,structuredReadPathsRedacted:true,redirectDenied:true,approvedUpload:true,approvedLocalFile:true,replayAfterMcpRestartDenied:true,missingLedgerFailsClosed:true,root},null,2));
 console.log(JSON.stringify({passed:true,checks,root,physicalInputSent:false}));
}finally{client.close();await new Promise(r=>server.close(r));await new Promise(r=>protectedServer.close(r));}

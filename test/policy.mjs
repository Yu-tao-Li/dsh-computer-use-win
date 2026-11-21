import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,readFile,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {classifyOperation,assertBrowserUrl,assertUpload,assertOperation,mintGrant,consumeGrant,installHostPolicy} from '../mcp/policy.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-policy-'));
const inside=path.join(root,'allowed'),outside=path.join(root,'outside');await mkdir(inside);await mkdir(outside);
const file=path.join(inside,'fixture.txt'),secretFile=path.join(outside,'private.txt');await writeFile(file,'test');await writeFile(secretFile,'test');
const cases=[
 ['launch_app',{target:'notepad.exe'},'allow'],
 ['launch_app',{target:'fixture.exe',arguments:'--flag'},'ask'],
 // Command hosts with arguments are refused before any prompt: the backend
 // refuses them even after an approval. Without arguments they still start.
 ['launch_app',{target:'C:\\Windows\\System32\\cmd.exe',arguments:'/c echo x'},'deny'],
 ['launch_app',{target:'%ComSpec%',arguments:'/c echo x'},'deny'],
 ['launch_app',{target:'PowerShell.EXE. ',arguments:'-Command exit'},'deny'],
 ['launch_app',{target:'python',arguments:'app.py'},'deny'],
 ['launch_app',{target:'cmd.exe'},'allow'],
 ['launch_app',{target:'shortcut.lnk'},'ask'],
 ['launch_app',{target:'\\\\server\\share\\app.exe'},'deny'],
 ['launch_app',{target:'app.exe',workingDirectory:'//server/share'},'deny'],
 ['set_value',{elementId:'new-tab',value:'file:///C:/fixture.txt'},'ask'],
 ['set_value',{elementId:'t123:address',value:'file://server/share/file'},'deny'],
 ['set_value',{elementId:'t123:address',value:'http://169.254.169.254/latest'},'deny'],
 ['set_value',{elementId:'new-tab',value:'http://2852039166/latest'},'deny'],
 ['set_value',{elementId:'new-tab',value:'http://metadata.google.internal'},'deny'],
 ['set_value',{elementId:'new-tab',value:'http://[::ffff:169.254.169.254]/'},'deny'],
 ...['127.0.0.1','127.1.2.3','localhost','[::1]','[::ffff:127.0.0.1]'].map(host=>['set_value',{elementId:'new-tab',value:`http://${host}:8088/`},'deny']),
 ['set_value',{elementId:'new-tab',value:'http://127.0.0.1:8089/'},'allow'],
 ['set_value',{elementId:'b123:connect',value:'connect'},'ask'],
 ['set_value',{elementId:'t123:4',value:file},'ask'],
 ['set_value',{elementId:'t123:4',value:'ordinary text'},'allow'],
 ['batch',{steps:[{action:'set_value',arguments:{elementId:'t123:4',value:file}},{action:'set_value',arguments:{elementId:'t123:address',value:'http://169.254.169.254/'}}]},'deny'],
];
for(const [name,args,kind] of cases)assert.equal(classifyOperation(name,args,{WCU_HOST_PORTS:'8088'}).kind,kind,JSON.stringify({name,args}));
assert.throws(()=>assertBrowserUrl(pathToFileURL(file).href),/APPROVAL_REQUIRED/);
assert.doesNotThrow(()=>assertBrowserUrl(pathToFileURL(file).href,{env:{WCU_ALLOWED_FILE_ROOTS:inside}}));
assert.throws(()=>assertUpload([secretFile],{env:{WCU_ALLOWED_UPLOAD_ROOTS:inside}}),/APPROVAL_REQUIRED/);
assert.doesNotThrow(()=>assertUpload([file],{env:{WCU_ALLOWED_UPLOAD_ROOTS:inside}}));
await symlink(outside,path.join(inside,'escape'),'junction');
assert.throws(()=>assertUpload([path.join(inside,'escape','private.txt')],{env:{WCU_ALLOWED_UPLOAD_ROOTS:inside}}),/APPROVAL_REQUIRED/);
assert.throws(()=>assertOperation('launch_app',{target:'app.exe',arguments:'x'}),/APPROVAL_REQUIRED/);
assert.throws(()=>assertBrowserUrl('http://169.254.169.254',{approved:true}),/POLICY_DENIED/);
const portFile=path.join(root,'ports.json');await writeFile(portFile,JSON.stringify({ports:['9876']}));
assert.throws(()=>assertBrowserUrl('http://localhost:9876',{env:{WCU_HOST_PORT_FILE:portFile}}),/POLICY_DENIED/);
const args={target:'app.exe',arguments:'approved args'},used=new Map(),key='fixture secret',now=1000;
const grant=mintGrant('windows_computer_use_launch_app',args,key,now);
assert.equal(consumeGrant(grant,'launch_app',args,key,used,now),true);
assert.equal(consumeGrant(grant,'launch_app',args,key,used,now),false,'No replay');
assert.equal(consumeGrant(grant,'launch_app',{...args,arguments:'changed'},key,new Map(),now),false);
assert.equal(consumeGrant(grant,'launch_app',args,'wrong',new Map(),now),false);
assert.equal(consumeGrant(grant,'set_value',args,key,new Map(),now),false);
assert.equal(consumeGrant(grant,'launch_app',args,key,new Map(),now+120001),false);
const ledger=path.join(root,'approval-grants.json');
const persistentGrant=mintGrant('launch_app',args,key,now);
assert.equal(consumeGrant(persistentGrant,'launch_app',args,key,new Map(),now,ledger),true);
assert.equal(consumeGrant(persistentGrant,'launch_app',args,key,new Map(),now,ledger),false,'Fresh worker memory cannot replay a consumed nonce');
const nextGrant=mintGrant('launch_app',args,key,now);
assert.equal(consumeGrant(nextGrant,'launch_app',args,key,new Map(),now,ledger),true);
const lockedLedger=path.join(root,'locked.json'),lock=lockedLedger+'.lock';
for(const owner of [JSON.stringify({marker:'wcu-approval',pid:process.pid}),JSON.stringify({marker:'wcu-approval',pid:99999999}),'unknown lock']){
 await writeFile(lock,owner);
 assert.throws(()=>consumeGrant(mintGrant('launch_app',args,key,now),'launch_app',args,key,new Map(),now,lockedLedger),/APPROVAL_STATE_UNAVAILABLE/);
 assert.equal(await readFile(lock,'utf8'),owner,'Never remove a lock belonging to another worker');
 await unlink(lock); // This test created the lock and has finished inspecting it.
}
await writeFile(lockedLedger,'malformed ledger');
assert.throws(()=>consumeGrant(mintGrant('launch_app',args,key,now),'launch_app',args,key,new Map(),now,lockedLedger),/APPROVAL_STATE_UNAVAILABLE/);
assert.equal(await readFile(lockedLedger,'utf8'),'malformed ledger');
await writeFile(lockedLedger,JSON.stringify({used:[[123,'bad expiry']]}));
assert.throws(()=>consumeGrant(mintGrant('launch_app',args,key,now),'launch_app',args,key,new Map(),now,lockedLedger),/APPROVAL_STATE_UNAVAILABLE/);
assert.throws(()=>consumeGrant(mintGrant('launch_app',args,key,now),'launch_app',args,key,new Map(),now,path.join(root,'missing','ledger.json')),/APPROVAL_STATE_UNAVAILABLE/);
const afterExpiry=now+120001;
assert.equal(consumeGrant(mintGrant('launch_app',args,key,afterExpiry),'launch_app',args,key,new Map(),afterExpiry,ledger),true);
assert.equal(JSON.parse(await readFile(ledger,'utf8')).used.length,1,'Expired entries are pruned');
const hooks={};installHostPolicy({on:(name,fn)=>hooks[name]=fn},{approvalSecret:key,hostPorts:[]});
const execution={name:'mcp__wincu__windows_computer_use_launch_app',arguments:args};
assert.equal((await hooks['tools/pre-execute'](execution,async()=>({kind:'deny',reason:'downstream deny'}))).reason,'downstream deny');
assert.equal((await hooks['tools/pre-execute'](execution,async()=>({kind:'ask',reason:'another approval'}))).reason,'another approval');
assert.equal((await hooks['tools/pre-execute'](execution,async()=>({kind:'allow'}))).kind,'ask');
execution.arguments={...args,arguments:'changed after approval'};
await assert.rejects(hooks['tools/execute'](execution,async()=>{throw Error('Must not dispatch')}),/arguments changed/);
let inGuest = false;
const desktopHooks = {};
installHostPolicy({on:(name,fn)=>desktopHooks[name]=fn},{
  approvalSecret:key,hostPorts:['32108'],usesGuestLoopback:()=>inGuest,
});
const navigation={name:'mcp__wincu__windows_computer_use_set_value',arguments:{elementId:'new-tab',value:'http://127.0.0.1:32108/'}};
const allow=async()=>({kind:'allow'});
assert.equal((await desktopHooks['tools/pre-execute'](navigation,allow)).kind,'deny','The DSH host port remains protected on the current desktop');
inGuest=true;
assert.equal((await desktopHooks['tools/pre-execute'](navigation,allow)).kind,'allow','The same loopback port in a VM belongs to the guest');
assert.equal(classifyOperation('set_value',{elementId:'t123:4',value:path.join(root,'missing-file')}).kind,'allow','A nonexistent path in a text field is not an upload');
console.log(JSON.stringify({passed:true,tableCases:cases.length,realPathRoots:true,oneTimeExactGrant:true,persistentReplayProtection:true,lockedOrDamagedLedgerFailsClosed:true,dynamicHostPort:true,downstreamPolicyPreserved:true,changedArgumentsRefused:true}));

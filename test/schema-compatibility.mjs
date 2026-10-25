import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';
import {volatileEntries,updateVolatile} from '@deepseek-ai/cosmokit';
const original=z.prototype.volatile;
try{
 delete z.prototype.volatile;
 const adapter=await import('../mcp/dsh-plugin.mjs?without-volatile-convenience');
 for(const name of Object.keys(adapter.SettingsConfig.dict))assert.equal(adapter.Config.dict[name].meta.volatile,true,name+' must remain host-configurable without volatile()');
 const values=adapter.Config({indicatorEnabled:false,stopShortcut:'F8',browserFirst:false,browserVisible:false,browserApp:'chrome',browserSignIn:true});
 assert.equal(values.browserFirst.get(),false);assert.equal(values.browserVisible.get(),false);
 assert.equal(values.browserApp.get(),'chrome');assert.equal(values.browserSignIn.get(),true);
 assert.equal(adapter.Config({}).browserApp.get(),'default');assert.equal(adapter.Config({}).browserSignIn.get(),false);
 assert.equal(values.indicatorEnabled.get(),false);assert.equal(values.stopShortcut.get(),'F8');
 const reference=adapter.createLiveReference(['wait']);
 assert.equal(volatileEntries({reference}).length,1,'The host must recognize the fallback reference');
 updateVolatile(reference,adapter.createLiveReference(['screenshot']));
 assert.deepEqual(reference.get(),['screenshot']);assert.equal(Object.isFrozen(reference.get()),true);
 console.log(JSON.stringify({passed:true,volatileMethodAbsent:true,exposedFields:Object.keys(adapter.SettingsConfig.dict).length,falseValuePreserved:true}));
}finally{z.prototype.volatile=original;}

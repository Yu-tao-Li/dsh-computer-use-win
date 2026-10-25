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
 // #39: DSH refuses the whole entry when one saved value fails validation, and
 // every tool disappears. Choices this version does not offer fall back to
 // their defaults and are reported; typed values stay strict for the save path.
 const validate=input=>adapter.Config['~standard'].validate(input);
 const stale=validate({toolPreset:'smart',browserApp:'firefox',browserVisible:'yes',enabledTools:['health','removed_tool','tools'],futureSetting:3});
 assert.equal(stale.issues,undefined,JSON.stringify(stale.issues));
 assert.equal(stale.value.toolPreset.get(),'auto');assert.equal(stale.value.browserApp.get(),'default');assert.equal(stale.value.browserVisible.get(),true);
 assert.deepEqual(stale.value.enabledTools.get(),['health','tools']);
 assert.deepEqual(stale.value[adapter.REPAIRED_SETTINGS],['toolPreset: "smart"','browserApp: "firefox"','browserVisible: "yes"','enabledTools: "removed_tool"']);
 assert.equal(Object.getOwnPropertyDescriptor(stale.value,adapter.REPAIRED_SETTINGS).enumerable,false,'The report is not a setting and is never saved');
 const unknownOnly=validate({enabledTools:['removed_tool']});
 assert.equal(unknownOnly.issues,undefined);assert.equal(unknownOnly.value.enabledTools.get().length,24,'A list of unknown tools falls back to all tools, not none');
 const clean=validate({toolPreset:'lite',browserApp:'edge'});
 assert.equal(clean.issues,undefined);assert.equal(clean.value[adapter.REPAIRED_SETTINGS],undefined,'Valid settings are not reported');
 for(const typed of [{stopShortcut:'Esc'},{indicatorIdleMs:99999},{toolPreset:'smart',stopShortcut:'Ctrl'}])assert.ok(validate(typed).issues,'Typed values stay strict: '+JSON.stringify(typed));
 console.log(JSON.stringify({passed:true,volatileMethodAbsent:true,exposedFields:Object.keys(adapter.SettingsConfig.dict).length,falseValuePreserved:true,staleChoicesRepaired:4,typedValuesStrict:3}));
}finally{z.prototype.volatile=original;}

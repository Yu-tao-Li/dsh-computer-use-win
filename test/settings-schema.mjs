import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SETTINGS_SCHEMA,DEFAULT_SETTINGS,CLIENT_DEFAULT_SETTINGS} from '../mcp/settings-schema.mjs';
import {normalizeSettings,TOOL_NAMES,LITE_TOOL_NAMES} from '../mcp/settings.mjs';
import {SettingsConfig,Config} from '../mcp/dsh-plugin.mjs';
import {buildClient} from '../scripts/build-client.mjs';

await buildClient({check:true});
const source=await readFile(new URL('../mcp/client.js',import.meta.url),'utf8');
let definition;
vm.runInNewContext(source.replace('return {apply,inject:','return {apply,defaults,allToolNames,liteToolNames,toolGroups,settingRules,inject:'),{window:{__ModuleLoader__:{load:d=>definition=d}}});
const ui=JSON.parse(JSON.stringify(definition.factory(()=>({}))));
assert.deepEqual(ui.defaults,CLIENT_DEFAULT_SETTINGS);
assert.deepEqual(ui.allToolNames,TOOL_NAMES);assert.deepEqual(ui.liteToolNames,LITE_TOOL_NAMES);
assert.deepEqual(ui.toolGroups.flatMap(([,entries])=>entries.flat()).sort(),[...TOOL_NAMES].sort());
assert.deepEqual(Object.keys(SettingsConfig.dict),Object.keys(SETTINGS_SCHEMA));
for(const key of ['communityNote','mode','resumeToken','previewToken','progressPreviewToken'])assert.equal(key in ui.defaults,false,'Command/display fields must not join the form draft');
let boundaryCases=0;
for(const [key,field]of Object.entries(SETTINGS_SCHEMA)){
  assert.deepEqual(SettingsConfig({})[key],DEFAULT_SETTINGS[key],key+' host default');
  if(field.type==='integer'){
    assert.equal(ui.settingRules[key].min,field.min);assert.equal(ui.settingRules[key].max,field.max);
    for(const value of [field.min,field.max]){
      assert.equal(normalizeSettings({[key]:value})[key],value);
      assert.equal(Config['~standard'].validate({[key]:value}).issues,undefined);boundaryCases++;
    }
    for(const value of [field.min-1,field.max+1,field.min+0.5]){
      assert.throws(()=>normalizeSettings({[key]:value}));
      assert(Config['~standard'].validate({[key]:value}).issues);boundaryCases++;
    }
  }
}
console.log(JSON.stringify({passed:true,settings:Object.keys(SETTINGS_SCHEMA).length,boundaryCases,clientBuildReproducible:true,commandsExcludedFromDraft:true}));

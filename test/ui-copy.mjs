import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../mcp/client.js',import.meta.url),'utf8');
let definition;vm.runInNewContext(source.replace('return {apply,inject:', 'return {apply,dictionaries,inject:'),{window:{__ModuleLoader__:{load:d=>definition=d}}});
const dict=definition.factory(()=>({})).dictionaries;
assert.deepEqual(Object.keys(dict.zh).sort(),Object.keys(dict.en).sort());
const errors=[];
for(const [locale,entries] of Object.entries(dict))for(const [key,value] of Object.entries(entries)){
  let limit;
  if(/(?:Hint)$/.test(key))limit=locale==='zh'?45:140;
  if(/(?:Info)$/.test(key))limit=locale==='zh'?50:160;
  if(/^(?:attachStep[12]|attachRisk[12]|signInStep\w+|signInRisk[123]|firefoxNotice|modeQuietNote\d|hypervStep\d)$/.test(key))limit=locale==='zh'?60:170;
  if(/^(?:progressSync|previewTitle|clearShortcutTitle)$/.test(key))limit=locale==='zh'?30:100;
  if(/^(?:progressModeSource|progressModeSummary|browserApp_\w+)$/.test(key))limit=locale==='zh'?16:28;
  if(limit&&[...value].length>limit)errors.push(`${locale}.${key}: ${[...value].length}>${limit}`);
}
assert.deepEqual(errors,[],'UI copy must fit its display budget');
assert.equal(source.includes('Object.assign(dictionaries'),false,'Locale dictionary has one definition');
for(const match of source.matchAll(/\bt\('([^']+)'\)/g))assert.ok(match[1] in dict.zh,'Missing UI string '+match[1]);
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;
assert.equal(source.match(/const PLUGIN_VERSION = '([^']+)'/)[1],version);
console.log(JSON.stringify({passed:true,localeKeys:Object.keys(dict.zh).length,version,copyBudgets:true}));

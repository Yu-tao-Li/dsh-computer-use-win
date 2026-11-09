// #74: the overlay's words live in one dictionary per language. Pure checks:
// no window, model or host is started.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HELPER_KEYS,OVERLAY_STRINGS,helperStrings,indicatorText,isDefaultIndicatorText,overlayLocale,systemLocale} from '../mcp/overlay-strings.mjs';
import {actionLabel} from '../mcp/activity.mjs';
import {summaryInput} from '../mcp/progress-summary.mjs';
import {previewProgress} from '../mcp/takeover.mjs';
import {readDshLocale} from '../mcp/dsh-plugin.mjs';

// Every module the published package loads is in its file list (a new module
// such as overlay-strings.mjs must be added to package.json "files").
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
for(const file of pkg.files.filter(name=>/^mcp\/.*\.(?:mjs|js)$/.test(name))){
  const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
  for(const [,target] of source.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g)){
    const resolved=new URL(target,new URL('../'+file,import.meta.url)).pathname.split('/').slice(-2).join('/');
    assert.ok(pkg.files.includes(resolved),`${file} loads ${target}, which package.json "files" leaves out`);
  }
}
console.log('PASS every module the package loads is published');

const cjk=/[一-鿿]/;
const placeholders=text=>[...String(text).matchAll(/\{(\d+)\}/g)].map(match=>match[1]).sort().join(',');
const {zh,...others}=OVERLAY_STRINGS;
for(const [language,table] of Object.entries(others)){
  assert.deepEqual(Object.keys(table).sort(),Object.keys(zh).sort(),`${language} must have every key`);
  assert.deepEqual(Object.keys(table.labels).sort(),Object.keys(zh.labels).sort(),`${language} must name every tool`);
  for(const [key,value] of Object.entries(table)){
    if(key==='labels'){for(const [tool,names] of Object.entries(value))assert.equal(names.length,zh.labels[tool].length,`${language} ${tool} page/window names`);continue;}
    assert.ok(typeof value==='string'&&value.trim(),`${language}.${key} is text`);
    assert.equal(placeholders(value),placeholders(zh[key]),`${language}.${key} keeps the placeholders of zh.${key}`);
    if(language==='en')assert.ok(!cjk.test(value),`en.${key} has no Chinese`);
  }
}
for(const key of HELPER_KEYS)assert.ok(typeof zh[key]==='string',`helper key ${key} exists`);
assert.deepEqual(Object.keys(helperStrings('en')),[...HELPER_KEYS]);
console.log('PASS dictionaries have the same keys and placeholders in every language');

// The C# helper draws only words it is sent: no Chinese text left in its code,
// and every helper key is used there. The same holds for the Node modules
// that build the overlay's lines and the summary request.
const stripComments=source=>source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:"'])\/\/.*$/gm,'$1');
const helper=await readFile(new URL('../scripts/windows-takeover.cs',import.meta.url),'utf8');
assert.ok(!cjk.test(stripComments(helper)),'windows-takeover.cs draws no built-in Chinese text');
for(const key of HELPER_KEYS)assert.ok(helper.includes(`"${key}"`),`windows-takeover.cs uses ${key}`);
for(const file of ['../mcp/activity.mjs','../mcp/progress-summary.mjs','../mcp/takeover.mjs']){
  assert.ok(!cjk.test(stripComments(await readFile(new URL(file,import.meta.url),'utf8'))),`${file} takes its words from overlay-strings.mjs`);
}
// The settings page shows the same built-in banner texts.
const client=await readFile(new URL('../mcp/client.js',import.meta.url),'utf8');
const listed=client.match(/const defaultIndicatorTexts=(\[[^\]]*\])/);
assert.ok(listed,'client.js lists the built-in banner texts');
for(const table of Object.values(OVERLAY_STRINGS))assert.ok(listed[1].includes(`'${table.indicatorDefault}'`),`client.js knows "${table.indicatorDefault}"`);
console.log('PASS the helper and the overlay modules carry no built-in Chinese text');

// Languages: DSH and system tags map to a shipped dictionary, else English.
for(const [tag,expected] of [['zh','zh'],['zh-CN','zh'],['zh-Hans-CN','zh'],['ZH_tw','zh'],['en','en'],['en-US','en'],['ru-RU','en'],['ja','en'],['',''+'en'],[undefined,'en']])
  assert.equal(overlayLocale(tag),expected,`locale ${tag}`);
assert.ok(typeof systemLocale()==='string'&&systemLocale().length>=2);
// The banner: an unchanged default follows the language; the user's own words stay.
assert.equal(indicatorText('DSH 正在控制电脑','en'),'DSH is controlling your computer');
assert.equal(indicatorText('DSH is controlling your computer','zh-CN'),'DSH 正在控制电脑');
assert.equal(indicatorText('','en'),'DSH is controlling your computer');
assert.equal(indicatorText('AI 助手接管中','en'),'AI 助手接管中');
assert.equal(isDefaultIndicatorText(' DSH 正在控制电脑 '),true);assert.equal(isDefaultIndicatorText('Robot at work'),false);
console.log('PASS language tags and the banner default');

// Step names, the summary request and the adjustment preview in English.
assert.equal(actionLabel('mcp__wincu__windows_computer_use_scroll',{},'en'),'Scroll the window');
assert.equal(actionLabel('windows_computer_use_scroll',{browserTab:'t1'},'en'),'Scroll the page');
assert.equal(actionLabel('windows_computer_use_set_value',{elementId:'t1:new-tab'},'en'),'Open a new tab');
assert.equal(actionLabel('windows_computer_use_batch',{steps:[{action:'click'},{action:'type_text'},{action:'keypress'}]},'en'),'Run 3 actions: Click, Type text and more');
assert.equal(actionLabel('windows_computer_use_batch',{steps:[{action:'click'}]},'en'),'Run 1 action: Click');
assert.equal(actionLabel('windows_computer_use_batch',{steps:[{action:'click'},{action:'scroll'}]}),'连续执行 2 个操作：点击、滚动窗口');
assert.equal(actionLabel('web_search',{},'en'),'Search the web');
const input=summaryInput({step:2,status:'done',intent:'Check the settings page.',steps:[{step:2,actions:[{label:'Read the page',state:'done'},{label:'Click',state:'error'}],reasoning:'Looking.',reply:'All set.'}]},2400,'en');
assert.equal(input,'Task status: done; current step 2\nModel output at the start of the task: Check the settings page.\nStep 2: Read the page, Click (error)\n  Model output: Looking.\nReply to the user: All set.');
assert.ok(!cjk.test(JSON.stringify(previewProgress('en'))));
assert.equal(previewProgress('zh-CN').steps[0].actions[0].label,'打开新标签页');
console.log('PASS English step names, summary input and preview');

// DSH's language comes from its `locale` settings entry, as DSH Desktop reads it.
assert.equal(readDshLocale({describe:()=>[{ns:'other',value:{}},{ns:'locale',value:{preference:'en'}}]}),'en');
assert.equal(readDshLocale({describe:()=>[{ns:'locale',value:{}}]}),systemLocale(),'No choice in DSH: the system locale');
assert.equal(readDshLocale({describe:()=>{throw Error('not ready');}}),systemLocale());
assert.equal(readDshLocale(undefined),systemLocale());
console.log('PASS DSH interface language with and without a choice');

// Tool identity and action classes. Keep this module free of host/browser IO.
export const TOOL_CATALOG = Object.freeze([
  {name:'health',uiOrder:0,group:'observe',readOnly:true,quiet:'always',interruptible:true},
  {name:'snapshot',uiOrder:1,group:'observe',readOnly:true,quiet:'read',interruptible:true},
  {name:'accessibility_tree',uiOrder:2,group:'observe',readOnly:true,quiet:'read',interruptible:true,backend:'tree'},
  {name:'list_windows',uiOrder:1,group:'windows',lite:true,readOnly:true,quiet:'always',interruptible:true},
  {name:'find',uiOrder:3,group:'observe',lite:true,readOnly:true,quiet:'read',interruptible:true},
  {name:'element_info',uiOrder:4,group:'observe',readOnly:true,quiet:'read',interruptible:true},
  {name:'click',uiOrder:0,group:'input',lite:true,input:true},
  {name:'double_click',uiOrder:1,group:'input',input:true},
  {name:'move',uiOrder:2,group:'input',input:true},
  {name:'drag',uiOrder:3,group:'input',input:true},
  {name:'scroll',uiOrder:4,group:'input',lite:true,input:true,backgroundFirst:true},
  {name:'type_text',uiOrder:5,group:'input',lite:true,input:true,backgroundFirst:true},
  {name:'keypress',uiOrder:6,group:'input',lite:true,input:true},
  {name:'focus',uiOrder:5,group:'windows',input:true},
  {name:'invoke',uiOrder:6,group:'windows',input:true,backgroundFirst:true},
  {name:'set_value',uiOrder:7,group:'windows',input:true,backgroundFirst:true},
  {name:'activate_window',uiOrder:2,group:'windows',input:true},
  {name:'wait',uiOrder:1,group:'other',readOnly:true,quiet:'always',interruptible:true},
  {name:'ocr',uiOrder:5,group:'observe',lite:true,readOnly:true,quiet:'read',interruptible:true},
  {name:'screenshot',uiOrder:6,group:'observe',lite:true,readOnly:true,quiet:'read',interruptible:true},
  {name:'wait_for',uiOrder:2,group:'other',lite:true,readOnly:true,quiet:'read',interruptible:true},
  {name:'close_window',uiOrder:4,group:'windows',input:true},
  {name:'move_window',uiOrder:3,group:'windows',input:true},
  {name:'launch_app',uiOrder:0,group:'windows',lite:true,quiet:'launch'},
  {name:'batch',uiOrder:0,group:'other',lite:true},
  {name:'tools',uiOrder:3,group:'other',lite:true,management:true}
].map(Object.freeze));

export const TOOL_NAMES = Object.freeze(TOOL_CATALOG.map(tool=>tool.name));
export const LITE_TOOL_NAMES = Object.freeze(TOOL_CATALOG.filter(tool=>tool.lite).map(tool=>tool.name));
export const INPUT_ACTIONS = new Set(TOOL_CATALOG.filter(tool=>tool.input).map(tool=>tool.name));
export const BACKGROUND_FIRST = new Set(TOOL_CATALOG.filter(tool=>tool.backgroundFirst).map(tool=>tool.name));
export const INTERRUPTIBLE_ACTIONS = new Set(TOOL_CATALOG.filter(tool=>tool.interruptible).flatMap(tool=>[tool.name,tool.backend??tool.name]));
const byAction = new Map(TOOL_CATALOG.flatMap(tool=>[[tool.name,tool],...(tool.backend?[[tool.backend,tool]]:[])]));

export const ELEMENT_ID = /^(?:web:)?(t[0-9a-z]+):(\d+|address)$/;
export const NEW_TAB = /^(?:(b[0-9a-z]+):)?new-tab$/;
export const USER_CONNECT = /^(b[0-9a-z]+):connect$/;
export function isBrowserElementId(id) {
  return typeof id==='string'&&(ELEMENT_ID.test(id)||NEW_TAB.test(id)||USER_CONNECT.test(id));
}
export function isBrowserCall(args) {
  return !!args&&((args.browserTab!==undefined&&args.browserTab!=='desktop')||isBrowserElementId(args.elementId));
}
export function isQuietCall(action,args={}) {
  const kind=byAction.get(action)?.quiet;
  if(isBrowserCall(args)||kind==='always')return true;
  if(!args||args.activate===true)return false;
  if(kind==='launch')return !String(args.arguments??'').trim()&&!/\.lnk$/i.test(args.target??'');
  if(kind==='read')return true;
  if((['click','double_click','keypress'].includes(action)&&args.dispatch==='background')||(action==='type_text'&&args.method==='background'))return true;
  if(action==='type_text')return (args.method??'auto')==='auto'&&args.focusMode!=='main';
  if(args.elementId===undefined||args.elementId===null)return false;
  if(BACKGROUND_FIRST.has(action))return true;
  return action==='click'&&(args.dispatch??'auto')==='auto'&&(args.button??'left')==='left';
}
export function toolAnnotations(name) {
  const tool=byAction.get(String(name).replace(/^windows_computer_use_/,''));
  if(!tool)throw Error('Tool missing from catalog: '+name);
  return {
    readOnlyHint:tool.readOnly===true,
    destructiveHint:!tool.readOnly&&!tool.management,
    idempotentHint:tool.readOnly===true||tool.management===true,
    openWorldHint:tool.management!==true
  };
}

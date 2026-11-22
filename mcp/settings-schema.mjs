// Shared setting metadata. No host dependency: Node validation, the host schema
// and the client build all consume these definitions.
import {TOOL_NAMES} from './catalog.mjs';
import {OVERLAY_STRINGS} from './overlay-strings.mjs';

export const BROWSER_APPS = Object.freeze(['default', 'edge', 'chrome', 'firefox']);
export const STOP_SHORTCUT_PATTERN = /^(?:(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Win\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Pause|CapsLock|NumLock|ScrollLock))?$/;
const toggle = (value, description) => ({type:'boolean', default:value, description});
const choice = (values, value, description, extra={}) => ({type:'enum', values:Object.freeze(values), default:value, description, ...extra});
const integer = (min, max, value, description, extra={}) => ({type:'integer', min, max, default:value, description, ...extra});
const shortcut = description => ({type:'shortcut', default:'', description});
const command = () => integer(0, Number.MAX_SAFE_INTEGER, 0, undefined, {draft:false, command:true});

export const SETTINGS_SCHEMA = Object.freeze(Object.fromEntries(Object.entries({
  desktopTarget: choice(['quiet','fast','hyperv'], 'quiet', '工作方式 / Work mode'),
  hypervVm: {type:'text',default:'',maxLength:120,allowEmpty:true,description:'Hyper-V 虚拟机名称 / Hyper-V virtual machine name'},
  browserFirst: toggle(true, '网页优先使用浏览器通道 / Prefer browser use for web pages'),
  browserVisible: toggle(true, '显示DSH浏览器窗口 / Show the DSH browser'),
  browserApp: choice(BROWSER_APPS, 'default', '使用的浏览器 / Browser'),
  browserSignIn: toggle(false, '记住登录 / Keep sign-ins'),
  browserAttachUser: toggle(false, '连接我自己的浏览器 / Attach to my own browser'),
  progressOverlayEnabled: toggle(true, '思考与操作浮窗 / Progress overlay'),
  progressOverlayMode: choice(['source','summary'], 'source', '浮窗内容：原文或 AI 总结 / Overlay content: source or AI summary'),
  progressOverlayOpacity: integer(20,100,60,'浮窗不透明度（%） / Overlay opacity (%)'),
  progressOverlayWidth: integer(240,1600,360,'浮窗宽度 / Overlay width'),
  progressOverlayHeight: integer(160,1600,240,'浮窗高度 / Overlay height'),
  progressOverlayPosition: choice(['top-right','top-left','bottom-right','bottom-left','custom'],'top-right','浮窗位置 / Overlay position'),
  progressOverlayX: integer(-32768,32767,80,'浮窗 X / Overlay X'),
  progressOverlayY: integer(-32768,32767,80,'浮窗 Y / Overlay Y'),
  progressOverlayLocked: toggle(true,'锁定浮窗并穿透鼠标 / Lock overlay and pass through input'),
  progressLockShortcut: shortcut('浮窗锁定快捷键 / Overlay lock shortcut'),
  progressPreviewToken: command(),
  mode: choice(['lite','full'],'full','旧版工具模式 / Legacy tool mode',{draft:false}),
  toolPreset: choice(['auto','full','lite','lazy','custom'],'auto','工具加载方案 / Tool preset',{clientDefault:'full'}),
  enabledTools: {type:'tools',default:TOOL_NAMES,description:'启用的工具 / Enabled tools'},
  indicatorEnabled: toggle(true,'接管提示 / Takeover indicator'),
  cursorIndicatorEnabled: toggle(true,'鼠标指示 / Pointer indicator'),
  remoteIndicatorVisible: toggle(true,'远程与录屏可见 / Visible in remote sessions and recordings'),
  indicatorText: {type:'text',default:OVERLAY_STRINGS.zh.indicatorDefault,maxLength:120,description:'提示文字 / Banner text'},
  indicatorPosition: choice(['top','bottom'],'top','提示位置 / Banner position'),
  indicatorIdleMs: integer(200,3000,800,'结束后隐藏延时（毫秒） / Hide delay (ms)'),
  stopShortcut: shortcut('自定义停止快捷键 / Custom stop shortcut'),
  communityNote: choice(['full','link'],'full','项目支持说明 / Project support note',{draft:false}),
  // Legacy command compatibility only; it cannot grant input permission.
  resumeToken: command(),
  previewToken: command()
}).map(([key,field])=>[key,Object.freeze({draft:true,...field})])));

export const DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([key,field])=>[key,field.default])));
export const CLIENT_DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(Object.entries(SETTINGS_SCHEMA).filter(([,field])=>field.draft).map(([key,field])=>[key,field.clientDefault??field.default])));
export const SETTING_CHOICES = Object.freeze(Object.fromEntries(Object.entries(SETTINGS_SCHEMA).filter(([,field])=>field.type==='enum').map(([key,field])=>[key,field.values])));
export const SETTING_SWITCHES = Object.freeze(Object.keys(SETTINGS_SCHEMA).filter(key=>SETTINGS_SCHEMA[key].type==='boolean'));

export function createSettingsFields(z) {
  return Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([key,field])=>{
    let schema;
    switch(field.type) {
      case 'boolean': schema=z.boolean();break;
      case 'enum': schema=z.union(field.values.map(value=>z.const(value)));break;
      case 'integer': schema=z.number().min(field.min).max(field.max);break;
      case 'shortcut': schema=z.string().pattern(STOP_SHORTCUT_PATTERN);break;
      case 'text': schema=z.string();break;
      case 'tools': schema=z.array(z.union(TOOL_NAMES.map(name=>z.const(name)))).max(TOOL_NAMES.length);break;
      default: throw new Error('Unknown setting type: '+field.type);
    }
    schema=schema.default(Array.isArray(field.default)?[...field.default]:field.default);
    if(field.description)schema=schema.description(field.description);
    return [key,schema];
  }));
}

export function validateSetting(key, value) {
  const field=SETTINGS_SCHEMA[key];
  if(!field)throw new Error('Unknown setting: '+key);
  if(field.type==='boolean'&&typeof value!=='boolean')throw new Error(`${key} must be boolean`);
  if(field.type==='enum'&&!field.values.includes(value))throw new Error(`${key} must be ${field.values.join(', ')}`);
  if(field.type==='integer'&&(!Number.isSafeInteger(value)||value<field.min||value>field.max))throw new Error(`${key} must be an integer between ${field.min} and ${field.max}`);
  if(field.type==='text'&&(typeof value!=='string'||(!field.allowEmpty&&!value.trim())||value.length>field.maxLength||/[\r\n\x00-\x1f]/.test(value)))throw new Error(`${key} must be one line of ${field.allowEmpty?0:1}–${field.maxLength} characters`);
}

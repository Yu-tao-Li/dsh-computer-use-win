export const TOOL_NAMES = Object.freeze(['health','snapshot','accessibility_tree','list_windows','find','element_info','click','double_click','move','drag','scroll','type_text','keypress','focus','invoke','set_value','activate_window','wait','ocr','screenshot','wait_for','close_window','move_window','tools']);
export const LITE_TOOL_NAMES = Object.freeze(['list_windows','find','click','scroll','type_text','keypress','ocr','screenshot','wait_for','tools']);
export function normalizeEnabledTools(value) {
  if (!Array.isArray(value) || value.length > TOOL_NAMES.length || value.some(name => typeof name !== 'string' || !TOOL_NAMES.includes(name))) throw new Error('enabledTools must be an array of known tool names');
  const selected=new Set(value);
  return TOOL_NAMES.filter(name=>selected.has(name));
}

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'full', toolPreset: 'auto', enabledTools: TOOL_NAMES, indicatorEnabled: true, cursorIndicatorEnabled: true, remoteIndicatorVisible: true, indicatorText: 'DSH 正在控制电脑',
  indicatorPosition: 'top', indicatorIdleMs: 800, stopShortcut: '', communityNote: 'full',
  resumeToken: 0, previewToken: 0
});

export const STOP_SHORTCUT_PATTERN = /^(?:(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Win\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Pause|CapsLock|NumLock|ScrollLock))?$/;

export function normalizeStopShortcut(value) {
  if (typeof value !== 'string') throw new Error('stopShortcut must be a string');
  if (!value) return '';
  const parts = value.split('+'), key = parts.pop();
  const modifiers = ['Ctrl', 'Alt', 'Shift', 'Win'];
  if (parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length ||
      !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Pause|CapsLock|NumLock|ScrollLock)$/.test(key)) {
    throw new Error('stopShortcut must be a supported key with optional Ctrl, Alt, Shift, Win modifiers; Esc is always reserved');
  }
  return [...modifiers.filter(part => parts.includes(part)), key].join('+');
}

export function normalizeSettings(input = {}) {
  const value = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(input).map(([key,value])=>[key,typeof value?.get === 'function' ? value.get() : value])) };
  if (!['lite', 'full'].includes(value.mode)) throw new Error('mode must be lite or full');
  value.enabledTools=normalizeEnabledTools(value.enabledTools);
  if (!['auto','full','lite','lazy','custom'].includes(value.toolPreset)) throw new Error('toolPreset must be full, lite, lazy or custom');
  if (value.toolPreset==='auto') value.toolPreset=value.enabledTools.length===TOOL_NAMES.length?'full':'custom';
  for (const key of ['indicatorEnabled', 'cursorIndicatorEnabled','remoteIndicatorVisible']) {
    if (typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  }
  if (typeof value.indicatorText !== 'string' || !value.indicatorText.trim() || value.indicatorText.length > 120 || /[\r\n\x00-\x1f]/.test(value.indicatorText)) {
    throw new Error('indicatorText must be one line of 1–120 characters');
  }
  if (!['top', 'bottom'].includes(value.indicatorPosition)) throw new Error('indicatorPosition must be top or bottom');
  if (!Number.isInteger(value.indicatorIdleMs) || value.indicatorIdleMs < 200 || value.indicatorIdleMs > 3000) throw new Error('indicatorIdleMs must be 200–3000');
  value.stopShortcut = normalizeStopShortcut(value.stopShortcut);
  if (!['full', 'link'].includes(value.communityNote)) throw new Error('communityNote must be full or link');
  for (const key of ['resumeToken', 'previewToken']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`${key} must be a nonnegative integer`);
  }
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, value[key]]));
}

export function enabledToolsForSettings(input = {}) {
  const settings=normalizeSettings(input);
  return [...(['full','lazy'].includes(settings.toolPreset)?TOOL_NAMES:settings.toolPreset==='lite'?LITE_TOOL_NAMES:settings.enabledTools)];
}

// Both permission and startup state matter when deciding whether to reconnect.
export function toolSelectionKey(input = {}) {
  const settings=normalizeSettings(input);
  return JSON.stringify({allowed:enabledToolsForSettings(settings),lazy:settings.toolPreset==='lazy'});
}

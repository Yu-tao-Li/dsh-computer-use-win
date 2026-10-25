export const TOOL_NAMES = Object.freeze(['health','snapshot','accessibility_tree','list_windows','find','element_info','click','double_click','move','drag','scroll','type_text','keypress','focus','invoke','set_value','activate_window','wait','ocr','screenshot','wait_for','close_window','move_window','tools']);
export const LITE_TOOL_NAMES = Object.freeze(['list_windows','find','click','scroll','type_text','keypress','ocr','screenshot','wait_for','tools']);
export function normalizeEnabledTools(value) {
  if (!Array.isArray(value) || value.length > TOOL_NAMES.length || value.some(name => typeof name !== 'string' || !TOOL_NAMES.includes(name))) throw new Error('enabledTools must be an array of known tool names');
  const selected=new Set(value);
  return TOOL_NAMES.filter(name=>selected.has(name));
}

// browserApp: the browser Browser Use runs ('default' follows the Windows
// default browser). browserSignIn: the DSH browser keeps its profile, so the
// sites the user signs in to there stay signed in, instead of starting from a
// temporary profile each time. The user's own browser is never used.
export const BROWSER_APPS = Object.freeze(['default', 'edge', 'chrome']);

export const DEFAULT_SETTINGS = Object.freeze({
  browserFirst: true, browserVisible: true, browserApp: 'default', browserSignIn: false,
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

// A saved value this version does not offer (a tool, preset, browser or
// position chosen in another version, or edited by hand) must not keep the
// plugin from loading: DSH refuses the whole entry when one value fails, and
// every tool then disappears with no visible error (#39). Such choices fall
// back to their defaults and unknown tool names are dropped; each change is
// returned so it can be reported. Values typed on the settings page (shortcut,
// text, numbers) stay strict, so a mistyped one is still refused when saved.
const SETTING_CHOICES = { mode: ['lite', 'full'], toolPreset: ['auto', 'full', 'lite', 'lazy', 'custom'], browserApp: BROWSER_APPS, indicatorPosition: ['top', 'bottom'], communityNote: ['full', 'link'] };
const SETTING_SWITCHES = ['browserFirst', 'browserVisible', 'browserSignIn', 'indicatorEnabled', 'cursorIndicatorEnabled', 'remoteIndicatorVisible'];
export function repairStaleSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: input, repaired: [] };
  const value = { ...input }, repaired = [];
  const read = key => typeof value[key]?.get === 'function' ? value[key].get() : value[key];
  const reset = key => { repaired.push(`${key}: ${JSON.stringify(read(key))}`); delete value[key]; };
  for (const [key, allowed] of Object.entries(SETTING_CHOICES)) if (read(key) != null && !allowed.includes(read(key))) reset(key);
  for (const key of SETTING_SWITCHES) if (read(key) != null && typeof read(key) !== 'boolean') reset(key);
  const tools = read('enabledTools');
  if (tools != null && !Array.isArray(tools)) reset('enabledTools');
  else if (tools?.some(name => !TOOL_NAMES.includes(name))) {
    const known = [...new Set(tools.filter(name => TOOL_NAMES.includes(name)))];
    repaired.push(`enabledTools: ${tools.filter(name => !TOOL_NAMES.includes(name)).map(name => JSON.stringify(name)).join(', ')}`);
    // A list made only of unknown names would leave no tool at all.
    if (known.length) value.enabledTools = known; else delete value.enabledTools;
  }
  return { value, repaired };
}

export function normalizeSettings(input = {}) {
  const value = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(input).map(([key,value])=>[key,typeof value?.get === 'function' ? value.get() : value])) };
  if (!['lite', 'full'].includes(value.mode)) throw new Error('mode must be lite or full');
  value.enabledTools=normalizeEnabledTools(value.enabledTools);
  if (!['auto','full','lite','lazy','custom'].includes(value.toolPreset)) throw new Error('toolPreset must be full, lite, lazy or custom');
  if (value.toolPreset==='auto') value.toolPreset=value.enabledTools.length===TOOL_NAMES.length?'full':'custom';
  for (const key of ['browserFirst', 'browserVisible', 'browserSignIn', 'indicatorEnabled', 'cursorIndicatorEnabled','remoteIndicatorVisible']) {
    if (typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  }
  if (!BROWSER_APPS.includes(value.browserApp)) throw new Error('browserApp must be default, edge or chrome');
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
  return JSON.stringify({allowed:enabledToolsForSettings(settings),lazy:settings.toolPreset==='lazy',browserFirst:settings.browserFirst,browserVisible:settings.browserVisible,browserApp:settings.browserApp,browserSignIn:settings.browserSignIn});
}

export function browserRoutingInstructions(settings = {}, allowed = enabledToolsForSettings(settings)) {
  const { browserFirst, browserVisible, browserSignIn } = normalizeSettings(settings);
  return (browserFirst
    ? 'Browser-first policy: for web-page tasks, use the browser lane whenever it can handle the requested step; Computer Use is the fallback. '
    : 'Choose the browser lane or desktop tools according to the user\'s request. ') +
    (allowed.includes('list_windows') ? 'Start with list_windows to identify the intended browser/tab. ' : 'Window discovery is disabled in this selection; do not invent browser/tab IDs. ') +
    (!allowed.includes('set_value') ? 'Opening a new browser tab is unavailable because set_value is disabled; explain this limitation instead of calling a disabled tool. '
      : browserSignIn ? 'For a new web task use set_value elementId "new-tab" with the URL; it opens a background tab in the DSH browser, whose profile is kept: sites the user signed in to there are still signed in. When a page asks to sign in, never type passwords or codes yourself: ask the user to sign in once in the DSH browser window (the window with the blue frame), wait until they say they are done, then read the page again. ' +
        (browserVisible ? '' : 'The DSH browser window is hidden now, so first ask the user to turn on "Show the browser window" under Browser Use in DSH settings. ') +
        'Signed in, you act as the user: before sending, posting, buying, deleting or changing account settings, ask the user unless they asked for exactly that step. '
      : 'For a new public web task use set_value elementId "new-tab" with the URL; it opens an isolated DSH browser without the user\'s sign-ins. ') +
    'Use a connected user tab only when the task needs that existing session and the user authorized it; never substitute an unsigned-in agent tab for an authenticated workflow. Read the page with browserTab and use its element IDs for clicks, values and navigation. Screenshot when visual evidence is needed. Tool names still begin windows_computer_use_ but browserTab/page IDs route internally through CDP without moving the desktop pointer. ' +
    'Fall back to desktop UIA, then screenshots/OCR and coordinates, for native applications, browser chrome/native dialogs, missing CDP connections or unsupported page content such as iframe contents and canvas coordinates. Before falling back, identify the same intended visible window and read fresh desktop state; never reuse page IDs or page pixels as desktop coordinates. Do not silently replay an action whose outcome is unknown: observe its result first. Stale IDs require re-reading the page; dialogs require handling the dialog; cancellation, user stop, permission refusal, disabled/read-only controls and invalid values are not reasons to bypass a refusal with desktop input. If the browser page is headless and desktop fallback is needed, explain that there is no visible window; do not operate an unrelated user window. Respect explicit user requests for a particular method, enabled-tool restrictions and approvals. Visible DSH browsers must not be activated or brought to the foreground unless the user asks; background page operations leave the user\'s mouse and foreground window alone during ordinary page actions. A browser-native JavaScript dialog may temporarily activate its window; report this limitation instead of promising that visible browser work can never affect focus.';
}

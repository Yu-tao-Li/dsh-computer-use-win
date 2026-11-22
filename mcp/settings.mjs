import {TOOL_NAMES,LITE_TOOL_NAMES} from './catalog.mjs';
export {TOOL_NAMES,LITE_TOOL_NAMES} from './catalog.mjs';
export function normalizeEnabledTools(value) {
  if (!Array.isArray(value) || value.length > TOOL_NAMES.length || value.some(name => typeof name !== 'string' || !TOOL_NAMES.includes(name))) throw new Error('enabledTools must be an array of known tool names');
  const selected=new Set(value);
  return TOOL_NAMES.filter(name=>selected.has(name));
}

import {DEFAULT_SETTINGS,SETTINGS_SCHEMA,BROWSER_APPS,SETTING_CHOICES,SETTING_SWITCHES,validateSetting} from './settings-schema.mjs';
export {DEFAULT_SETTINGS,BROWSER_APPS,STOP_SHORTCUT_PATTERN} from './settings-schema.mjs';

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
// 0.6.3 turned "where DSH works" into work modes. Both former local choices,
// the current desktop and the background desktop, are now parts of Low
// disruption (quiet), so a saved one carries over without a reset notice.
export const LEGACY_DESKTOP_TARGETS = Object.freeze({ current: 'quiet', background: 'quiet' });
export function repairStaleSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: input, repaired: [], migrated: false };
  const value = { ...input }, repaired = [];
  const read = key => typeof value[key]?.get === 'function' ? value[key].get() : value[key];
  const migrated = Object.hasOwn(LEGACY_DESKTOP_TARGETS, String(read('desktopTarget')));
  if (migrated) value.desktopTarget = LEGACY_DESKTOP_TARGETS[read('desktopTarget')];
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
  return { value, repaired, migrated };
}

export function normalizeSettings(input = {}) {
  const value = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(input).map(([key,value])=>[key,typeof value?.get === 'function' ? value.get() : value])) };
  value.desktopTarget = LEGACY_DESKTOP_TARGETS[value.desktopTarget] ?? value.desktopTarget;
  for(const key of Object.keys(SETTINGS_SCHEMA))validateSetting(key,value[key]);
  value.enabledTools=normalizeEnabledTools(value.enabledTools);
  if(value.toolPreset==='auto')value.toolPreset=value.enabledTools.length===TOOL_NAMES.length?'full':'custom';
  if(value.browserApp==='firefox'||value.desktopTarget==='hyperv')value.browserAttachUser=false;
  value.hypervVm=value.hypervVm.trim();
  value.stopShortcut=normalizeStopShortcut(value.stopShortcut);
  value.progressLockShortcut=normalizeStopShortcut(value.progressLockShortcut);
  if(value.progressLockShortcut&&value.progressLockShortcut===value.stopShortcut)throw new Error('progressLockShortcut must differ from the stop shortcut');
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, value[key]]));
}

export function enabledToolsForSettings(input = {}) {
  const settings=normalizeSettings(input);
  return [...(['full','lazy'].includes(settings.toolPreset)?TOOL_NAMES:settings.toolPreset==='lite'?LITE_TOOL_NAMES:settings.enabledTools)];
}

// Both permission and startup state matter when deciding whether to reconnect.
// Low disruption and Foreground share one server, which reads the mode live.
export function toolSelectionKey(input = {}) {
  const settings=normalizeSettings(input);
  return JSON.stringify({allowed:enabledToolsForSettings(settings),lazy:settings.toolPreset==='lazy',browserFirst:settings.browserFirst,browserVisible:settings.browserVisible,browserApp:settings.browserApp,browserSignIn:settings.browserSignIn,browserAttachUser:settings.browserAttachUser,desktopTarget:settings.desktopTarget==='hyperv'?'hyperv':'local',hypervVm:settings.desktopTarget==='hyperv'?settings.hypervVm:''});
}

export function browserRoutingInstructions(settings = {}, allowed = enabledToolsForSettings(settings)) {
  const { browserFirst, browserVisible, browserSignIn, browserApp, browserAttachUser } = normalizeSettings(settings);
  if (browserApp === 'firefox') return 'Experimental Firefox-family browser lane: the Firefox it starts runs headless, with no window; a configured WCU_BROWSER_BIDI_URL may connect a separately started browser. There is one controlling session per endpoint and no cross-MCP sharing. Use list_windows for current tab IDs and set_value elementId "new-tab" to open a URL when those tools are enabled. The outline uses DOM heuristics, not an accessibility tree. Page IDs route through WebDriver BiDi. Read the resulting page to verify each action. Automatic visible sign-in and the blue-frame status indicator are unavailable; never ask the user to turn on automatic visible launch for this backend, and never enter passwords or codes. Use an authenticated endpoint only when authorized. Honor enabled-tool restrictions and user stop/cancellation. Do not replay uncertain actions; observe first. Headless pages have no desktop window, so do not fall back to an unrelated user window. Before sending, posting, buying, deleting or changing account settings, ask the user unless they asked for exactly that step.';
  return (browserAttachUser ? 'User-browser attachment is enabled. list_windows only lists the selected browser, never connects. Before explicitly connecting through set_value elementId "<browser id>:connect" value "connect", ask the user to click Allow in their browser. Do not automatically retry a refusal or timeout. Only operate tabs the user mentioned or DSH opened. Before sending, posting, buying, deleting or changing account settings, ask the user unless they asked for exactly that step. ' : '') + (browserFirst
    ? 'Browser-first policy: for web-page tasks, use the browser lane whenever it can handle the requested step; Computer Use is the fallback. '
    : 'Choose the browser lane or desktop tools according to the user\'s request. ') +
    (allowed.includes('list_windows') ? 'Use list_windows for existing Windows targets and browser tab IDs. An empty browser list before the first new-tab is normal. ' : 'Window discovery is disabled in this selection; do not invent browser/tab IDs. ') +
    (!allowed.includes('set_value') ? 'Opening a new browser tab is unavailable because set_value is disabled; explain this limitation instead of calling a disabled tool. '
      : browserSignIn ? 'For a new web task use set_value elementId "new-tab" with the URL; it opens a background tab in the DSH browser, whose profile is kept: sites the user signed in to there are still signed in. When a page asks to sign in, never type passwords or codes yourself: ask the user to sign in once in the DSH browser window (the window with the blue frame), wait until they say they are done, then read the page again. ' +
        (browserVisible ? '' : 'The DSH browser window is hidden now, so first ask the user to turn on "Show the DSH browser window" under Browser Use in DSH settings. ') +
        'Signed in, you act as the user: before sending, posting, buying, deleting or changing account settings, ask the user unless they asked for exactly that step. '
      : 'For a new public web task use set_value elementId "new-tab" with the URL; it opens an isolated DSH browser without the user\'s sign-ins. ') +
    'Send only elementId and value for new-tab, then use opened.id as browserTab. For desktop fallback, omit browserTab or use "desktop" with an explicit Windows target. ' +
    'Use a connected user tab only when the task needs that existing session and the user authorized it; never substitute an unsigned-in agent tab for an authenticated workflow. Read the page with browserTab and use its element IDs for clicks, values and navigation. Screenshot when visual evidence is needed. Tool names still begin windows_computer_use_ but browserTab/page IDs route internally through CDP without moving the desktop pointer. ' +
    'Fall back to desktop UIA, then screenshots/OCR and coordinates, for native applications, browser chrome/native dialogs, missing CDP connections or content the page lane cannot handle. Before falling back, identify the same intended visible window and read fresh desktop state; never reuse page IDs or page pixels as desktop coordinates. Do not silently replay an action whose outcome is unknown: observe its result first. Stale IDs require re-reading the page; dialogs require handling the dialog; cancellation, user stop, permission refusal, disabled/read-only controls and invalid values are not reasons to bypass a refusal with desktop input. If the browser page is headless and desktop fallback is needed, explain that there is no visible window; do not operate an unrelated user window. Respect explicit user requests for a particular method, enabled-tool restrictions and approvals. Visible DSH browsers must not be activated or brought to the foreground unless the user asks; background page operations leave the user\'s mouse and foreground window alone during ordinary page actions. A browser-native JavaScript dialog may temporarily activate its window; report this limitation instead of promising that visible browser work can never affect focus.';
}

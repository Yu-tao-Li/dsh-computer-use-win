// Browser module: DSH React, settings transport, and real navigation slots.
window.__ModuleLoader__.load({
  id: 'dsh-computer-use-win',
  factory: (require) => {
    const React = require('react'), h = React.createElement;
    const NS = 'windowsComputerUse.settings';
    const allToolNames='health snapshot accessibility_tree list_windows find element_info click double_click move drag scroll type_text keypress focus invoke set_value activate_window wait ocr screenshot wait_for close_window move_window tools'.split(' ');
    const toolGroups=[
      ['observe',[
        ['health','检查连接','Check connection','检查桌面工具是否可用','Check desktop tool availability'],
        ['snapshot','截图与控件概览','Screen and controls','同时查看画面和界面控件','Capture the screen and UI controls'],
        ['accessibility_tree','读取界面控件','Read UI controls','查看窗口里的控件结构','Read the control hierarchy'],
        ['find','查找控件','Find controls','按文字或类型查找控件','Find controls by text or type'],
        ['element_info','查看控件详情','Inspect a control','读取控件属性和可用操作','Read control properties and actions'],
        ['ocr','识别屏幕文字','Read screen text','从画面中识别文字和位置','Recognize visible text and positions'],
        ['screenshot','截取屏幕','Take a screenshot','查看窗口或桌面的画面','Capture a window or desktop']
      ]],
      ['input',[
        ['click','单击','Click','点击控件或屏幕位置','Click a control or screen position'],
        ['double_click','双击','Double-click','双击控件或屏幕位置','Double-click a control or position'],
        ['move','移动鼠标','Move pointer','移动鼠标到指定位置','Move the pointer to a position'],
        ['drag','拖动鼠标','Drag','按指定路径拖动','Drag along a specified path'],
        ['scroll','滚动','Scroll','滚动页面或控件','Scroll a page or control'],
        ['type_text','输入文字','Type text','在当前输入位置填写文字','Enter text at the current focus'],
        ['keypress','按键与组合键','Press keys','发送按键或组合键','Send a key or key combination']
      ]],
      ['windows',[
        ['list_windows','查看窗口列表','List windows','查找已打开的窗口','Find open windows'],
        ['activate_window','切换窗口','Activate a window','将目标窗口切到前台','Bring a window to the foreground'],
        ['move_window','移动窗口','Move a window','调整窗口在屏幕上的位置','Reposition a window'],
        ['close_window','关闭窗口','Close a window','请求应用关闭窗口','Ask an app to close a window'],
        ['focus','聚焦控件','Focus a control','将输入焦点移到控件','Move input focus to a control'],
        ['invoke','执行控件操作','Use a control','调用按钮、选项或展开操作','Invoke, toggle, select or expand a control'],
        ['set_value','设置控件内容','Set a control value','直接填写可编辑控件','Fill an editable control directly']
      ]],
      ['other',[
        ['wait','等待片刻','Wait briefly','等待指定时间后继续','Pause before continuing'],
        ['wait_for','等待目标出现','Wait for a target','等待窗口、控件或文字出现','Wait for a window, control or text'],
        ['tools','工具说明与管理','Tool reference and management','查看说明并管理已获准的工具','Describe and manage user-allowed tools']
      ]]
    ];
    const liteToolNames='list_windows find click scroll type_text keypress ocr screenshot wait_for tools'.split(' ');
    const defaults = {browserFirst:true,browserVisible:true,browserApp:'default',browserSignIn:false,toolPreset:'full',enabledTools:allToolNames,indicatorEnabled:true,cursorIndicatorEnabled:true,remoteIndicatorVisible:true,indicatorText:'DSH 正在控制电脑',indicatorPosition:'top',indicatorIdleMs:800,stopShortcut:''};
    const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
    const dictionaries = {
      zh: {nav:'电脑操控',title:'Windows 桌面操作',intro:'查看接管提示，使用 Esc 停止桌面操作。',mode:'工具模式',lite:'精简模式',full:'全能模式',modeHint:'精简模式保留常用工具，其余按需加载。切换模式会在当前动作结束后重载工具。',indicator:'显示接管提示',indicatorHint:'显示屏幕边缘光晕和提示条；关闭后仍可按 Esc 停止。',text:'提示文字',position:'提示位置',top:'屏幕顶部',bottom:'屏幕底部',delay:'操作结束后隐藏延时（毫秒）',delayHint:'连续动作共用提示，避免每次点击都闪烁。范围 200–3000 毫秒。',corner:'用鼠标停止操作',cornerHint:'鼠标停在屏幕左上角约 500 毫秒可拒绝后续输入；普通鼠标移动不会停止。',stop:'停止与恢复',stopHint:'用户按 Esc 后保持暂停。普通鼠标和其他按键不触发停止，程序发送的 Esc 也不触发停止。恢复前请确认 agent 的任务仍符合你的意图。',resume:'恢复桌面控制',resumed:'已请求恢复桌面控制',preview:'预览接管提示',previewed:'已请求预览；如果之前按 Esc 暂停，请先恢复控制。',save:'保存',discard:'取消修改',saved:'已保存',failed:'保存失败',unavailable:'当前宿主未提供可写设置，请在本机 DSH 中打开此页面。',invalid:'请填写 1–120 字的单行提示文字，并将隐藏延时设为 200–3000 的整数。',persistFailed:'宿主未确认设置已保存，请刷新后重试。'},
      en: {nav:'Computer Use',title:'Windows computer use',intro:'See when the agent controls your desktop. Press Esc to stop.',mode:'Tool mode',lite:'Lite',full:'Full',modeHint:'Lite keeps common tools and loads others on demand. A mode change reloads tools after the current action finishes.',indicator:'Show takeover indicator',indicatorHint:'Show the screen-edge glow and banner. Esc remains available when the indicator is off.',text:'Banner text',position:'Banner position',top:'Top of screen',bottom:'Bottom of screen',delay:'Hide delay after an action (ms)',delayHint:'Keep the indicator between consecutive actions. Range: 200–3000 ms.',corner:'Keep the mouse-corner failsafe',cornerHint:'Parking the pointer in the top-left corner for about 500 ms can refuse further input. Ordinary mouse movement does not stop control.',stop:'Stop and resume',stopHint:'Physical Esc keeps desktop input paused. Other mouse/keyboard input and agent-generated Esc do not stop control. Check the task before resuming.',resume:'Resume desktop control',resumed:'Desktop control resume requested',preview:'Preview takeover indicator',previewed:'Preview requested; resume first if you previously stopped with Esc.',save:'Save',discard:'Discard changes',saved:'Saved',failed:'Save failed',unavailable:'Writable settings are unavailable. Open this page in your local DSH host.',invalid:'Use 1–120 characters on one line and an integer hide delay between 200 and 3000.',persistFailed:'The host did not confirm the saved settings. Refresh and retry.'}
    };
    const extraCopy={
      zh:{intro:'选择 agent 使用的工具，设置接管提示与停止方式。',toolsTitle:'工具模式',toolsHint:'精简模式覆盖日常操作，需要时可继续加载更多工具。',lite:'精简',full:'全能',liteSummary:'常用工具，减少上下文占用',fullSummary:'启动时提供全部桌面工具',liteCount:'10 个初始工具',fullCount:'24 个初始工具',modeAfter:'切换模式会等当前动作结束后生效。',indicatorTitle:'接管提示',indicator:'显示屏幕边缘与提示条',indicatorHint:'让你知道 agent 何时正在操作电脑。',position:'提示位置',top:'顶部',bottom:'底部',preview:'预览接管提示',previewHint:'请先保存更改，再预览屏幕上的实际效果。',previewOff:'提示已关闭',previewOn:'接管时的屏幕示意',previewNote:'提示不抢焦点，鼠标可以穿透。',appearance:'提示的更多选项',text:'提示文字',delay:'操作后保留提示',delayHint:'连续动作保持显示，减少闪烁。200–3000 毫秒。',stop:'停止与恢复',escTitle:'按 Esc 停止操作',stopHint:'停止后保持暂停，准备好再恢复。普通鼠标移动和其他按键不会停止接管。',resume:'恢复桌面控制',extraStop:'其他停止方式',corner:'用鼠标停止操作',cornerHint:'鼠标在屏幕左上角停留约 500 毫秒后拒绝后续输入；关闭后仍可按 Esc 停止。',save:'保存更改',discard:'放弃更改',dirty:'有未保存的更改',clean:'更改后点击保存',ms:'毫秒'},
      en:{intro:'Choose the agent’s tools and how desktop control is shown and stopped.',toolsTitle:'Tool mode',toolsHint:'Lite covers everyday tasks. More tools can be loaded when needed.',lite:'Lite',full:'Full',liteSummary:'Common tools with less context',fullSummary:'All desktop tools at startup',liteCount:'10 initial tools',fullCount:'24 initial tools',modeAfter:'Mode changes take effect after the current action finishes.',indicatorTitle:'Takeover indicator',indicator:'Show screen edges and a banner',indicatorHint:'See when the agent is operating your computer.',position:'Banner position',top:'Top',bottom:'Bottom',preview:'Preview indicator',previewHint:'Save changes before previewing the actual screen indicator.',previewOff:'Indicator is off',previewOn:'Screen preview during control',previewNote:'The indicator keeps focus and lets clicks pass through.',appearance:'More indicator options',text:'Banner text',delay:'Keep visible after an action',delayHint:'Stay visible between consecutive actions. 200–3000 milliseconds.',stop:'Stop and resume',escTitle:'Press Esc to stop',stopHint:'Control stays paused until you resume. Ordinary mouse movement and other keys do not stop it.',resume:'Resume desktop control',extraStop:'Additional stop option',corner:'Top-left mouse-corner failsafe',cornerHint:'Refuse further input after the pointer stays in the top-left corner for about 500 ms. Turn off to use Esc alone.',save:'Save changes',discard:'Discard changes',dirty:'Unsaved changes',clean:'Save after making changes',ms:'ms'}
    };
    for(const lang of ['zh','en'])Object.assign(dictionaries[lang],extraCopy[lang]);
    Object.assign(dictionaries.zh,{intro:'选择 agent 使用的工具，设置接管提示与停止方式。',extraStop:'其他停止方式',corner:'用鼠标停止操作',cornerHint:'将鼠标移到桌面最左上角，停留约半秒，工具就会停止点击和输入。移开鼠标后可继续；Esc 始终可用。',githubLink:'GitHub · dsh-computer-use-win ↗',starRequest:'您的 Star 就是我更新的动力，球球了，这对我很重要！',issueBefore:'如果有问题，欢迎去',issueLink:'提 Issue',issueAfter:'，您来许愿，我来实现！我的响应也会很迅速的！'});
    Object.assign(dictionaries.en,{extraStop:'Other ways to stop',corner:'Stop using the mouse',cornerHint:'Move the pointer to the top-left corner of the desktop and leave it there for about half a second to stop clicks and typing. Move it away to continue. Esc is always available.',githubLink:'GitHub · dsh-computer-use-win ↗',starRequest:'Your Star keeps me motivated to update this project. Please, it means a lot to me!',issueBefore:'Found a problem or have a wish? ',issueLink:'Open an issue',issueAfter:' — you make the wish, I’ll work on it! I’ll be quick to respond.'});
    Object.assign(dictionaries.zh,{starPrefix:'您的 ',starLink:'Star',starAfter:' 就是我更新的动力，球球了，这对我很重要！',issueBefore:'如有问题，欢迎去',issueAfter:'，您来许愿，我来实现！'});
    Object.assign(dictionaries.en,{starPrefix:'Your ',starLink:'Star',starAfter:' keeps me motivated to update this project. Please, it means a lot to me! ',issueBefore:'Found a problem or have a wish? ',issueAfter:' — you make the wish, I’ll work on it!'});
    Object.assign(dictionaries.zh,{extraStop:'自定义停止方式',stopHint:'停止后保持暂停，准备好再恢复。普通鼠标移动不会停止接管。',shortcutHint:'点击“录制快捷键”，再按下想用的按键或组合键，例如 F8 或 Ctrl + Alt + K。保存后生效，Esc 始终保留。',record:'录制快捷键',rerecord:'重新录制',cancelRecord:'取消录制',clearShortcut:'清除',noShortcut:'尚未设置',listening:'请按下快捷键…（Esc 取消）',unsupportedKey:'请使用字母、数字、功能键或常用按键，可搭配 Ctrl、Alt、Shift、Win。',recordCancelled:'已取消录制',recordTimedOut:'录制已超时，请点击按钮重试。'});
    Object.assign(dictionaries.en,{extraStop:'Custom stop shortcut',stopHint:'Control stays paused until you resume. Ordinary mouse movement does not stop it.',shortcutHint:'Click Record shortcut, then press a key or combination, such as F8 or Ctrl + Alt + K. Save to apply. Esc always remains available.',record:'Record shortcut',rerecord:'Record again',cancelRecord:'Cancel recording',clearShortcut:'Clear',noShortcut:'Not set',listening:'Press your shortcut… (Esc to cancel)',unsupportedKey:'Use a letter, number, function key or common key, optionally with Ctrl, Alt, Shift or Win.',recordCancelled:'Recording cancelled',recordTimedOut:'Recording timed out. Click the button to try again.'});
    Object.assign(dictionaries.zh,{clearShortcut:'恢复默认（Esc）',noShortcut:'Esc（默认）',shortcutHint:'点击“录制快捷键”，再按下想用的按键或组合键，例如 F8 或 Ctrl + Alt + K。保存后生效；恢复默认后仅保留 Esc。',starTitle:'在 GitHub 上给项目 Star（在新窗口打开）',issueTitle:'在 GitHub 上提 Issue（在新窗口打开）'});
    Object.assign(dictionaries.en,{clearShortcut:'Restore default (Esc)',noShortcut:'Esc (default)',shortcutHint:'Click Record shortcut, then press a key or combination, such as F8 or Ctrl + Alt + K. Save to apply. Restoring the default keeps only Esc.',starTitle:'Star this project on GitHub (opens in a new window)',issueTitle:'Open a GitHub issue (opens in a new window)'});
    Object.assign(dictionaries.zh,{compactNote:'折叠',fullNote:'展开',compactNoteTitle:'折叠为 dsh-computer-use-win 链接，之后一直保持',fullNoteTitle:'展开完整的 Star 与 Issue 说明',indicatorIntro:'DSH 操作桌面时，用屏幕边缘、提示条和鼠标标签提醒你。',stopIntro:'随时中断当前这一轮桌面操作。',projectLink:'dsh-computer-use-win',projectTitle:'在 GitHub 上打开 dsh-computer-use-win（在新窗口打开）'});
    Object.assign(dictionaries.en,{compactNote:'Collapse',fullNote:'Expand',compactNoteTitle:'Collapse to the dsh-computer-use-win link; it stays collapsed',fullNoteTitle:'Expand the full Star and Issue note',indicatorIntro:'Screen edges, a status pill and a pointer tag show when DSH is using the desktop.',stopIntro:'Interrupt the current operation series at any time.',projectLink:'dsh-computer-use-win',projectTitle:'Open dsh-computer-use-win on GitHub (opens in a new window)'});
    Object.assign(dictionaries.zh,{cursorIndicator:'突出显示鼠标',cursorIndicatorHint:'接管时在鼠标下方显示柔和光斑和 DSH 标签，便于看清操作位置。停止或接管结束后自动消失。'});
    Object.assign(dictionaries.en,{cursorIndicator:'Highlight the pointer',cursorIndicatorHint:'Show a soft glow and a DSH tag at the pointer during control. They disappear when control stops or ends.'});
    Object.assign(dictionaries.zh,{toolsTitle:'工具加载',toolsHint:'默认加载全部工具。需要调整时，展开下方设置，选择 agent 可以使用的工具。',customTools:'自定义工具',toolsSelected:'已启用',toolsUnit:'个工具',allTools:'恢复默认（全部启用）',noTools:'全部关闭',toolAfter:'保存后，会在当前动作结束时更新可用工具。',toolGroup_observe:'屏幕与内容',toolGroup_input:'鼠标与键盘',toolGroup_windows:'窗口与控件',toolGroup_other:'等待与工具管理'});
    Object.assign(dictionaries.en,{toolsTitle:'Tool loading',toolsHint:'All tools are loaded by default. Expand the options below to choose which tools the agent can use.',customTools:'Customize tools',toolsSelected:'Enabled',toolsUnit:'tools',allTools:'Restore defaults (enable all)',noTools:'Disable all',toolAfter:'Saved tool changes take effect after the current action finishes.',toolGroup_observe:'Screen and content',toolGroup_input:'Mouse and keyboard',toolGroup_windows:'Windows and controls',toolGroup_other:'Waiting and tool management'});
    for(const entries of toolGroups.map(group=>group[1]))for(const [name,zh,en,zhHint,enHint]of entries){dictionaries.zh['tool_'+name]=zh;dictionaries.en['tool_'+name]=en;dictionaries.zh['toolHint_'+name]=zhHint;dictionaries.en['toolHint_'+name]=enHint;}
    Object.assign(dictionaries.zh,{toolsHint:'先选择整体加载方案，需要逐项调整时选择“自定义”。',full:'全部',fullSummary:'加载全部桌面工具，默认推荐',lite:'精简',liteSummary:'只加载常用工具，减少上下文占用',custom:'自定义',customSummary:'自己选择需要加载的工具',customTools:'自定义工具清单',allTools:'全选',customMemory:'切换方案会保留自定义清单。更改后点击保存。',lazy:'懒启动',lazySummary:'启动只加载管理入口，桌面工具按需加载',lazyCount:'启动 1 项 · 允许全部 24 项',lazyHint:'开始桌面任务时，agent 先加载所需工具，会多一次工具调用。已加载工具仍占用上下文。'});
    Object.assign(dictionaries.en,{toolsHint:'Choose a loading preset. Select Custom to choose individual tools.',full:'All',fullSummary:'Load every desktop tool; the default',lite:'Lite',liteSummary:'Common tools with less context',custom:'Custom',customSummary:'Choose exactly which tools to load',customTools:'Custom tool selection',allTools:'Select all',customMemory:'Switching presets keeps your custom selection. Save to apply.',lazy:'Lazy',lazySummary:'Start with management only; load desktop tools on demand',lazyCount:'1 at startup · all 24 allowed',lazyHint:'The agent loads tools before a desktop task, adding a tool call. Loaded tools still use context.'});
    Object.assign(dictionaries.zh,{remoteVisible:'远程与录屏可见',remoteVisibleHint:'让 UU 远程、屏幕共享和录屏看到接管提示与鼠标标识。默认开启，也适用于虚拟屏幕。'});
    Object.assign(dictionaries.en,{remoteVisible:'Visible in remote sessions and recordings',remoteVisibleHint:'Show the takeover indicator and pointer marker in remote access, screen sharing and recordings. On by default, including virtual displays.'});
    function shortcutFromEvent(event) {
      const code=event.code||'',special={Space:'Space',Enter:'Enter',NumpadEnter:'Enter',Tab:'Tab',Backspace:'Backspace',Delete:'Delete',Insert:'Insert',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Pause:'Pause',CapsLock:'CapsLock',NumLock:'NumLock',ScrollLock:'ScrollLock'};
      let key=/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit[0-9]$/.test(code)?code.slice(5):/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)?code:special[code];
      if(!key&&event.keyCode>=65&&event.keyCode<=90)key=String.fromCharCode(event.keyCode);
      if(!key&&event.keyCode>=48&&event.keyCode<=57)key=String.fromCharCode(event.keyCode);
      if(!key&&event.keyCode>=112&&event.keyCode<=135)key='F'+(event.keyCode-111);
      return key?[event.ctrlKey&&'Ctrl',event.altKey&&'Alt',event.shiftKey&&'Shift',event.metaKey&&'Win',key].filter(Boolean).join('+'):null;
    }
    const css=`
      [data-wincu-settings]{--wcu-card:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2,Canvas));--wcu-card-stroke:var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4,rgba(128,128,128,.34)));--wcu-sunken:var(--dsw-alias-bg-module-platform,color-mix(in srgb,CanvasText 4%,Canvas));--wcu-control:var(--dsw-alias-bg-layer-1,Canvas);--wcu-fg:var(--dsw-alias-label-primary,CanvasText);--wcu-muted:var(--dsw-alias-label-secondary,#61666b);--wcu-subtle:var(--dsw-alias-label-tertiary,#81858c);--wcu-line:var(--dsw-alias-border-l2,rgba(128,128,128,.2));--wcu-line-strong:var(--dsw-alias-border-l3,rgba(128,128,128,.3));--wcu-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));--wcu-accent:var(--dsw-alias-state-business-primary,#4176e6);--wcu-primary:var(--dsw-alias-button-primary-fill,#0f1115);--wcu-primary-fg:var(--dsw-alias-label-primary-foreground,#fff);--wcu-selected:var(--dsw-static-neutral-bluish-400,#adb2b8);--wcu-tip-bg:var(--dsw-alias-tooltip-bg,#2b2f36);--wcu-tip-fg:#fff;color:var(--wcu-fg);font:14px/1.55 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif);max-width:720px;list-style:none;box-sizing:border-box;margin:0;padding:0 0 8px}
      [data-wincu-settings] *{box-sizing:border-box}
      [data-wincu-settings] h2{font-size:18px;line-height:1.4;font-weight:600;margin:0}
      [data-wincu-settings] h3{font-size:15px;line-height:22px;font-weight:600;margin:0}
      [data-wincu-settings] p{margin:4px 0 0;color:var(--wcu-muted);font-size:13px;line-height:1.55}
      [data-wincu-settings] .wcu-header{padding:0 0 12px}
      [data-wincu-settings] .wcu-header>p{color:var(--wcu-subtle)}
      [data-wincu-settings] .wcu-community{display:flex;align-items:flex-start;gap:12px;padding:9px 8px 9px 14px;margin:0 0 18px;border:.5px solid var(--wcu-card-stroke);border-radius:var(--dsw-radius-md,12px);background:var(--wcu-card)}
      [data-wincu-settings] .wcu-community p{flex:1;min-width:0;margin:0;font-size:12.5px;line-height:1.95;color:var(--wcu-muted)}
      [data-wincu-settings] .wcu-community a{display:inline-flex;align-items:center;gap:5px;vertical-align:baseline;white-space:nowrap;margin:0 3px;padding:1px 9px;border:.5px solid var(--wcu-line-strong);border-radius:999px;background:var(--wcu-control);color:var(--wcu-fg);font-size:12px;line-height:20px;font-weight:500;text-decoration:none;cursor:pointer;transition:background .15s,border-color .15s}
      [data-wincu-settings] .wcu-community a:hover{background:var(--wcu-hover);border-color:var(--wcu-subtle)}
      [data-wincu-settings] .wcu-community a:focus-visible{outline:2px solid var(--wcu-accent);outline-offset:2px}
      [data-wincu-settings] .wcu-community svg{width:13px;height:13px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      [data-wincu-settings] .wcu-community a svg:last-child{width:11px;height:11px;opacity:.6}
      [data-wincu-settings] .wcu-community[data-compact]{align-items:center;gap:4px;padding:0;border:0;background:none;margin-bottom:14px}
      [data-wincu-settings] .wcu-community[data-compact] p{flex:none}
      [data-wincu-settings] .wcu-community[data-compact] a{margin-left:0}
      [data-wincu-settings] .wcu-fold{flex:none;gap:2px;height:26px;padding:0 8px 0 4px;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--wcu-subtle);font-size:12px}
      [data-wincu-settings] .wcu-fold:hover:enabled{background:var(--wcu-hover);color:var(--wcu-fg)}
      [data-wincu-settings] .wcu-fold svg{width:14px;height:14px;fill:currentColor;stroke:none;transition:transform .15s}
      [data-wincu-settings] .wcu-fold[aria-expanded=false] svg{transform:rotate(-90deg)}
      [data-wincu-settings] [data-wincu-tool-count]{flex:none;font-size:12px;line-height:20px;color:var(--wcu-muted);padding:2px 10px;border-radius:999px;background:var(--wcu-sunken)}
      [data-wincu-settings] input[type=radio],[data-wincu-settings] input[type=checkbox]{accent-color:var(--wcu-accent);width:16px;height:16px;flex:none;margin:2px 0 0}
      [data-wincu-settings] summary{cursor:pointer;color:var(--wcu-fg);font-size:13px;font-weight:500;list-style:none;display:flex;align-items:center;gap:7px;padding:11px 0;width:fit-content}
      [data-wincu-settings] summary::-webkit-details-marker{display:none}
      [data-wincu-settings] summary:before{content:'';width:0;height:0;border-style:solid;border-width:4.5px 0 4.5px 6px;border-color:transparent transparent transparent currentColor;opacity:.55;transition:transform .15s}
      [data-wincu-settings] details[open]>summary:before{transform:rotate(90deg)}
      [data-wincu-settings] .wcu-tool-detail[hidden]{display:none}
      [data-wincu-settings] .wcu-tool-body{padding:0 0 10px}
      [data-wincu-settings] .wcu-tool-toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px}
      [data-wincu-settings] .wcu-tool-group{border:0;border-top:.5px solid var(--wcu-line);padding:10px 0 2px;margin:8px 0 0;min-width:0}
      [data-wincu-settings] .wcu-tool-group legend{float:left;width:100%;padding:0;margin:0 0 6px}
      [data-wincu-settings] .wcu-tool-group-label{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;cursor:pointer}
      [data-wincu-settings] .wcu-tool-group-label input{margin:0}
      [data-wincu-settings] .wcu-tool-group-label .wcu-tool-count{margin-left:auto;font-weight:400}
      [data-wincu-settings] .wcu-tool-grid{clear:both;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 12px}
      [data-wincu-settings] .wcu-tool-item{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer;min-width:0}
      [data-wincu-settings] .wcu-tool-item:hover{background:var(--wcu-hover)}
      [data-wincu-settings] .wcu-tool-item strong{display:block;font-size:13px;font-weight:500;line-height:20px}
      [data-wincu-settings] .wcu-tool-item small{display:block;font-size:12px;color:var(--wcu-subtle);line-height:1.45}
      [data-wincu-settings] .wcu-tool-count{font-size:12px;color:var(--wcu-subtle);white-space:nowrap}
      [data-wincu-settings] .wcu-segment{display:inline-flex;width:fit-content;gap:2px;padding:2px;border-radius:10px;background:var(--wcu-control);border:.5px solid var(--wcu-line-strong)}
      [data-wincu-settings] .wcu-segment label{position:relative;display:inline-flex;align-items:center;padding:4px 14px;border-radius:8px;font-size:13px;color:var(--wcu-muted);cursor:pointer;transition:background .15s,color .15s}
      [data-wincu-settings] .wcu-segment label:has(input:checked){background:color-mix(in srgb,var(--wcu-fg) 10%,var(--wcu-control));color:var(--wcu-fg)}
      [data-wincu-settings] .wcu-segment label:has(input:focus-visible){outline:2px solid var(--wcu-accent);outline-offset:1px}
      [data-wincu-settings] .wcu-segment label:has(input:disabled){opacity:.45;cursor:not-allowed}
      [data-wincu-settings] .wcu-segment input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
      [data-wincu-settings] .wcu-control{font:inherit;font-size:13px;color:var(--wcu-fg);background:var(--wcu-control);border:.5px solid var(--wcu-line-strong);border-radius:var(--dsw-radius-sm,8px);padding:7px 10px;min-height:34px;max-width:100%;width:100%}
      [data-wincu-settings] .wcu-number{display:flex;gap:8px;align-items:center;color:var(--wcu-subtle);font-size:12px}
      [data-wincu-settings] .wcu-number input{width:100px}
      [data-wincu-settings] .wcu-key{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:26px;padding:0 8px;font:600 12px/1 'Segoe UI',sans-serif;color:var(--wcu-fg);border:.5px solid var(--wcu-line-strong);border-bottom-width:2px;border-radius:6px;background:var(--wcu-control)}
      [data-wincu-settings] .wcu-shortcut-value[data-recording=true]{border-color:var(--wcu-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--wcu-accent) 22%,transparent)}
      [data-wincu-settings] button{font:inherit;font-size:13px;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border:.5px solid var(--wcu-line-strong);border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--wcu-fg);cursor:pointer;white-space:nowrap;transition:background .15s,opacity .15s}
      [data-wincu-settings] button:hover:enabled{background:var(--wcu-hover)}
      [data-wincu-settings] button.wcu-primary{background:var(--wcu-primary);border-color:transparent;color:var(--wcu-primary-fg)}
      [data-wincu-settings] button.wcu-primary:hover:enabled{background:var(--wcu-primary);opacity:.86}
      [data-wincu-settings] button.wcu-small{height:28px;padding:0 10px;font-size:12px;border-radius:var(--dsw-radius-sm,8px)}
      [data-wincu-settings] button:disabled,[data-wincu-settings] input:disabled,[data-wincu-settings] fieldset:disabled{opacity:.4;cursor:not-allowed}
      [data-wincu-settings] .wcu-control:focus-visible,[data-wincu-settings] button:focus-visible,[data-wincu-settings] input:focus-visible,[data-wincu-settings] summary:focus-visible{outline:2px solid var(--wcu-accent);outline-offset:2px}
      [data-wincu-settings] .wcu-footer{position:sticky;bottom:12px;z-index:1;display:flex;gap:12px;justify-content:space-between;align-items:center;margin-top:4px;padding:10px 10px 10px 16px;border:.5px solid var(--wcu-card-stroke);border-radius:var(--dsw-radius-lg,16px);background:var(--wcu-card);box-shadow:0 8px 24px rgba(0,0,0,.12)}
      [data-wincu-settings] .wcu-actions{display:flex;gap:8px}
      [data-wincu-settings] .wcu-status{font-size:12px;color:var(--wcu-subtle)}
      [data-wincu-settings] [data-tone=error]{color:var(--dsw-alias-state-error-primary,#d93f3f)}
      [data-wincu-settings] [data-tone=success]{color:var(--dsw-alias-state-success-primary,#2f9e5b)}
      [data-wincu-settings] .wcu-section{border:.5px solid var(--wcu-card-stroke);border-radius:var(--dsw-radius-xl,20px);background:var(--wcu-card);padding:8px 14px 12px;margin-bottom:10px}
      [data-wincu-settings] .wcu-section-head{display:flex;align-items:center;gap:4px;min-height:34px;margin-bottom:6px}
      [data-wincu-settings] .wcu-end{margin-left:auto}
      [data-wincu-settings] .wcu-section-head>.wcu-end{display:flex;align-items:center;gap:8px}
      [data-wincu-settings] .wcu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px 16px}
      [data-wincu-settings] .wcu-item{display:flex;align-items:center;gap:12px;min-width:0}
      [data-wincu-settings] .wcu-item-main{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
      [data-wincu-settings] .wcu-item-title{display:block;font-size:14px;line-height:22px;color:var(--wcu-fg)}
      [data-wincu-settings] label.wcu-item-title{cursor:pointer}
      [data-wincu-settings] .wcu-nowrap{white-space:nowrap}
      [data-wincu-settings] .wcu-item-title .wcu-info{vertical-align:top;margin-left:2px}
      [data-wincu-settings] .wcu-caption{font-size:12px;line-height:18px;color:var(--wcu-subtle)}
      [data-wincu-settings] .wcu-hint{margin:6px 0 10px;font-size:12px;color:var(--wcu-subtle)}
      [data-wincu-settings] .wcu-item-main .wcu-hint{margin:0}
      [data-wincu-settings] .wcu-art{flex:none;display:flex;align-items:center;justify-content:center;width:96px;height:60px;border-radius:var(--dsw-radius-md,12px);background:var(--wcu-sunken);border:.5px solid var(--wcu-line);overflow:hidden;transition:border-color .15s,opacity .15s;--wcu-desk:color-mix(in srgb,var(--wcu-accent) 13%,var(--wcu-control));--wcu-bar:color-mix(in srgb,var(--wcu-fg) 7%,var(--wcu-control));--wcu-ink:color-mix(in srgb,var(--wcu-fg) 16%,transparent);--wcu-ink-strong:color-mix(in srgb,var(--wcu-fg) 34%,transparent)}
      [data-wincu-settings] .wcu-art>svg{display:block;width:100%;height:100%}
      [data-wincu-settings] label.wcu-art{cursor:pointer}
      [data-wincu-settings] label.wcu-art:hover{border-color:var(--wcu-line-strong)}
      [data-wincu-settings] .wcu-item:has(input:disabled) .wcu-art{cursor:not-allowed;opacity:.55}
      [data-wincu-settings] .wcu-art .a-win{fill:var(--wcu-control)}
      [data-wincu-settings] .wcu-art .a-frame{fill:none;stroke:var(--wcu-line-strong);stroke-width:.75}
      [data-wincu-settings] .wcu-art .a-desk{fill:var(--wcu-desk);stroke:var(--wcu-line-strong);stroke-width:.75}
      [data-wincu-settings] .wcu-art .a-bar{fill:var(--wcu-bar)}
      [data-wincu-settings] .wcu-art .a-sep{fill:none;stroke:var(--wcu-line-strong);stroke-width:.5}
      [data-wincu-settings] .wcu-art .a-ink{fill:var(--wcu-ink)}
      [data-wincu-settings] .wcu-art .a-ink2{fill:var(--wcu-ink-strong)}
      [data-wincu-settings] .wcu-art .a-acc{fill:var(--wcu-accent)}
      [data-wincu-settings] .wcu-art .a-edge{stroke:var(--wcu-accent);stroke-width:1.2}
      [data-wincu-settings] .wcu-art .a-caret{fill:none;stroke:var(--wcu-accent);stroke-width:1}
      [data-wincu-settings] .wcu-art .a-glow{fill:none;stroke:var(--wcu-accent);stroke-width:1.3}
      [data-wincu-settings] .wcu-art .a-soft{stroke-width:4;stroke-opacity:.22}
      [data-wincu-settings] .wcu-art .a-pill{fill:#23262d;stroke:rgba(255,255,255,.24);stroke-width:.6}
      [data-wincu-settings] .wcu-art .a-dot{fill:#7aaaff}
      [data-wincu-settings] .wcu-art .a-text{fill:#fff;fill-opacity:.85}
      [data-wincu-settings] .wcu-art .a-key{fill:none;stroke:#fff;stroke-opacity:.55;stroke-width:.7}
      [data-wincu-settings] .wcu-art .a-ptr{fill:#fff;stroke:#1d2025;stroke-width:1;stroke-linejoin:round}
      [data-wincu-settings] .wcu-art .a-dsh{fill:var(--wcu-accent);stroke:#fff;stroke-width:1;stroke-linejoin:round;filter:drop-shadow(0 0 1.6px var(--wcu-accent))}
      [data-wincu-settings] .wcu-art .a-ghost{fill:none;stroke:var(--wcu-ink-strong);stroke-width:.9;stroke-dasharray:3 2}
      [data-wincu-settings] .wcu-art .a-open{fill:none;stroke:var(--wcu-accent);stroke-width:.9;stroke-dasharray:2 1.6}
      [data-wincu-settings] .wcu-art .a-eye{fill:none;stroke:var(--wcu-ink-strong);stroke-width:1.1;stroke-linecap:round;stroke-linejoin:round}
      [data-wincu-settings] .wcu-art .a-spot0{stop-color:var(--wcu-accent);stop-opacity:.42}
      [data-wincu-settings] .wcu-art .a-spot1{stop-color:var(--wcu-accent);stop-opacity:0}
      [data-wincu-settings] .wcu-art .a-tag{fill:#fff;font:700 7px/1 'Segoe UI',sans-serif}
      [data-wincu-settings] .wcu-art .a-cap{fill:var(--wcu-fg);font:600 12px/1 'Segoe UI',sans-serif}
      [data-wincu-settings] .wcu-item:has(.wcu-presets)>.wcu-item-main{flex:1}
      [data-wincu-settings] .wcu-segment.wcu-presets{display:flex;width:auto;align-self:stretch}
      [data-wincu-settings] .wcu-presets>label{flex:1;justify-content:center}
      [data-wincu-settings] .wcu-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px 16px;padding:0 0 6px}
      [data-wincu-settings] .wcu-field{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:36px;font-size:13px;color:var(--wcu-muted)}
      [data-wincu-settings] .wcu-field>.wcu-item-title{font-size:13px;line-height:22px;color:var(--wcu-muted)}
      [data-wincu-settings] .wcu-info{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border-radius:50%;color:var(--wcu-subtle);cursor:help;outline:none}
      [data-wincu-settings] .wcu-info>svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round}
      [data-wincu-settings] .wcu-info:hover,[data-wincu-settings] .wcu-info[data-open],[data-wincu-settings] .wcu-info:focus-visible{color:var(--wcu-fg);background:var(--wcu-hover)}
      [data-wincu-settings] .wcu-info:focus-visible{box-shadow:0 0 0 2px var(--wcu-accent)}
      [data-wincu-settings] .wcu-tip{display:none;position:fixed;inset:auto;margin:0;z-index:2147483000;width:max-content;max-width:min(300px,calc(100vw - 16px));padding:8px 11px;overflow:visible;border-radius:var(--dsw-radius-sm,8px);background:var(--wcu-tip-bg);color:var(--wcu-tip-fg);border:.5px solid rgba(255,255,255,.1);font-size:12px;font-weight:400;line-height:1.6;text-align:left;white-space:normal;box-shadow:0 6px 20px rgba(0,0,0,.2);cursor:default}
      [data-wincu-settings] .wcu-tip[data-open]{display:block;animation:wcu-tip-in .12s ease-out}
      [data-wincu-settings] .wcu-tip:after{content:'';position:absolute;width:7px;height:7px;background:inherit;border:inherit;transform:rotate(45deg)}
      [data-wincu-settings] .wcu-tip[data-side=top]:after{left:calc(var(--wcu-caret,50%) - 4px);bottom:-4px;border-top:0;border-left:0}
      [data-wincu-settings] .wcu-tip[data-side=bottom]:after{left:calc(var(--wcu-caret,50%) - 4px);top:-4px;border-bottom:0;border-right:0}
      [data-wincu-settings] .wcu-tip[data-side=left]:after{right:-4px;top:calc(50% - 4px);border-bottom:0;border-left:0}
      @keyframes wcu-tip-in{from{opacity:0}}
      [data-wincu-settings] input[role=switch]{appearance:none;flex:none;width:36px;height:20px;margin:0;border-radius:999px;background:var(--dsw-alias-border-l4,rgba(128,128,128,.38));position:relative;cursor:pointer;transition:background .15s}
      [data-wincu-settings] input[role=switch]:after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
      [data-wincu-settings] input[role=switch]:checked{background:var(--wcu-accent)}
      [data-wincu-settings] input[role=switch]:checked:after{transform:translateX(16px)}
      [data-wincu-settings] .wcu-field .wcu-text{width:min(190px,100%)}
      [data-wincu-settings] .wcu-detail>summary{padding:10px 0 8px}
      [data-wincu-settings] .wcu-tool-detail{margin:12px 0 0;border:.5px solid var(--wcu-line-strong);border-radius:var(--dsw-radius-md,12px);padding:0 14px}
      [data-wincu-settings] .wcu-shortcut-value{flex-wrap:wrap;align-content:center;gap:2px;padding:4px;font-size:12px;line-height:1.4;color:var(--wcu-muted);text-align:center}
      [data-wincu-settings] .wcu-shortcut-value .wcu-key{min-width:22px;height:20px;padding:0 5px;font-size:10.5px}
      [data-wincu-settings] .wcu-shortcut-value small{font-size:11px;color:var(--wcu-subtle)}
      [data-wincu-settings] .wcu-plus{font-size:9px;color:var(--wcu-subtle)}
      [data-wincu-settings] .wcu-shortcut-value:is([data-keys='3'],[data-keys='4']) .wcu-key{min-width:18px;padding:0 3px;font-size:9.5px}
      [data-wincu-settings] .wcu-shortcut-value[data-recording=true] small{flex-basis:100%}
      [data-wincu-settings] select.wcu-control{width:auto;min-width:132px;min-height:30px;padding:4px 8px;cursor:pointer}
      [data-wincu-settings] .wcu-notice{margin:12px 0 2px;padding:10px 14px 4px;border-radius:var(--dsw-radius-md,12px);background:var(--wcu-sunken);border:.5px solid var(--wcu-line);font-size:12.5px;line-height:1.6;color:var(--wcu-muted)}
      [data-wincu-settings] .wcu-notice strong{display:block;margin:0 0 2px;font-size:13px;font-weight:600;color:var(--wcu-fg)}
      [data-wincu-settings] .wcu-notice ol,[data-wincu-settings] .wcu-notice ul{margin:0 0 8px;padding-left:20px}
      [data-wincu-settings] .wcu-notice li{margin:2px 0}
      [data-wincu-settings] .wcu-address{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:4px 0}
      [data-wincu-settings] .wcu-address code{font:12px/1.5 Consolas,'Cascadia Mono',monospace;color:var(--wcu-fg);background:var(--wcu-control);border:.5px solid var(--wcu-line-strong);border-radius:6px;padding:1px 6px;user-select:all;overflow-wrap:anywhere}
      [data-wincu-settings] .wcu-address button.wcu-small{height:24px;padding:0 8px;border-radius:6px}
      @media(max-width:640px){[data-wincu-settings] .wcu-tool-grid{grid-template-columns:1fr}[data-wincu-settings] .wcu-section{padding:8px 14px 12px}[data-wincu-settings] .wcu-footer{flex-wrap:wrap}}
    `;
    Object.assign(dictionaries.zh,{pluginDescription:'让 AI 操作 Windows 桌面，支持控制提示、停止快捷键和工具选择。',openSettings:'点击进行具体设置 →',notLoaded:'未能读取电脑操控设置。宿主尚未提供此配置，请刷新页面或重新启动 DSH 后重试。',loadingSettings:'正在读取电脑操控设置…',reloadSettings:'刷新页面',delayHint:'整轮操作结束后再隐藏提示。范围 200–3000 毫秒。'});
    Object.assign(dictionaries.en,{pluginDescription:'Let the agent use Windows apps, with control indicators, stop shortcuts and tool selection.',openSettings:'Click to configure →',notLoaded:'Computer Use settings could not be read. The host has not exposed this configuration. Refresh or restart DSH.',loadingSettings:'Loading Computer Use settings…',reloadSettings:'Refresh page',delayHint:'Hide the indicator after the complete operation series ends. Range: 200–3000 ms.'});
    Object.assign(dictionaries.zh,{stop:'停止操作',stopHint:'Esc 只停止当前这一轮操作。下次发起任务或说“继续”即可再次使用，无需到设置恢复。普通鼠标移动和其他按键不会停止。',previewed:'已请求预览',indicatorHint:'操作和短暂思考期间持续显示；最后一次桌面操作完成后，空闲 30 秒自动收起。'});
    Object.assign(dictionaries.en,{stop:'Stop control',stopHint:'Esc stops this operation series. A new task or a request to continue can use the desktop automatically, with no settings change. Ordinary pointer movement and other keys do not stop control.',previewed:'Preview requested',indicatorHint:'Stay visible through actions and short reasoning gaps; hide after 30 seconds without another desktop action.'});
    // Chinese first: a feature's English name appears once, in brackets, where
    // the page first names it. Each hint sits behind an info icon.
    Object.assign(dictionaries.zh,{title:'电脑操控（Computer Use）',intro:'让 DSH 操作 Windows 桌面程序和网页。',moreInfo:'说明',pluginDescription:'让 AI 操作 Windows 桌面程序和网页，可设置浏览器操控、接管提示、停止快捷键和工具。',
      browserTitle:'浏览器操控（Browser Use）',browserInfo:'DSH 专用浏览器单独启动，不会用到你自己的浏览器。默认每次使用临时的空白配置，不带你的登录、Cookie 和浏览记录；打开“记住登录”后改用长期保留的配置。退出 DSH 或空闲 10 分钟后自动关闭。',
      browserApp:'使用的浏览器',browserAppHint:'默认跟随 Windows 的默认浏览器；默认浏览器不是 Edge 或 Chrome 时，使用已安装的 Chrome 或 Edge。更改在当前动作结束后生效，并关闭已打开的 DSH 浏览器。',
      browserApp_default:'默认浏览器',browserApp_edge:'Edge',browserApp_chrome:'Chrome',browserAppShort:'默认',
      browserSignIn:'记住登录（cookies）',browserSignInHint:'默认关闭：DSH 浏览器每次用全新的临时配置，网站看不到任何登录。打开后改用长期保留的配置，你在它窗口里登录过的网站会一直保持登录，见下方说明。更改在当前动作结束后生效，并关闭已打开的 DSH 浏览器。',
      signInSetup:'怎么用',signInStep1:'DSH 浏览器改用长期保留的配置。在它的窗口（蓝框）里登录过的网站，下次还是登录状态。你的浏览器里不用做任何设置，也不会弹出允许提示。',
      signInStep2:'第一次用到要登录的网站时，DSH 会请你在它的窗口里登录一次。密码和验证码由你自己输入，DSH 不代填。',
      signInStepHidden:'现在“显示浏览器窗口”是关着的，看不到 DSH 浏览器，要先打开它才能登录。',
      signInStepEdge:'用 Edge 时，Edge 会自动用你 Windows 上的微软账户登录这个配置，必应、Outlook 等微软网站会直接是登录状态；不想这样就选 Chrome。',
      signInStep3:'登录保存在这台电脑的下面这个文件夹里，关掉开关也不会删除。要清除全部登录，退出 DSH 后删除这个文件夹。',
      signInRisks:'风险',signInRisk1:'DSH 会以你的身份操作你在 DSH 浏览器里登录过的网站，发消息、下单、删除都可能发生。agent 被要求在这类操作前先问你，但不能完全保证。',
      signInRisk2:'网页上的文字可能诱导 agent 做你没让它做的事。',signInRisk3:'DSH 浏览器开着时，本机上的其他程序也能通过它的调试端口连上它，用你在里面的登录身份访问网站。',
      copy:'复制',copied:'已复制',
      browserFirst:'网页优先用浏览器操控',browserFirstHint:'能直接读写网页时在后台完成，不移动鼠标；浏览器自己的模态弹窗可能来到前台。桌面程序、浏览器工具栏和读不到的网页内容，仍由电脑操控完成。',
      browserVisible:'显示浏览器窗口',browserVisibleHint:'开启时打开一个可见的 DSH 浏览器窗口，窗口框是 DSH 蓝；DSH 正在操作的标签页，图标换成蓝色箭头，网页上的小箭头标出它点的位置，不遮挡网页内容，也不移动你的鼠标。普通网页操作在后台完成；浏览器自己的模态弹窗可能短暂来到前台。关闭后浏览器在后台运行，看不到窗口。更改在当前动作结束后生效，并关闭已打开的 DSH 浏览器。',
      toolsTitle:'工具',toolsInfo:'全部：启动时加载 24 个工具。精简：只加载 10 个常用工具，减少上下文占用。懒启动：启动时只加载管理入口，开始桌面任务时再加载，会多一次工具调用。自定义：自己挑选，切换方案时保留清单。保存后在当前动作结束时生效。',
      indicatorTitle:'接管提示',indicatorInfo:'DSH 用鼠标和键盘操作桌面时，用屏幕边缘、提示条和鼠标标签提醒你。浏览器操控、读取界面和在后台完成的控件操作不显示这些提示。',
      indicator:'屏幕边缘与提示条',appearance:'更多选项',preview:'预览',delay:'操作后保留提示',
      escTitle:'按 Esc 停止',stopHint:'Esc 只停止当前这一轮操作；下次发起任务或说“继续”即可再次使用，无需到设置恢复。普通鼠标移动和其他按键不会停止。浏览器操控在后台进行，不占用 Esc，要停止请用 DSH 里的停止按钮。'});
    Object.assign(dictionaries.en,{title:'Computer Use',intro:'Let DSH operate Windows desktop apps and web pages.',moreInfo:'Details',pluginDescription:'Let the agent use Windows apps and web pages, with Browser Use, control indicators, stop shortcuts and tool selection.',
      browserTitle:'Browser Use',browserInfo:'The DSH browser starts separately and never uses your own browser. By default it starts each time with a temporary empty profile: none of your sign-ins, cookies or history. With “Keep sign-ins” on, it keeps one profile instead. It closes when DSH exits or after 10 idle minutes.',
      browserApp:'Browser',browserAppHint:'Follows the Windows default browser. When that is neither Edge nor Chrome, an installed Chrome or Edge is used. Changes apply after the current action and close open DSH browsers.',
      browserApp_default:'Default browser',browserApp_edge:'Edge',browserApp_chrome:'Chrome',browserAppShort:'Default',
      browserSignIn:'Keep sign-ins (cookies)',browserSignInHint:'Off by default: the DSH browser starts each time with a fresh temporary profile, so sites see no sign-ins. When on, it keeps one profile, and sites you sign in to in its window stay signed in; see below. Changes apply after the current action and close open DSH browsers.',
      signInSetup:'How it works',signInStep1:'The DSH browser keeps its profile. Sites you sign in to in its window (the blue frame) are still signed in next time. Nothing to set up in your own browser, and no prompts to allow.',
      signInStep2:'The first time a task needs a site that asks you to sign in, DSH asks you to sign in once in its window. You type passwords and codes yourself; DSH does not fill them in.',
      signInStepHidden:'“Show the browser window” is off now, so the DSH browser cannot be seen. Turn it on to sign in.',
      signInStepEdge:'With Edge, Edge signs this profile in with the Microsoft account of your Windows, so Bing, Outlook and other Microsoft sites are signed in already. To avoid that, choose Chrome.',
      signInStep3:'Sign-ins are kept on this computer in the folder below, also after you turn this off. To remove them all, exit DSH and delete the folder.',
      signInRisks:'Risks',signInRisk1:'DSH acts as you on the sites you signed in to in the DSH browser: it can send messages, place orders or delete things. The agent is told to ask you first, but this cannot be guaranteed.',
      signInRisk2:'Text on a web page can try to make the agent do things you did not ask for.',signInRisk3:'While the DSH browser runs, other programs on this computer can also connect to it through its debugging port and use the sign-ins in it.',
      copy:'Copy',copied:'Copied',
      browserFirst:'Prefer Browser Use for web pages',browserFirstHint:'Read and operate pages directly in the background without moving the pointer. Browser-native modal dialogs may activate their window. Desktop apps, the browser toolbar and page content it cannot read still go through Computer Use.',
      browserVisible:'Show the browser window',browserVisibleHint:'When on, a visible DSH browser window opens with a DSH-blue frame. The tab DSH works in shows a blue arrow as its icon, and a small arrow on the page marks where it clicks; nothing covers the page and your pointer stays put. Ordinary page actions run in the background; browser-native modal dialogs may briefly activate the window. When off, the browser runs in the background with no window. Changes apply after the current action and close open DSH browsers.',
      toolsTitle:'Tools',toolsInfo:'All: load 24 tools at startup. Lite: 10 common tools, less context. Lazy: only the management entry at startup; tools load at the first desktop task, adding one tool call. Custom: your own selection, kept when you switch presets. Saved changes apply after the current action.',
      indicatorTitle:'Takeover indicator',indicatorInfo:'Screen edges, a banner and a pointer tag show when DSH uses your mouse and keyboard. Browser Use, reading the screen and control actions done in the background show none of them.',
      indicator:'Screen edges and banner',appearance:'More options',preview:'Preview',delay:'Keep visible after an action',
      escTitle:'Press Esc to stop',stopHint:'Esc stops this operation series. A new task or a request to continue resumes automatically, with no settings change. Ordinary pointer movement and other keys do not stop control. Browser Use runs in the background and does not use Esc; stop it with the stop button in DSH.'});
    Object.assign(dictionaries.zh,{escAlways:'始终可用',listening:'请按下快捷键…',listeningCancel:'按 Esc 取消'});
    Object.assign(dictionaries.en,{escAlways:'Always on',listening:'Press your shortcut…',listeningCancel:'Esc to cancel'});
    // A hint opens on hover, focus or click, above its icon: a pointer hangs
    // down and to the right of its tip, so even a large pointer leaves the text
    // readable. The pointer can rest on the hint, and a click keeps it open.
    // It shows in the top layer, where no scroller or dialog clips it.
    function Info({id,label,text}){
      const anchor=React.useRef(null),tip=React.useRef(null),timer=React.useRef(0);
      const [open,setOpen]=React.useState(false),[pinned,setPinned]=React.useState(false);
      const show=(next,delay)=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{setOpen(next);if(!next)setPinned(false);},delay);};
      const toggle=()=>{if(pinned)show(false,0);else{clearTimeout(timer.current);setOpen(true);setPinned(true);}};
      React.useEffect(()=>()=>clearTimeout(timer.current),[]);
      React.useLayoutEffect(()=>{
        const icon=anchor.current,el=tip.current;
        if(!open||!icon||!el)return;
        try{el.showPopover();}catch{}
        const r=icon.getBoundingClientRect(),width=el.offsetWidth,height=el.offsetHeight,view=document.documentElement,gap=8,edge=8;
        let side='top',left=r.left+r.width/2-width/2,top=r.top-gap-height;
        if(top<edge){if(r.left-gap-width>=edge){side='left';left=r.left-gap-width;top=r.top+r.height/2-height/2;}else{side='bottom';top=r.bottom+gap;}}
        left=Math.max(edge,Math.min(left,view.clientWidth-edge-width));top=Math.max(edge,Math.min(top,view.clientHeight-edge-height));
        Object.assign(el.style,{left:left+'px',top:top+'px'});el.dataset.side=side;el.style.setProperty('--wcu-caret',Math.round(r.left+r.width/2-left)+'px');
        const close=()=>{clearTimeout(timer.current);setOpen(false);setPinned(false);};
        const key=event=>{if(event.key==='Escape'){event.stopPropagation();close();}};
        const press=event=>{if(!icon.contains(event.target))close();};
        window.addEventListener('scroll',close,true);window.addEventListener('resize',close);window.addEventListener('keydown',key,true);window.addEventListener('pointerdown',press,true);
        return ()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',press,true);try{el.hidePopover();}catch{}};
      },[open]);
      return h('span',{className:'wcu-info',ref:anchor,tabIndex:0,role:'button','aria-label':label,'aria-describedby':id,'data-open':open||undefined,
        onPointerEnter:()=>show(true,120),onPointerLeave:()=>{if(!pinned)show(false,250);},onFocus:()=>show(true,0),onBlur:()=>{if(!pinned)show(false,0);},
        onClick:event=>{event.preventDefault();if(!tip.current?.contains(event.target))toggle();},onKeyDown:event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}}},
        h('svg',{viewBox:'0 0 16 16','aria-hidden':true,focusable:false},h('circle',{cx:8,cy:8,r:6.4}),h('path',{d:'M8 7.3v3.9M8 4.9v.2'})),
        h('span',{className:'wcu-tip',id,role:'tooltip',ref:tip,popover:'manual','data-open':open||undefined},text));
    }
    // Where the DSH browser keeps its profiles (kept-edge, kept-chrome), in the
    // form File Explorer's address bar accepts.
    const KEPT_FOLDER='%LOCALAPPDATA%\\dsh-computer-use-win\\agent-browser';
    // Copies a folder path to paste into File Explorer. Without clipboard
    // access the path is left selected.
    function CopyButton({text,t}){
      const [done,setDone]=React.useState(false);
      React.useEffect(()=>{if(!done)return;const timer=setTimeout(()=>setDone(false),1500);return ()=>clearTimeout(timer);},[done]);
      const copy=async event=>{
        const code=event.currentTarget.previousElementSibling;
        let ok=true;
        try{await navigator.clipboard.writeText(text);}
        catch{const range=document.createRange(),selection=getSelection();range.selectNodeContents(code);selection.removeAllRanges();selection.addRange(range);ok=document.execCommand('copy');}
        setDone(ok);
      };
      return h('button',{type:'button',className:'wcu-small',onClick:copy},t(done?'copied':'copy'));
    }
    // Each setting has a small picture of what it changes. The pictures use the
    // page's theme tokens through the a-* classes in css.
    const drawing=(...children)=>h('svg',{viewBox:'0 0 112 70','aria-hidden':true,focusable:false},...children);
    const box=(className,x,y,width,height,rx=0)=>h('rect',{className,x,y,width,height,rx});
    const arrow=(x,y)=>h('path',{className:'a-ptr',d:`M${x} ${y}v15.5l3.8-3.6 2.7 6.1 2.6-1.1-2.7-6h5.4z`});
    // DSH's own pointer inside a page: smaller, in the accent colour.
    const dshArrow=(x,y)=>h('path',{className:'a-dsh',d:`M${x} ${y}v11l2.7-2.6 1.9 4.3 1.9-.8-1.9-4.2h3.8z`});
    const monitor=()=>[box('a-desk',9,5,94,52,4),h('path',{className:'a-bar',d:'M9.4 50h93.2v3.6a3.4 3.4 0 0 1-3.4 3.4H12.8a3.4 3.4 0 0 1-3.4-3.4z'}),box('a-ink2',49,52,3,3,.8),box('a-ink',54.5,52,3,3,.8),box('a-ink',60,52,3,3,.8),h('path',{className:'a-ink',d:'M50 57h12l1.5 6h-15z'}),box('a-ink',41,63,30,2,1)];
    const banner=y=>[box('a-pill',33,y,46,9,4.5),h('circle',{className:'a-dot',cx:38.5,cy:y+4.5,r:1.8}),box('a-text',42.5,y+3.55,23,1.9,.95),box('a-key',68,y+2,8,5,1.2)];
    const arts={
      // On: the page is read and filled directly; the tab icon turns into DSH's
      // badge and a small DSH pointer marks the spot. Off: your pointer does it.
      browserFirst:on=>drawing(box('a-win',8,7,96,56,5),h('path',{className:'a-bar',d:'M8 12a5 5 0 0 1 5-5h86a5 5 0 0 1 5 5v6H8z'}),h('path',{className:'a-sep',d:'M8 18h96'}),
        ...(on?[box('a-acc',12,9.2,6.6,6.6,1.8)]:[h('circle',{className:'a-ink2',cx:14,cy:12.5,r:1.4}),h('circle',{className:'a-ink2',cx:18.5,cy:12.5,r:1.4}),h('circle',{className:'a-ink2',cx:23,cy:12.5,r:1.4})]),box('a-win',29,10,52,5,2.5),
        box(on?'a-win a-edge':'a-win a-frame',18,25,52,10,3),box('a-ink2',22,29,22,2,1),box(on?'a-acc':'a-ink2',73,25,21,10,3),
        box('a-ink',18,41,64,2.6,1.3),box('a-ink',18,47,50,2.6,1.3),box('a-ink',18,53,38,2.6,1.3),box('a-frame',8,7,96,56,5),
        ...(on?[h('path',{className:'a-caret',d:'M46.5 27.5v5'}),dshArrow(83,29)]:[arrow(80,29)])),
      // On: the DSH browser window, its frame in DSH blue. Off: no window; the browser runs unseen.
      browserVisible:on=>drawing(...monitor(),...(on?[box('a-win',24,12,64,34,3),h('path',{className:'a-acc',d:'M24 15a3 3 0 0 1 3-3h58a3 3 0 0 1 3 3v3H24z'}),box('a-ink',29,23,36,2.4,1.2),box('a-ink',29,28,46,2.4,1.2),box('a-ink',29,33,28,2.4,1.2),box('a-frame',24,12,64,34,3)]
        :[box('a-ghost',24,12,64,34,3),h('path',{className:'a-eye',d:'M48 29c2.4-3.2 5-4.8 8-4.8s5.6 1.6 8 4.8c-2.4 3.2-5 4.8-8 4.8s-5.6-1.6-8-4.8zM49 35.5l14-13'})])),
      // The browser Browser Use runs, by name, in a window with DSH's tab badge.
      app:label=>drawing(box('a-win',8,7,96,56,5),h('path',{className:'a-bar',d:'M8 12a5 5 0 0 1 5-5h86a5 5 0 0 1 5 5v6H8z'}),h('path',{className:'a-sep',d:'M8 18h96'}),
        box('a-acc',12,9.2,6.6,6.6,1.8),box('a-win',22,10,40,5,2.5),box('a-frame',8,7,96,56,5),h('text',{className:'a-cap',x:56,y:45,textAnchor:'middle'},label)),
      // On: the DSH browser (its tab badge) keeps a signed-in account and its
      // cookies. Off: no one signed in.
      signIn:on=>drawing(box('a-win',8,7,96,56,5),h('path',{className:'a-bar',d:'M8 12a5 5 0 0 1 5-5h86a5 5 0 0 1 5 5v6H8z'}),h('path',{className:'a-sep',d:'M8 18h96'}),
        box('a-acc',12,9.2,6.6,6.6,1.8),h('circle',{className:on?'a-acc':'a-ghost',cx:95,cy:12.5,r:3.4}),box('a-ink',18,27,40,3,1.5),box('a-ink',18,34,30,3,1.5),box('a-ink',18,41,36,3,1.5),box('a-ink',18,48,24,3,1.5),
        h('circle',{className:on?'a-acc':'a-ghost',cx:80,cy:39,r:11}),...(on?[h('circle',{className:'a-win',cx:76,cy:35,r:1.6}),h('circle',{className:'a-win',cx:84,cy:37.5,r:1.4}),h('circle',{className:'a-win',cx:78.5,cy:44,r:1.7})]:[]),
        box('a-frame',8,7,96,56,5)),
      // Glowing screen edges and the status banner, at the top or the bottom.
      indicator:(on,bottom)=>drawing(...monitor(),box('a-win',22,15,48,27,2.5),h('path',{className:'a-bar',d:'M22 17.5a2.5 2.5 0 0 1 2.5-2.5h43a2.5 2.5 0 0 1 2.5 2.5v2.5H22z'}),box('a-ink',26,25,30,2.2,1.1),box('a-ink',26,30,22,2.2,1.1),box('a-frame',22,15,48,27,2.5),
        ...(on?[box('a-glow a-soft',12,8,88,46,2.5),box('a-glow',9.8,5.8,92.4,50.4,3.6),...banner(bottom?40:9.5)]:[])),
      // A soft spotlight and a DSH tag at the pointer.
      cursor:(on,id)=>drawing(h('defs',null,h('radialGradient',{id},h('stop',{offset:0,className:'a-spot0'}),h('stop',{offset:1,className:'a-spot1'}))),
        box('a-ink',14,13,42,3,1.5),box('a-ink',14,20,30,3,1.5),box('a-ink',14,27,36,3,1.5),box('a-ink',14,34,24,3,1.5),
        ...(on?[h('circle',{cx:50,cy:33,r:21,fill:`url(#${id})`})]:[]),arrow(48,25),...(on?[box('a-acc',60,44,26,11,5.5),h('text',{className:'a-tag',x:73,y:51.9,textAnchor:'middle'},'DSH')]:[])),
      // One square per tool: filled loads at startup, dashed loads on demand, faint is off.
      tools:(loaded,allowed)=>drawing(...toolGroups.flatMap(([,entries],row)=>entries.map(([name],col)=>box(loaded.has(name)?'a-acc':allowed.has(name)?'a-open':'a-ink',15.5+col*12,12.5+row*12,9,9,2.2)))),
      esc:()=>drawing(box('a-ink2',33,19,46,34,7),box('a-win',33,16,46,34,7),box('a-frame',33,16,46,34,7),h('text',{className:'a-cap',x:56,y:37.2,textAnchor:'middle'},'Esc'))
    };
    function Card({scope,t,savePatch,as='li',idPrefix='wincu',view}) {
      if(view==='summary')return h('span',{'data-wincu-summary':true},t('pluginDescription'),' ',h('span',{style:{color:'var(--dsw-alias-label-link,#71a7ff)'}},t('openSettings')));
      return h(SettingsGate,{scope,t,savePatch,as,idPrefix});
    }
    function SettingsGate(props){
      const state=React.useSyncExternalStore(fn=>props.scope.subscribe(fn),()=>props.scope.getSnapshot());
      if((state.status!==undefined&&state.status!=='ready')||!state.value)return h(props.as,{'data-wincu-unavailable':true},h('p',{role:'status'},props.t(state.status==='loading'?'loadingSettings':'notLoaded')),h('button',{type:'button',onClick:()=>window.location.reload()},props.t('reloadSettings')));
      return h(SettingsCard,props);
    }
    function SettingsCard({scope,t,savePatch,as='li',idPrefix='wincu'}) {
      const state = React.useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot());
      const available=state.status===undefined?state.value!==undefined:state.status==='ready';
      const writable=available&&state.writable;
      const saved = {...defaults,...state.value};
      if(!state.value?.toolPreset||saved.toolPreset==='auto')saved.toolPreset=saved.enabledTools.length===allToolNames.length?'full':'custom';
      const [draft,setDraft] = React.useState(saved), [dirty,setDirty] = React.useState(false);
      const [saving,setSaving] = React.useState(false), [message,setMessage] = React.useState(''),[tone,setTone]=React.useState('');
      const [recording,setRecording] = React.useState(false), [recordMessage,setRecordMessage] = React.useState('');
      const [noteView,setNoteView] = React.useState(null), [noteSaving,setNoteSaving] = React.useState(false);
      const savedKey = JSON.stringify(Object.fromEntries(Object.keys(defaults).map(key=>[key,saved[key]])));
      React.useEffect(()=>{if(!dirty)setDraft(saved);},[savedKey,dirty]);
      const change = (field,value) => {const next={...draft,[field]:value};setDraft(next);setDirty(Object.keys(defaults).some(key=>!equal(next[key],saved[key])));setMessage('');};
      const selectTools=(names,enabled)=>{const selected=new Set(draft.enabledTools);for(const name of names)enabled?selected.add(name):selected.delete(name);change('enabledTools',allToolNames.filter(name=>selected.has(name)));};
      React.useEffect(()=>{
        if(!recording)return;
        if(!writable||saving){setRecording(false);return;}
        const cancel=()=>{setRecording(false);setRecordMessage('recordCancelled');};
        const keydown=event=>{
          if(event.isComposing)return;
          event.preventDefault();event.stopImmediatePropagation();
          if(event.key==='Escape'||event.code==='Escape'){cancel();return;}
          if(event.repeat||['Control','Alt','Shift','Meta','OS'].includes(event.key))return;
          const shortcut=shortcutFromEvent(event);
          if(!shortcut){setRecordMessage('unsupportedKey');return;}
          change('stopShortcut',shortcut);setRecordMessage('');setRecording(false);
        };
        const timer=setTimeout(()=>{setRecording(false);setRecordMessage('recordTimedOut');},15000);
        window.addEventListener('keydown',keydown,true);window.addEventListener('blur',cancel);
        return ()=>{clearTimeout(timer);window.removeEventListener('keydown',keydown,true);window.removeEventListener('blur',cancel);};
      },[recording,writable,saving,savedKey]);
      const run = async (patch,success) => {
        setSaving(true);setMessage('');
        try {await savePatch(patch);setMessage(t(success));setTone('success');return true;}
        catch(error){setMessage(t('failed')+': '+String(error.message||error));setTone('error');return false;}
        finally{setSaving(false);}
      };
      const save = async () => {
        if(!draft.indicatorText.trim()||draft.indicatorText.length>120||/[\r\n\x00-\x1f]/.test(draft.indicatorText)||!Number.isInteger(draft.indicatorIdleMs)||draft.indicatorIdleMs<200||draft.indicatorIdleMs>3000){setMessage(t('invalid'));setTone('error');return;}
        const patch=Object.fromEntries(Object.keys(defaults).filter(key=>!equal(draft[key],saved[key])).map(key=>[key,draft[key]]));
        if(await run(patch,'saved'))setDirty(false);
      };
      // The support note is a display choice. Save it at once, outside the draft,
      // so it never saves or discards other pending changes.
      React.useEffect(()=>setNoteView(null),[saved.communityNote]);
      const noteCompact=(noteView??saved.communityNote)==='link';
      const toggleNote = async () => {
        const next=noteCompact?'full':'link';
        setNoteView(next);setNoteSaving(true);
        try {await savePatch({communityNote:next});}
        catch(error){setNoteView(null);setMessage(t('failed')+': '+String(error.message||error));setTone('error');}
        finally{setNoteSaving(false);}
      };
      const disabled = saving||!writable||recording,indicatorDisabled=disabled||!draft.indicatorEnabled;
      const activeTools=draft.toolPreset==='lazy'?['tools']:draft.toolPreset==='full'?allToolNames:draft.toolPreset==='lite'?liteToolNames:draft.enabledTools;
      const customDisabled=disabled||draft.toolPreset!=='custom';
      const radio=(field,value,label)=>h('label',{key:value},h('input',{type:'radio',name:idPrefix+'-'+field,id:idPrefix+'-'+field+'-'+value,value,checked:draft[field]===value,disabled:indicatorDisabled,onChange:()=>change(field,value)}),label);
      const button=(label,props)=>h('button',{type:'button',...props},t(label));
      const linkIcon=kind=>kind==='github'?h('svg',{viewBox:'0 0 16 16','aria-hidden':true,focusable:false},h('path',{fill:'currentColor',stroke:'none',d:'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z'})):h('svg',{viewBox:'0 0 24 24','aria-hidden':true,focusable:false},h('path',{d:kind==='star'?'m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.6l6.3-.9L12 3Z':kind==='issue'?'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z':'M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5'}));
      const communityLink=(href,label,kind,title)=>h('a',{href,target:'_blank',rel:'noopener noreferrer',title:t(title),'aria-label':t(title)},linkIcon(kind),h('span',null,t(label)),linkIcon('external'));
      const info=key=>h(Info,{id:idPrefix+'-tip-'+key,label:t('moreInfo'),text:t(key)});
      const head=(id,title,hint,...end)=>h('div',{className:'wcu-section-head'},h('h3',{id},t(title)),hint&&info(hint),end.length>0&&h('div',{className:'wcu-end'},...end));
      // A setting reads as a picture of its effect, then its name and control,
      // two to a row, so no switch sits far from its name.
      const item=(art,...main)=>h('div',{className:'wcu-item'},art,h('div',{className:'wcu-item-main'},...main));
      // The hint icon stays on the line of the title's last word (or last two
      // Chinese characters), so a narrow column never leaves it alone on a line.
      const title=(text,hint,props)=>{const cut=/[\u2e80-\u9fff\uff00-\uffef]$/.test(text)?text.length-2:text.lastIndexOf(' ')+1;return h(props?.htmlFor?'label':'span',{className:'wcu-item-title',...props},text.slice(0,cut),h('span',{className:'wcu-nowrap'},text.slice(cut),hint&&info(hint)));};
      const picture=art=>h('div',{className:'wcu-art','aria-hidden':true},art);
      const toggle=(field,label)=>h('input',{id:idPrefix+'-'+field,type:'checkbox',role:'switch','aria-label':t(label),checked:draft[field],disabled,onChange:e=>change(field,e.target.checked)});
      const switchItem=(field,label,hint,art)=>item(h('label',{className:'wcu-art',htmlFor:idPrefix+'-'+field,'aria-hidden':true},art),title(t(label),hint,{htmlFor:idPrefix+'-'+field}),toggle(field,label));
      const field=(label,control)=>h('div',{className:'wcu-field'},label,control);
      const allowedTools=['full','lazy'].includes(draft.toolPreset)?allToolNames:activeTools;
      const keycap=(key,label)=>h('kbd',{className:'wcu-key',key},label);
      const shortcutKeys=recording?[h('span',{key:'listen'},t('listening')),h('small',{key:'cancel'},t('listeningCancel'))]
        :draft.stopShortcut?draft.stopShortcut.split('+').flatMap((key,i)=>i?[h('span',{className:'wcu-plus',key:'+'+i},' + '),keycap(i,key)]:[keycap(i,key)])
        :[keycap('esc','Esc'),h('small',{key:'default'},t('noShortcut').slice(3))];
      return h(as,{'data-wincu-settings':'true'},h('style',null,css),
        h('header',{className:'wcu-header'},
          h('aside',{className:'wcu-community','data-wincu-community':'true','data-compact':noteCompact||undefined},noteCompact?h('p',null,communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win','projectLink','github','projectTitle')):h('p',null,t('starPrefix'),
            communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win','starLink','star','starTitle'),t('starAfter'),t('issueBefore'),
            communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new','issueLink','issue','issueTitle'),t('issueAfter')),
            h('button',{type:'button',className:'wcu-fold','data-wincu-note-toggle':true,'aria-expanded':!noteCompact,title:t(noteCompact?'fullNoteTitle':'compactNoteTitle'),disabled:noteSaving||saving||!writable,onClick:toggleNote},h('svg',{viewBox:'0 0 16 16','aria-hidden':true,focusable:false},h('path',{d:'M4 6h8l-4 5z'})),h('span',null,t(noteCompact?'fullNote':'compactNote')))),
          h('h2',null,t('title')),h('p',null,t('intro'))),
        h('section',{className:'wcu-section','data-wincu-browser-policy':true,'aria-labelledby':idPrefix+'-browser-title'},
          head(idPrefix+'-browser-title','browserTitle','browserInfo'),
          h('div',{className:'wcu-grid'},
            switchItem('browserFirst','browserFirst','browserFirstHint',arts.browserFirst(draft.browserFirst)),
            switchItem('browserVisible','browserVisible','browserVisibleHint',arts.browserVisible(draft.browserVisible)),
            item(h('label',{className:'wcu-art',htmlFor:idPrefix+'-browserApp','aria-hidden':true},arts.app(draft.browserApp==='default'?t('browserAppShort'):t('browserApp_'+draft.browserApp))),
              title(t('browserApp'),'browserAppHint',{htmlFor:idPrefix+'-browserApp'}),
              h('select',{className:'wcu-control',id:idPrefix+'-browserApp',value:draft.browserApp,disabled,onChange:e=>change('browserApp',e.target.value)},
                ...['default','edge','chrome'].map(app=>h('option',{key:app,value:app},t('browserApp_'+app))))),
            switchItem('browserSignIn','browserSignIn','browserSignInHint',arts.signIn(draft.browserSignIn))),
          // Kept sign-ins need nothing set up, but how to sign in, where the
          // sign-ins stay and the risks remain in view while the switch is on.
          draft.browserSignIn&&h('div',{className:'wcu-notice','data-wincu-signin-notice':true},
            h('strong',null,t('signInSetup')),
            h('ol',null,h('li',null,t('signInStep1')),h('li',null,t('signInStep2')),
              !draft.browserVisible&&h('li',{'data-wincu-signin-hidden':true},t('signInStepHidden')),
              draft.browserApp!=='chrome'&&h('li',{'data-wincu-signin-edge':true},t('signInStepEdge')),
              h('li',null,t('signInStep3'),h('span',{className:'wcu-address'},h('code',null,KEPT_FOLDER),h(CopyButton,{text:KEPT_FOLDER,t})))),
            h('strong',null,t('signInRisks')),
            h('ul',null,...[1,2,3].map(n=>h('li',{key:n},t('signInRisk'+n)))))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-tools-title'},
          head(idPrefix+'-tools-title','toolsTitle','toolsInfo',h('span',{className:'wcu-tool-count','data-wincu-tool-count':true},draft.toolPreset==='lazy'?t('lazyCount'):t('toolsSelected')+' '+activeTools.length+' / '+allToolNames.length)),
          item(picture(arts.tools(new Set(activeTools),new Set(allowedTools))),
            h('div',{className:'wcu-segment wcu-presets',role:'radiogroup','aria-label':t('toolsTitle')},...['full','lite','lazy','custom'].map(preset=>h('label',{key:preset},h('input',{type:'radio',name:idPrefix+'-toolPreset',id:idPrefix+'-toolPreset-'+preset,value:preset,checked:draft.toolPreset===preset,disabled,onChange:()=>change('toolPreset',preset)}),t(preset)))),
            h('p',{className:'wcu-hint','data-wincu-preset-hint':true},t(draft.toolPreset+'Summary'))),
          h('details',{className:'wcu-tool-detail','data-wincu-tools':true,hidden:draft.toolPreset!=='custom',open:draft.toolPreset==='custom'},h('summary',null,t('customTools')),
            h('div',{className:'wcu-tool-body'},h('div',{className:'wcu-tool-toolbar'},button('allTools',{className:'wcu-small',disabled:customDisabled||draft.enabledTools.length===allToolNames.length,onClick:()=>change('enabledTools',[...allToolNames])}),button('noTools',{className:'wcu-small',disabled:customDisabled||!draft.enabledTools.length,onClick:()=>change('enabledTools',[])})),
              ...toolGroups.map(([group,entries])=>{const names=entries.map(entry=>entry[0]),count=names.filter(name=>draft.enabledTools.includes(name)).length;return h('fieldset',{className:'wcu-tool-group',disabled:customDisabled,key:group},
                h('legend',null,h('label',{className:'wcu-tool-group-label'},h('input',{type:'checkbox',id:idPrefix+'-tool-group-'+group,checked:count===names.length,'aria-checked':count&&count<names.length?'mixed':count===names.length,ref:input=>{if(input)input.indeterminate=count>0&&count<names.length;},onChange:e=>selectTools(names,e.target.checked)}),t('toolGroup_'+group),h('span',{className:'wcu-tool-count'},count+' / '+names.length))),
                h('div',{className:'wcu-tool-grid'},...entries.map(([name])=>h('label',{className:'wcu-tool-item',key:name,title:'windows_computer_use_'+name},h('input',{type:'checkbox',id:idPrefix+'-tool-'+name,'data-wincu-tool':name,checked:draft.enabledTools.includes(name),disabled:customDisabled,onChange:e=>selectTools([name],e.target.checked)}),h('span',null,h('strong',null,t('tool_'+name)),h('small',null,t('toolHint_'+name)))))));})))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-indicator-title'},
          head(idPrefix+'-indicator-title','indicatorTitle','indicatorInfo',button('preview',{className:'wcu-small',disabled:disabled||dirty||(!draft.indicatorEnabled&&!draft.cursorIndicatorEnabled),onClick:()=>run({previewToken:Date.now()},'previewed'),title:dirty?t('previewHint'):undefined})),
          h('div',{className:'wcu-grid'},
            switchItem('indicatorEnabled','indicator','indicatorHint',arts.indicator(draft.indicatorEnabled,draft.indicatorPosition==='bottom')),
            switchItem('cursorIndicatorEnabled','cursorIndicator','cursorIndicatorHint',arts.cursor(draft.cursorIndicatorEnabled,idPrefix+'-spot'))),
          h('details',{className:'wcu-detail'},h('summary',null,t('appearance')),
            h('div',{className:'wcu-fields'},
              field(title(t('position'),null,{id:idPrefix+'-position-label'}),h('div',{className:'wcu-segment',role:'radiogroup','aria-labelledby':idPrefix+'-position-label'},radio('indicatorPosition','top',t('top')),radio('indicatorPosition','bottom',t('bottom')))),
              field(title(t('delay'),'delayHint',{htmlFor:idPrefix+'-delay'}),h('div',{className:'wcu-number'},h('input',{className:'wcu-control',id:idPrefix+'-delay',type:'number',min:200,max:3000,step:100,value:draft.indicatorIdleMs,disabled:indicatorDisabled,onChange:e=>change('indicatorIdleMs',Number(e.target.value))}),h('span',null,t('ms')))),
              field(title(t('text'),null,{htmlFor:idPrefix+'-text'}),h('input',{className:'wcu-control wcu-text',id:idPrefix+'-text',type:'text',maxLength:120,value:draft.indicatorText,disabled:indicatorDisabled,onChange:e=>change('indicatorText',e.target.value)})),
              field(title(t('remoteVisible'),'remoteVisibleHint',{htmlFor:idPrefix+'-remoteIndicatorVisible'}),toggle('remoteIndicatorVisible','remoteVisible'))))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-stop-title'},
          head(idPrefix+'-stop-title','stop',null,button('clearShortcut',{className:'wcu-small',disabled:disabled||!draft.stopShortcut,onClick:()=>{change('stopShortcut','');setRecordMessage('');}})),
          h('div',{className:'wcu-grid'},
            item(picture(arts.esc()),title(t('escTitle'),'stopHint'),h('span',{className:'wcu-caption'},t('escAlways'))),
            h('div',{className:'wcu-item','data-wincu-shortcut':'true'},
              h('output',{className:'wcu-art wcu-shortcut-value','data-recording':recording,'data-keys':draft.stopShortcut.split('+').length,'aria-live':'polite','aria-label':t('extraStop')},...shortcutKeys),
              h('div',{className:'wcu-item-main'},title(t('extraStop'),'shortcutHint'),
                button(recording?'cancelRecord':draft.stopShortcut?'rerecord':'record',{className:'wcu-small',disabled:saving||!writable,onClick:()=>{setRecordMessage('');setRecording(!recording);}})))),
          recordMessage&&h('p',{role:'status',className:'wcu-hint'},t(recordMessage))),
        !writable&&h('p',{role:'status','data-tone':'error'},t(available?'unavailable':'notLoaded')),
        h('footer',{className:'wcu-footer'},h('span',{className:'wcu-status',role:'status','aria-live':'polite','data-tone':message?tone:undefined},message||t(dirty?'dirty':'clean')),
          h('div',{className:'wcu-actions'},button('discard',{disabled:!dirty||saving||recording,onClick:()=>{setDraft(saved);setDirty(false);setMessage('');setRecordMessage('');}}),button('save',{className:'wcu-primary',disabled:!dirty||disabled,onClick:save}))));
    }
    const actionKeys={snapshot:'see',screenshot:'see',accessibility_tree:'read',list_windows:'windows',find:'findControl',element_info:'read',click:'clickAction',double_click:'doubleClick',move:'movePointer',drag:'dragAction',scroll:'scrollAction',type_text:'typeAction',keypress:'keyAction',focus:'focusAction',invoke:'invokeAction',set_value:'valueAction',activate_window:'windowAction',wait:'waitAction',ocr:'ocrAction',wait_for:'verifyAction',close_window:'closeAction',move_window:'moveWindowAction',health:'healthAction',tools:'toolsAction'};
    Object.assign(dictionaries.zh,{see:'查看了屏幕',read:'读取了界面控件',windows:'查看了打开的窗口',findControl:'查找了界面控件',clickAction:'点击了目标位置',doubleClick:'双击了目标位置',movePointer:'移动了鼠标',dragAction:'拖动了目标',scrollAction:'滚动了页面',typeAction:'输入了文本',keyAction:'发送了按键',focusAction:'聚焦了目标控件',invokeAction:'操作了目标控件',valueAction:'填写了控件内容',windowAction:'切换了目标窗口',waitAction:'等待了界面响应',ocrAction:'识别了屏幕文字',verifyAction:'检查了操作结果',closeAction:'请求关闭窗口',moveWindowAction:'移动了窗口',healthAction:'检查了桌面服务',toolsAction:'查看了工具配置',working:'正在操作…',completed:'已完成',failedAction:'未完成',stoppedAction:'已停止',seriesTitle:'本轮桌面操作',sentOnly:'操作已发送，效果待确认',showDetails:'查看步骤和截图',searchSubmitted:'在浏览器中提交了搜索',searchObserved:'在浏览器中搜索了',seriesCount:'步操作',stepError:'操作失败',and:'，并'});
    Object.assign(dictionaries.en,{see:'Viewed the screen',read:'Read interface controls',windows:'Listed open windows',findControl:'Looked for controls',clickAction:'Clicked the target',doubleClick:'Double-clicked the target',movePointer:'Moved the pointer',dragAction:'Dragged the target',scrollAction:'Scrolled the page',typeAction:'Entered text',keyAction:'Sent a key press',focusAction:'Focused a control',invokeAction:'Operated a control',valueAction:'Filled in a control',windowAction:'Switched windows',waitAction:'Waited for the interface',ocrAction:'Read screen text',verifyAction:'Checked the result',closeAction:'Requested window close',moveWindowAction:'Moved a window',healthAction:'Checked desktop service',toolsAction:'Viewed tool settings',working:'Working…',completed:'Completed',failedAction:'Incomplete',stoppedAction:'Stopped',seriesTitle:'Desktop activity',sentOnly:'Input sent; effect unconfirmed',showDetails:'Steps and screenshots',searchSubmitted:'Submitted a browser search for',searchObserved:'Searched the browser for',seriesCount:'steps',stepError:'Action failed',and:', then '});
    const shortTool=name=>String(name||'').replace(/^(?:mcp__wincu__)?windows_computer_use_/,'');
    const desktopTool=name=>/^(?:mcp__wincu__)?windows_computer_use_(?!health$|tools$)[a-z_]+$/.test(name||'');
    const objectArgs=value=>{if(typeof value==='string')try{return JSON.parse(value);}catch{return {};}return value&&typeof value==='object'?value:{};};
    function receipt(message){
      for(const part of message?.content||[])if(part.type==='text'&&typeof part.text==='string')try{return JSON.parse(part.text);}catch{}
      return {};
    }
    const resultStatus=message=>message?.isError?((message.content||[]).some(part=>part.type==='text'&&/COMPUTER_USE_STOPPED_BY_USER/.test(part.text))?'stopped':'failed'):'completed';
    const mouseIcon=()=>h('svg',{viewBox:'0 0 24 24',width:17,height:17,fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true,style:{verticalAlign:'middle',flexShrink:0}},h('rect',{x:6,y:2,width:12,height:20,rx:6}),h('path',{d:'M12 2v7M6 10h12'}));
    const activityCss=`.wcu-activity{color:var(--dsw-alias-label-secondary,inherit);font-size:13px;line-height:1.6;margin:7px 0}.wcu-activity>summary{cursor:pointer;display:flex;align-items:center;gap:8px;list-style:none}.wcu-activity>summary::-webkit-details-marker{display:none}.wcu-activity .wcu-activity-label{color:var(--dsw-alias-label-primary,inherit)}.wcu-activity .wcu-activity-state{font-size:12px;opacity:.72;margin-left:4px}.wcu-activity[open]{padding-bottom:8px}.wcu-activity ol{margin:10px 0 4px 22px;padding-left:16px}.wcu-activity li{padding:3px 0}.wcu-activity pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:240px;overflow:auto}.wcu-activity .wcu-activity-note{font-size:12px;opacity:.75}.wcu-activity button{color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:6px;padding:3px 8px;cursor:pointer}`;
    function actionText(call,t){
      const args=objectArgs(call.args),action=shortTool(call.name);
      let label=t(actionKeys[action]||'seriesTitle');
      if(['activate_window','close_window','move_window'].includes(action)&&args.windowTitle)label+='「'+String(args.windowTitle).slice(0,90)+'」';
      if(action==='find'&&args.query)label+='「'+String(args.query).slice(0,60)+'」';
      return label;
    }
    function seriesText(calls,t){
      const textCall=calls.find(c=>c.status==='completed'&&shortTool(c.name)==='type_text'&&typeof objectArgs(c.args).text==='string');
      const query=textCall?objectArgs(textCall.args).text.trim():'';
      const searchWindow=calls.find(c=>c.status==='completed'&&/搜索|search|bing|google|百度/i.test(String(objectArgs(c.args).windowTitle||receipt(c.message).window?.title||'')));
      const submitted=textCall&&calls.find(c=>c.seq>textCall.seq&&shortTool(c.name)==='keypress'&&(objectArgs(c.args).keys||[]).some(key=>/^enter$/i.test(key))&&c.status==='completed');
      if(searchWindow&&submitted&&query&&query.length<=100&&!/[\r\n]/.test(query)){
        const observed=calls.some(c=>c.seq>submitted.seq&&['screenshot','snapshot','ocr','wait_for'].includes(shortTool(c.name))&&c.status==='completed'&&(String(receipt(c.message).window?.title||'').includes(query)||(shortTool(c.name)==='wait_for'&&receipt(c.message).verification==='observed'&&objectArgs(c.args).query===query)));
        return t(observed?'searchObserved':'searchSubmitted')+'「'+query+'」';
      }
      const actions=[...new Set(calls.filter(c=>c.status==='completed').map(c=>actionText(c,t)))];
      return actions.slice(-3).join(t('and'))||t('seriesTitle');
    }
    function activityBody(call,renderFactorySlot,loadImage,t){
      const data=receipt(call.message),images=(call.message?.content||[]).filter(x=>x.type==='image'&&x.attachment);
      return h(React.Fragment,null,
        data.verification==='sent'&&h('div',{className:'wcu-activity-note'},t('sentOnly')),
        ['failed','stopped'].includes(call.status)&&h('div',{role:'status'},t(call.status==='stopped'?'stoppedAction':'stepError')),
        images.length>0&&renderFactorySlot&&loadImage&&renderFactorySlot('conversation.images.content',{images,loadImage,align:'start'}));
    }
    function MouseToolRow({toolName,phase,block,renderFactorySlot,loadImage,inspect,t}){
      const message=phase==='result'?block.message:undefined;
      const status=phase==='result'?resultStatus(message):'working';
      const call={name:toolName,args:block.call?.arguments??block.arguments,message,status};
      return h('details',{className:'wcu-activity','data-wincu-action':true},h('style',null,activityCss),h('summary',null,mouseIcon(),h('span',{className:'wcu-activity-label'},status==='working'?t('working'):actionText(call,t)),h('span',{className:'wcu-activity-state'},t(status==='failed'?'failedAction':status==='stopped'?'stoppedAction':status))),activityBody(call,renderFactorySlot,loadImage,t),inspect&&h('button',{type:'button',onClick:inspect},t('showDetails')));
    }
    function reduceSeries(state,event){
      const data=event.data||{};
      if(event.type==='tool/call'&&desktopTool(data.name))return {...state,calls:[...state.calls,{id:data.callId,name:data.name,args:data.arguments,seq:event.seq,status:'working'}]};
      if(event.type==='tool/result')return {...state,calls:state.calls.map(call=>call.id===data.message?.callId?{...call,message:data.message,status:resultStatus(data.message)}:call)};
      if(event.type==='turn/end')return {...state,ended:true,reason:data.reason?.kind||'completed'};
      return state;
    }
    const seriesDefinition={
      kind:'wincu-series',target:'chat',
      match:event=>['turn/start','turn/end','tool/call','tool/result'].includes(event.type)&&Number.isInteger(event.data?.turn)?{id:String(event.data.turn),role:'start'}:null,
      start:(_context,match)=>reduceSeries({calls:[],seq:match.event.seq,ended:false},match.event),
      update:(context,match)=>reduceSeries(context.state,match.event),
      buildViewNode:context=>!context.state?.ended||!context.state.calls.length?null:{key:context.key,kind:'wincu-series',id:context.id,target:'chat',anchorSeq:context.state.calls[0].seq,location:context.start?.location??{kind:'unresolved'},visibility:'visible',data:context.state}
    };
    function SeriesRow({node,t,renderFactorySlot,loadImage}){
      const state=node.data,status=state.reason==='aborted'||state.calls.some(c=>c.status==='stopped')?'stoppedAction':state.reason==='error'||state.calls.some(c=>c.status!=='completed')?'failedAction':'completed';
      return h('details',{className:'wcu-activity','data-wincu-series':true},h('style',null,activityCss),h('summary',null,mouseIcon(),h('span',{className:'wcu-activity-label'},seriesText(state.calls,t)),h('span',{className:'wcu-activity-state'},t(status)+' · '+state.calls.length+' '+t('seriesCount'))),h('ol',null,...state.calls.map(call=>h('li',{key:call.id},actionText(call,t),activityBody(call,renderFactorySlot,loadImage,t)))));
    }
    function registerActivity(ctx){
      ctx.slots.inject('tool.call.toolview',function*(){for(const name of allToolNames)for(const prefix of ['mcp__wincu__windows_computer_use_','windows_computer_use_'])yield ctx.slots.register({name:'tool.call.toolview',key:prefix+name,locale:NS},MouseToolRow);});
      ctx.inject(['uiConversation'],owner=>{
        owner.uiConversation.events.register(seriesDefinition);
        ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key:'wincu-series',locale:NS},SeriesRow));
      });
    }
    // DSH 2.0 picks settings-nav icons by built-in section id and gives plugin sections a gear.
    // Mark this section's nav button so a stylesheet can draw a mouse instead; nothing React
    // renders is replaced. The settings panel is portaled into <body>, so only new top-level
    // layers are watched. A nav without this markup simply keeps the host's gear.
    const navMouse=`url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="1.5" width="8" height="13" rx="4"/><path d="M8 1.5V6M4 6.75h8"/></svg>')}")`;
    function watchNavIcon(names){
      if(typeof document==='undefined'||typeof MutationObserver!=='function')return ()=>{};
      const style=document.createElement('style');
      style.textContent=`[data-wincu-nav]>svg:first-child{display:none}[data-wincu-nav]::before{content:'';flex:none;width:16px;height:16px;background:currentColor;-webkit-mask:${navMouse} center/16px no-repeat;mask:${navMouse} center/16px no-repeat}`;
      document.head.append(style);
      const mark=root=>{for(const button of root.querySelectorAll('button[class*="navCell"]')){const mine=button.firstElementChild?.localName==='svg'&&names.includes(button.lastElementChild?.textContent);if(mine!==button.hasAttribute('data-wincu-nav'))button.toggleAttribute('data-wincu-nav',mine);}};
      const layers=new Map();
      // Only layers that arrive with a settings nav are observed, so chat updates cost nothing.
      const watch=node=>{if(node.nodeType!==1||layers.has(node)||!node.querySelector('button[class*="navCell"]'))return;const observer=new MutationObserver(()=>mark(node));observer.observe(node,{childList:true,subtree:true,characterData:true});layers.set(node,observer);mark(node);};
      const top=new MutationObserver(records=>{for(const record of records){record.addedNodes.forEach(watch);record.removedNodes.forEach(node=>{layers.get(node)?.disconnect();layers.delete(node);});}});
      top.observe(document.body,{childList:true});
      for(const node of document.body.children)watch(node);
      return ()=>{top.disconnect();for(const observer of layers.values())observer.disconnect();layers.clear();style.remove();for(const button of document.querySelectorAll('[data-wincu-nav]'))button.removeAttribute('data-wincu-nav');};
    }
    function apply(ctx) {
      ctx.effect(()=>ctx.locale.register(NS,dictionaries));
      ctx.effect(()=>watchNavIcon([dictionaries.zh.nav,dictionaries.en.nav]));
      registerActivity(ctx);
      const t=ctx.locale.bind?ctx.locale.bind(NS):key=>key;
      let mounted=false;
      let modernRemote;
      ctx.inject(['remote','remote.settings'],owner=>{modernRemote=owner.remote.settings;return ()=>{modernRemote=undefined;};});
      const mount=(scope,owner,namespace)=>{
      if(mounted)return;mounted=true;
      const connection=typeof scope.mutate==='function'?undefined:owner.connection;
      const savePatch=async patch=>{
        const current=scope.getSnapshot();
        if(current.status!==undefined&&current.status!=='ready')throw Error(t('notLoaded'));
        if(modernRemote&&owner.configForms){
          const response=await modernRemote.mutate(namespace,Object.entries(patch).map(([field,value])=>({op:'set',path:[field],value})),current.revision);
          if(response.ok)owner.configForms.describe().acceptView(response.value);
          else await owner.configForms.describe().load();
          if(!response.ok)throw Error(response.error?.message||response.error?.code||t('persistFailed'));
        }else if(typeof scope.mutate==='function'){
          const accepted=await scope.mutate(Object.entries(patch).map(([field,value])=>({op:'set',path:[field],value})),scope.getSnapshot().revision);
          if(!accepted)throw Error(t('persistFailed'));
        }else if(connection?.api?.settings?.mutate){
          const snapshot=scope.getSnapshot();
          const response=await connection.api.settings.mutate({ns:namespace,ops:Object.entries(patch).map(([field,value])=>({op:'set',path:[field],value})),...(snapshot.revision===undefined?{}:{expectedRevision:snapshot.revision})});
          if(!response.result?.ok)throw Error(response.result?.message||response.result?.error||t('persistFailed'));
          await scope.load();
        }else{
          for(const [field,value]of Object.entries(patch))await scope.set(field,value);
        }
        const value=scope.getSnapshot().value??{};
        if(Object.entries(patch).some(([key,next])=>!equal(value[key],next)))throw Error(t('persistFailed'));
      };
      ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'computer-use',order:16,label:()=>t('nav'),locale:NS,inject:()=>({scope,savePatch,as:'section',idPrefix:'wincu-page'})},Card));
      ctx.slots.inject('plugins.item',()=>ctx.slots.register({name:'plugins.item',id:'windows-computer-use',order:30,label:()=>t('nav'),locale:NS,inject:()=>({scope,savePatch,as:'section',idPrefix:'wincu-plugin'})},Card));
      ctx.slots.inject('settings.plugin.item',()=>ctx.slots.register({name:'settings.plugin.item',id:'windows-computer-use',order:30,locale:NS,inject:()=>({scope,savePatch})},Card));
      };
      ctx.inject(['configForms'],owner=>mount(owner.configForms.get('mcp-dsh-computer-use-win'),owner,'mcp-dsh-computer-use-win'));
      ctx.inject(['settingsScope','connection','remote'],owner=>mount(owner.settingsScope.bind({namespace:'windows-computer-use'}),owner,'windows-computer-use'));
    }
    return {apply,inject:['slots','locale']};
  }
});

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
    const defaults = {toolPreset:'full',enabledTools:allToolNames,indicatorEnabled:true,cursorIndicatorEnabled:true,remoteIndicatorVisible:true,indicatorText:'DSH 正在控制电脑',indicatorPosition:'top',indicatorIdleMs:800,stopShortcut:''};
    const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
    const dictionaries = {
      zh: {nav:'Computer Use',title:'Windows 桌面操作',intro:'查看接管提示，使用 Esc 停止桌面操作。',mode:'工具模式',lite:'精简模式',full:'全能模式',modeHint:'精简模式保留常用工具，其余按需加载。切换模式会在当前动作结束后重载工具。',indicator:'显示接管提示',indicatorHint:'显示屏幕边缘光晕和提示条；关闭后仍可按 Esc 停止。',text:'提示文字',position:'提示位置',top:'屏幕顶部',bottom:'屏幕底部',delay:'操作结束后隐藏延时（毫秒）',delayHint:'连续动作共用提示，避免每次点击都闪烁。范围 200–3000 毫秒。',corner:'用鼠标停止操作',cornerHint:'鼠标停在屏幕左上角约 500 毫秒可拒绝后续输入；普通鼠标移动不会停止。',stop:'停止与恢复',stopHint:'用户按 Esc 后保持暂停。普通鼠标和其他按键不触发停止，程序发送的 Esc 也不触发停止。恢复前请确认 agent 的任务仍符合你的意图。',resume:'恢复桌面控制',resumed:'已请求恢复桌面控制',preview:'预览接管提示',previewed:'已请求预览；如果之前按 Esc 暂停，请先恢复控制。',save:'保存',discard:'取消修改',saved:'已保存',failed:'保存失败',unavailable:'当前宿主未提供可写设置，请在本机 DSH 中打开此页面。',invalid:'请填写 1–120 字的单行提示文字，并将隐藏延时设为 200–3000 的整数。',persistFailed:'宿主未确认设置已保存，请刷新后重试。'},
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
    Object.assign(dictionaries.zh,{compactNote:'精简显示',fullNote:'完整显示',compactNoteTitle:'只保留 dsh-computer-use-win 链接，可随时恢复',fullNoteTitle:'恢复完整的 Star 与 Issue 说明',projectLink:'dsh-computer-use-win',projectTitle:'在 GitHub 上打开 dsh-computer-use-win（在新窗口打开）'});
    Object.assign(dictionaries.en,{compactNote:'Compact',fullNote:'Show full note',compactNoteTitle:'Keep only the dsh-computer-use-win link; switch back anytime',fullNoteTitle:'Show the full Star and Issue note again',projectLink:'dsh-computer-use-win',projectTitle:'Open dsh-computer-use-win on GitHub (opens in a new window)'});
    Object.assign(dictionaries.zh,{cursorIndicator:'突出显示鼠标',cursorIndicatorHint:'接管时在鼠标旁显示蓝色光环和 DSH 标识，便于看清操作位置。停止或接管结束后自动消失。'});
    Object.assign(dictionaries.en,{cursorIndicator:'Highlight the pointer',cursorIndicatorHint:'Show a blue halo and DSH badge beside the pointer during control. They disappear when control stops or ends.'});
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
      [data-wincu-settings]{--wcu-bg:var(--dsw-alias-bg-layer-2,Canvas);--wcu-control:var(--dsw-alias-bg-layer-1,Canvas);--wcu-raised:var(--dsw-alias-bg-layer-3,Canvas);--wcu-fg:var(--dsw-alias-label-primary,CanvasText);--wcu-muted:var(--dsw-alias-label-secondary,#7b8088);--wcu-border:var(--dsw-alias-border-l2,rgba(128,128,128,.3));--wcu-accent:#2674ce;color:var(--wcu-fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;max-width:760px;list-style:none;box-sizing:border-box;margin:0;padding:0 0 8px}
      [data-wincu-settings] *{box-sizing:border-box}
      [data-wincu-settings] h2{font-size:22px;line-height:1.4;font-weight:600;margin:0 0 6px}
      [data-wincu-settings] h3{font-size:15px;line-height:1.5;font-weight:600;margin:0}
      [data-wincu-settings] p{margin:5px 0 0;color:var(--wcu-muted);font-size:13px;line-height:1.55}
      [data-wincu-settings] .wcu-header{padding:0 0 22px}
      [data-wincu-settings] .wcu-community{display:flex;align-items:flex-start;gap:10px;padding:10px 13px;margin:0 0 18px;border:1px solid var(--wcu-border);border-radius:9px;background:var(--wcu-control)}
      [data-wincu-settings] .wcu-community a{display:inline-flex;align-items:center;gap:5px;vertical-align:baseline;white-space:nowrap;margin:2px 3px;padding:3px 8px;border:1px solid color-mix(in srgb,var(--wcu-accent) 75%,var(--wcu-border));border-radius:6px;background:color-mix(in srgb,var(--wcu-accent) 15%,var(--wcu-control));color:var(--wcu-fg);font-size:12px;line-height:1.5;font-weight:600;text-decoration:none;cursor:pointer;transition:background .15s,border-color .15s}
      [data-wincu-settings] .wcu-community a:hover{background:color-mix(in srgb,var(--wcu-accent) 28%,var(--wcu-control));border-color:#6ba9ef;text-decoration:underline;text-underline-offset:3px}
      [data-wincu-settings] .wcu-community a:focus-visible{outline:2px solid #6ba9ef;outline-offset:3px}
      [data-wincu-settings] .wcu-community svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      [data-wincu-settings] .wcu-community p{flex:1;min-width:0;font-size:12px;margin:0;line-height:1.9}
      [data-wincu-settings] .wcu-community[data-compact]{align-items:center;padding:0;border:0;background:none}
      [data-wincu-settings] .wcu-community[data-compact] p{flex:none}
      [data-wincu-settings] .wcu-community button{flex:none;min-height:0;padding:3px 8px;border-color:transparent;background:none;color:var(--wcu-muted);font-size:12px;line-height:1.5}
      [data-wincu-settings] .wcu-community button:hover:enabled{filter:none;color:var(--wcu-fg);text-decoration:underline;text-underline-offset:3px}
      [data-wincu-settings] .wcu-section{border:1px solid var(--wcu-border);border-radius:12px;padding:20px;margin-bottom:16px;background:var(--wcu-bg)}
      [data-wincu-settings] .wcu-row{display:flex;justify-content:space-between;align-items:center;gap:16px}
      [data-wincu-settings] .wcu-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0 8px;border:0;padding:0;min-width:0}
      [data-wincu-settings] .wcu-tool-detail[hidden]{display:none}
      @media(max-width:560px){[data-wincu-settings] .wcu-modes{grid-template-columns:1fr}}
      [data-wincu-settings] .wcu-mode{display:flex;gap:9px;align-items:flex-start;border:1px solid var(--wcu-border);border-radius:9px;padding:13px;background:var(--wcu-control);cursor:pointer;min-width:0}
      [data-wincu-settings] .wcu-mode:has(input:checked){border-color:var(--wcu-accent);background:color-mix(in srgb,var(--wcu-accent) 11%,var(--wcu-control))}
      [data-wincu-settings] .wcu-mode strong{display:block;font-size:14px;font-weight:600}
      [data-wincu-settings] .wcu-mode small{display:block;font-size:12px;color:var(--wcu-muted);line-height:1.5;margin-top:4px}
      [data-wincu-settings] .wcu-mode .wcu-count{color:var(--wcu-fg);margin-top:9px}
      [data-wincu-settings] input[type=radio],[data-wincu-settings] input[type=checkbox]{accent-color:var(--wcu-accent);width:16px;height:16px;flex:none;margin:3px 0 0}
      [data-wincu-settings] .wcu-toggle{position:relative;display:inline-flex;align-items:center;gap:10px;cursor:pointer}
      [data-wincu-settings] .wcu-toggle input{appearance:none;width:36px;height:21px;border:1px solid var(--wcu-border);border-radius:12px;background:var(--wcu-raised);margin:0;position:relative;cursor:pointer;transition:background .15s}
      [data-wincu-settings] .wcu-toggle input:after{content:'';position:absolute;width:15px;height:15px;left:2px;top:2px;border-radius:50%;background:var(--wcu-fg);transition:transform .15s}
      [data-wincu-settings] .wcu-toggle input:checked{background:var(--wcu-accent);border-color:var(--wcu-accent)}
      [data-wincu-settings] .wcu-toggle input:checked:after{transform:translateX(15px);background:white}
      [data-wincu-settings] .wcu-indicator-label{margin-top:14px}
      [data-wincu-settings] .wcu-cursor-preview{position:absolute;left:60%;top:55%;width:23px;height:23px;border:2px solid #70aefa;border-radius:50%;box-shadow:0 0 0 4px #70aefa22;pointer-events:none}
      [data-wincu-settings] .wcu-cursor-preview:before{content:'↖';position:absolute;left:6px;top:-1px;font-size:19px;line-height:1;color:var(--wcu-fg)}
      [data-wincu-settings] .wcu-cursor-preview:after{content:'DSH';position:absolute;left:20px;top:17px;padding:1px 5px;border:1px solid #70aefa;border-radius:5px;background:#15395f;color:#edf7ff;font-size:9px;line-height:1.4}
      [data-wincu-settings] .wcu-preview{display:grid;grid-template-columns:minmax(160px,1.1fr) minmax(100px,1fr);gap:20px;align-items:center;margin-top:18px}
      [data-wincu-settings] .wcu-screen{height:108px;border:2px solid var(--wcu-border);border-radius:8px;position:relative;background:var(--wcu-control);display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--wcu-muted);font-size:11px}
      [data-wincu-settings] .wcu-screen[data-enabled=true]{border-color:#70aefa;box-shadow:inset 0 0 12px #75b5ff33}
      [data-wincu-settings] .wcu-banner{position:absolute;left:12px;right:12px;padding:3px 8px;text-align:center;border-radius:4px;background:#176dcc;color:white;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      [data-wincu-settings] .wcu-choice{display:flex;gap:12px;margin:7px 0 8px;flex-wrap:wrap}
      [data-wincu-settings] .wcu-choice label{display:flex;gap:6px;align-items:center;cursor:pointer}
      [data-wincu-settings] .wcu-choice input{margin:0}
      [data-wincu-settings] .wcu-label{font-size:13px;font-weight:500;display:block;margin:0 0 7px}
      [data-wincu-settings] .wcu-control{font:inherit;color:var(--wcu-fg);background:var(--wcu-control);border:1px solid var(--wcu-border);border-radius:7px;padding:8px 10px;min-height:36px;max-width:100%;width:100%}
      [data-wincu-settings] .wcu-control:focus-visible,[data-wincu-settings] button:focus-visible,[data-wincu-settings] input:focus-visible,[data-wincu-settings] summary:focus-visible{outline:2px solid #6ba9ef;outline-offset:2px}
      [data-wincu-settings] .wcu-detail{border-top:1px solid var(--wcu-border);margin-top:18px;padding-top:14px}
      [data-wincu-settings] summary{cursor:pointer;color:var(--wcu-muted);font-size:13px;width:fit-content}
      [data-wincu-settings] .wcu-field{margin-top:16px}
      [data-wincu-settings] .wcu-tool-detail{margin-top:14px}
      [data-wincu-settings] .wcu-tool-body{margin:14px 0 0 5px;padding-left:16px;border-left:2px solid var(--wcu-border)}
      [data-wincu-settings] .wcu-tool-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:15px}
      [data-wincu-settings] .wcu-tool-group{border:0;border-top:1px solid var(--wcu-border);padding:14px 0 8px;margin:10px 0 0;min-width:0}
      [data-wincu-settings] .wcu-tool-group legend{padding:0 8px 0 0}
      [data-wincu-settings] .wcu-tool-group-label{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;cursor:pointer}
      [data-wincu-settings] .wcu-tool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 14px}
      [data-wincu-settings] .wcu-tool-item{display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--wcu-border);border-radius:7px;background:var(--wcu-control);cursor:pointer;min-width:0}
      [data-wincu-settings] .wcu-tool-item strong{display:block;font-size:13px;font-weight:500}
      [data-wincu-settings] .wcu-tool-item small{display:block;font-size:11px;color:var(--wcu-muted);margin-top:3px;line-height:1.5}
      [data-wincu-settings] .wcu-tool-count{font-size:12px;color:var(--wcu-muted);white-space:nowrap}
      @media(max-width:500px){[data-wincu-settings] .wcu-tool-grid{grid-template-columns:1fr}}
      [data-wincu-settings] .wcu-number{display:flex;gap:8px;align-items:center;color:var(--wcu-muted);font-size:13px}
      [data-wincu-settings] .wcu-number input{width:104px}
      [data-wincu-settings] .wcu-stop{align-items:flex-start;margin-top:13px}
      [data-wincu-settings] .wcu-key{font-size:12px;font-weight:600;font-family:inherit;line-height:1.4;border:1px solid var(--wcu-border);border-bottom-width:3px;border-radius:5px;background:var(--wcu-control);padding:3px 7px;margin-right:7px;white-space:nowrap}
      [data-wincu-settings] .wcu-stop-title{font-weight:500;display:flex;align-items:center}
      [data-wincu-settings] .wcu-shortcut-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
      [data-wincu-settings] .wcu-shortcut-value{min-width:110px;min-height:36px;display:inline-flex;align-items:center;padding:6px 10px;border:1px solid var(--wcu-border);border-radius:7px;background:var(--wcu-control);color:var(--wcu-fg)}
      [data-wincu-settings] .wcu-shortcut-value[data-recording=true]{border-color:#6ba9ef;outline:2px solid #6ba9ef33}
      [data-wincu-settings] button{font:inherit;border:1px solid var(--wcu-border);border-radius:7px;background:var(--wcu-raised);color:var(--wcu-fg);padding:7px 12px;min-height:34px;cursor:pointer;white-space:nowrap}
      [data-wincu-settings] button:hover:enabled{filter:brightness(1.08)}
      [data-wincu-settings] button.wcu-primary{background:#176dcc;border-color:#176dcc;color:white}
      [data-wincu-settings] button:disabled,[data-wincu-settings] input:disabled,[data-wincu-settings] fieldset:disabled{opacity:.5;cursor:not-allowed}
      [data-wincu-settings] .wcu-footer{position:sticky;bottom:-24px;background:var(--wcu-bg);padding:14px 0 12px;border-top:1px solid var(--wcu-border);display:flex;gap:12px;justify-content:space-between;align-items:center;z-index:1;box-shadow:0 -10px 14px var(--wcu-bg)}
      [data-wincu-settings] .wcu-actions{display:flex;gap:8px}
      [data-wincu-settings] .wcu-status{font-size:12px;color:var(--wcu-muted)}
      [data-wincu-settings] [data-tone=error]{color:var(--dsw-alias-label-error,#d56868)}
      [data-wincu-settings] [data-tone=success]{color:var(--dsw-alias-label-success,#4fa77b)}
      @media(max-width:700px){[data-wincu-settings] .wcu-section{padding:16px}[data-wincu-settings] .wcu-preview{grid-template-columns:1fr}[data-wincu-settings] .wcu-stop{flex-direction:column}[data-wincu-settings] .wcu-footer{flex-wrap:wrap}}
    `;
    Object.assign(dictionaries.zh,{pluginDescription:'让 AI 操作 Windows 桌面，支持控制提示、停止快捷键和工具选择。',openSettings:'点击进行具体设置 →',notLoaded:'未能读取 Computer Use 设置。宿主尚未提供此配置，请刷新页面或重新启动 DSH 后重试。',loadingSettings:'正在读取 Computer Use 设置…',reloadSettings:'刷新页面',delayHint:'整轮操作结束后再隐藏提示。范围 200–3000 毫秒。'});
    Object.assign(dictionaries.en,{pluginDescription:'Let the agent use Windows apps, with control indicators, stop shortcuts and tool selection.',openSettings:'Click to configure →',notLoaded:'Computer Use settings could not be read. The host has not exposed this configuration. Refresh or restart DSH.',loadingSettings:'Loading Computer Use settings…',reloadSettings:'Refresh page',delayHint:'Hide the indicator after the complete operation series ends. Range: 200–3000 ms.'});
    Object.assign(dictionaries.zh,{stop:'停止操作',stopHint:'Esc 只停止当前这一轮操作。下次发起任务或说“继续”即可再次使用，无需到设置恢复。普通鼠标移动和其他按键不会停止。',previewed:'已请求预览',indicatorHint:'操作和短暂思考期间持续显示；最后一次桌面操作完成后，空闲 30 秒自动收起。'});
    Object.assign(dictionaries.en,{stop:'Stop control',stopHint:'Esc stops this operation series. A new task or a request to continue can use the desktop automatically, with no settings change. Ordinary pointer movement and other keys do not stop control.',previewed:'Preview requested',indicatorHint:'Stay visible through actions and short reasoning gaps; hide after 30 seconds without another desktop action.'});
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
      return h(as,{'data-wincu-settings':'true'},h('style',null,css),
        h('header',{className:'wcu-header'},
          h('aside',{className:'wcu-community','data-wincu-community':'true','data-compact':noteCompact||undefined},noteCompact?h('p',null,communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win','projectLink','github','projectTitle')):h('p',null,t('starPrefix'),
            communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win','starLink','star','starTitle'),t('starAfter'),t('issueBefore'),
            communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new','issueLink','issue','issueTitle'),t('issueAfter')),
            button(noteCompact?'fullNote':'compactNote',{'data-wincu-note-toggle':true,title:t(noteCompact?'fullNoteTitle':'compactNoteTitle'),disabled:noteSaving||saving||!writable,onClick:toggleNote})),
          h('h2',null,t('title')),h('p',null,t('intro'))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-tools-title'},
          h('div',{className:'wcu-row'},h('h3',{id:idPrefix+'-tools-title'},t('toolsTitle')),h('span',{className:'wcu-tool-count','data-wincu-tool-count':true},draft.toolPreset==='lazy'?t('lazyCount'):t('toolsSelected')+' '+activeTools.length+' / '+allToolNames.length)),h('p',null,t('toolsHint')),
          h('div',{className:'wcu-modes',role:'radiogroup','aria-label':t('toolsTitle')},...['lite','full','lazy','custom'].map(preset=>h('label',{className:'wcu-mode',key:preset},h('input',{type:'radio',name:idPrefix+'-toolPreset',id:idPrefix+'-toolPreset-'+preset,value:preset,checked:draft.toolPreset===preset,disabled,onChange:()=>change('toolPreset',preset)}),h('span',null,h('strong',null,t(preset)),h('small',null,t(preset+'Summary')),h('small',{className:'wcu-count'},preset==='lazy'?t('lazyCount'):(preset==='lite'?liteToolNames.length:preset==='full'?allToolNames.length:draft.enabledTools.length)+' / '+allToolNames.length))))),
          h('details',{className:'wcu-tool-detail','data-wincu-tools':true,hidden:draft.toolPreset!=='custom',open:draft.toolPreset==='custom'},h('summary',null,t('customTools')),
            h('div',{className:'wcu-tool-body'},h('div',{className:'wcu-tool-toolbar'},button('allTools',{disabled:customDisabled||draft.enabledTools.length===allToolNames.length,onClick:()=>change('enabledTools',[...allToolNames])}),button('noTools',{disabled:customDisabled||!draft.enabledTools.length,onClick:()=>change('enabledTools',[])})),
              ...toolGroups.map(([group,entries])=>{const names=entries.map(entry=>entry[0]),count=names.filter(name=>draft.enabledTools.includes(name)).length;return h('fieldset',{className:'wcu-tool-group',disabled:customDisabled,key:group},
                h('legend',null,h('label',{className:'wcu-tool-group-label'},h('input',{type:'checkbox',id:idPrefix+'-tool-group-'+group,checked:count===names.length,'aria-checked':count&&count<names.length?'mixed':count===names.length,ref:input=>{if(input)input.indeterminate=count>0&&count<names.length;},onChange:e=>selectTools(names,e.target.checked)}),t('toolGroup_'+group),h('span',{className:'wcu-tool-count'},count+' / '+names.length))),
                h('div',{className:'wcu-tool-grid'},...entries.map(([name])=>h('label',{className:'wcu-tool-item',key:name,title:'windows_computer_use_'+name},h('input',{type:'checkbox',id:idPrefix+'-tool-'+name,'data-wincu-tool':name,checked:draft.enabledTools.includes(name),disabled:customDisabled,onChange:e=>selectTools([name],e.target.checked)}),h('span',null,h('strong',null,t('tool_'+name)),h('small',null,t('toolHint_'+name)))))));}))),
          draft.toolPreset==='lazy'&&h('p',{'data-wincu-lazy-hint':true},t('lazyHint')),h('p',null,t('customMemory')),h('p',null,t('toolAfter'))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-indicator-title'},
          h('div',{className:'wcu-row'},h('h3',{id:idPrefix+'-indicator-title'},t('indicatorTitle')),button('preview',{disabled:disabled||dirty||(!draft.indicatorEnabled&&!draft.cursorIndicatorEnabled),onClick:()=>run({previewToken:Date.now()},'previewed'),title:dirty?t('previewHint'):undefined})),
          h('label',{className:'wcu-toggle wcu-indicator-label'},h('input',{id:idPrefix+'-indicatorEnabled',type:'checkbox',role:'switch',checked:draft.indicatorEnabled,disabled,onChange:e=>change('indicatorEnabled',e.target.checked)}),h('span',null,t('indicator'))),h('p',null,t('indicatorHint')),
          h('label',{className:'wcu-toggle wcu-indicator-label'},h('input',{id:idPrefix+'-cursorIndicatorEnabled',type:'checkbox',role:'switch',checked:draft.cursorIndicatorEnabled,disabled,onChange:e=>change('cursorIndicatorEnabled',e.target.checked)}),h('span',null,t('cursorIndicator'))),h('p',null,t('cursorIndicatorHint')),
          h('label',{className:'wcu-toggle wcu-indicator-label'},h('input',{id:idPrefix+'-remoteIndicatorVisible',type:'checkbox',role:'switch',checked:draft.remoteIndicatorVisible,disabled,onChange:e=>change('remoteIndicatorVisible',e.target.checked)}),h('span',null,t('remoteVisible'))),h('p',null,t('remoteVisibleHint')),
          h('div',{className:'wcu-preview'},h('div',{className:'wcu-screen','data-enabled':draft.indicatorEnabled,'aria-hidden':true},
            draft.indicatorEnabled&&h('div',{className:'wcu-banner',style:{[draft.indicatorPosition==='top'?'top':'bottom']:'8px'}},draft.indicatorText),draft.cursorIndicatorEnabled&&h('span',{className:'wcu-cursor-preview'}),h('span',null,t(draft.indicatorEnabled||draft.cursorIndicatorEnabled?'previewOn':'previewOff'))),
            h('div',null,h('span',{className:'wcu-label'},t('position')),h('div',{className:'wcu-choice',role:'radiogroup','aria-label':t('position')},radio('indicatorPosition','top',t('top')),radio('indicatorPosition','bottom',t('bottom'))),h('p',null,t('previewNote')))),
          h('details',{className:'wcu-detail'},h('summary',null,t('appearance')),
            h('div',{className:'wcu-field'},h('label',{className:'wcu-label',htmlFor:idPrefix+'-text'},t('text')),h('input',{className:'wcu-control',id:idPrefix+'-text',type:'text',maxLength:120,value:draft.indicatorText,disabled:indicatorDisabled,onChange:e=>change('indicatorText',e.target.value)})),
            h('div',{className:'wcu-field'},h('label',{className:'wcu-label',htmlFor:idPrefix+'-delay'},t('delay')),h('div',{className:'wcu-number'},h('input',{className:'wcu-control',id:idPrefix+'-delay',type:'number',min:200,max:3000,step:100,value:draft.indicatorIdleMs,disabled:indicatorDisabled,onChange:e=>change('indicatorIdleMs',Number(e.target.value))}),h('span',null,t('ms'))),h('p',null,t('delayHint'))))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-stop-title'},h('h3',{id:idPrefix+'-stop-title'},t('stop')),
          h('div',{className:'wcu-row wcu-stop'},h('div',null,h('div',{className:'wcu-stop-title'},h('kbd',{className:'wcu-key'},'Esc'),t('escTitle')),h('p',null,t('stopHint')))),
          h('div',{className:'wcu-detail','data-wincu-shortcut':'true'},h('span',{className:'wcu-label'},t('extraStop')),h('p',null,t('shortcutHint')),
            h('div',{className:'wcu-shortcut-row'},h('output',{className:'wcu-shortcut-value','data-recording':recording,'aria-live':'polite','aria-label':t('extraStop')},recording?t('listening'):(draft.stopShortcut?draft.stopShortcut.split('+').join(' + '):t('noShortcut'))),
              button(recording?'cancelRecord':draft.stopShortcut?'rerecord':'record',{disabled:saving||!writable,onClick:()=>{setRecordMessage('');setRecording(!recording);}}),
              button('clearShortcut',{disabled:disabled||!draft.stopShortcut,onClick:()=>{change('stopShortcut','');setRecordMessage('');}})),
            recordMessage&&h('p',{role:'status'},t(recordMessage)))),
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
    function apply(ctx) {
      ctx.effect(()=>ctx.locale.register(NS,dictionaries));
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

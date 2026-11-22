// Browser module: DSH React, settings transport, and real navigation slots.
window.__ModuleLoader__.load({
  id: 'dsh-computer-use-win',
  factory: (require) => {
    const React = require('react'), h = React.createElement;
    const NS = 'windowsComputerUse.settings';
    const PLUGIN_VERSION = __WCU_BUILD_PLUGIN_VERSION__;
    const allToolNames = __WCU_BUILD_allToolNames__;
    const toolGroups = __WCU_BUILD_toolGroups__;
    const liteToolNames = __WCU_BUILD_liteToolNames__;
    const defaults = __WCU_BUILD_defaults__;
    const settingRules = __WCU_BUILD_settingRules__;
    const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
    const dictionaries = __WCU_BUILD_dictionaries__;
    const defaultIndicatorTexts = __WCU_BUILD_defaultIndicatorTexts__;
    const isDefaultIndicatorText=text=>!String(text??'').trim()||defaultIndicatorTexts.includes(String(text).trim());




    function shortcutFromEvent(event) {
      const code=event.code||'',special={Space:'Space',Enter:'Enter',NumpadEnter:'Enter',Tab:'Tab',Backspace:'Backspace',Delete:'Delete',Insert:'Insert',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Pause:'Pause',CapsLock:'CapsLock',NumLock:'NumLock',ScrollLock:'ScrollLock'};
      let key=/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit[0-9]$/.test(code)?code.slice(5):/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)?code:special[code];
      if(!key&&event.keyCode>=65&&event.keyCode<=90)key=String.fromCharCode(event.keyCode);
      if(!key&&event.keyCode>=48&&event.keyCode<=57)key=String.fromCharCode(event.keyCode);
      if(!key&&event.keyCode>=112&&event.keyCode<=135)key='F'+(event.keyCode-111);
      return key?[event.ctrlKey&&'Ctrl',event.altKey&&'Alt',event.shiftKey&&'Shift',event.metaKey&&'Win',key].filter(Boolean).join('+'):null;
    }
    const SHORTCUT_MODS=['Ctrl','Alt','Shift','Win'];
    const SHORTCUT_MOD_MAP={ctrl:'Ctrl',control:'Ctrl',alt:'Alt',option:'Alt',shift:'Shift',win:'Win',meta:'Win',super:'Win'};
    const SHORTCUT_SPECIAL_MAP={space:'Space',enter:'Enter',return:'Enter',tab:'Tab',backspace:'Backspace',delete:'Delete',del:'Delete',insert:'Insert',ins:'Insert',home:'Home',end:'End',pageup:'PageUp',pgup:'PageUp',pagedown:'PageDown',pgdn:'PageDown',up:'Up',arrowup:'Up',down:'Down',arrowdown:'Down',left:'Left',arrowleft:'Left',right:'Right',arrowright:'Right',pause:'Pause',capslock:'CapsLock',numlock:'NumLock',scrolllock:'ScrollLock'};
    const SHORTCUT_KEY_RE=/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Pause|CapsLock|NumLock|ScrollLock)$/;
    function formatShortcutInput(raw){
      const text=String(raw??'').trim();if(!text)return '';
      const parts=text.split('+').map(part=>part.trim());
      if(parts.some(part=>!part))return text;
      const lowerKey=parts.pop().toLowerCase(),mods=[];
      for(const part of parts){const mapped=SHORTCUT_MOD_MAP[part.toLowerCase()];if(!mapped||mods.includes(mapped))return text;mods.push(mapped);}
      let key='';
      if(/^[a-z0-9]$/.test(lowerKey))key=lowerKey.toUpperCase();
      else if(/^f([1-9]|1[0-9]|2[0-4])$/.test(lowerKey))key='F'+lowerKey.slice(1);
      else if(Object.hasOwn(SHORTCUT_SPECIAL_MAP,lowerKey))key=SHORTCUT_SPECIAL_MAP[lowerKey];
      else return text;
      return [...SHORTCUT_MODS.filter(m=>mods.includes(m)),key].join('+');
    }
    function isValidShortcut(value){
      if(!value)return true;
      const parts=String(value).split('+'),key=parts.pop();
      return parts.every(p=>SHORTCUT_MODS.includes(p))&&new Set(parts).size===parts.length&&SHORTCUT_KEY_RE.test(key);
    }
    const css=`
      [data-wincu-settings]{--wcu-card:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2,Canvas));--wcu-card-stroke:var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4,rgba(128,128,128,.34)));--wcu-sunken:var(--dsw-alias-bg-module-platform,color-mix(in srgb,var(--wcu-fg) 4%,var(--wcu-card)));--wcu-control:var(--dsw-alias-bg-layer-1,Canvas);--wcu-fg:var(--dsw-alias-label-primary,CanvasText);--wcu-muted:var(--dsw-alias-label-secondary,#61666b);--wcu-subtle:var(--dsw-alias-label-tertiary,#81858c);--wcu-line:var(--dsw-alias-border-l2,rgba(128,128,128,.2));--wcu-line-strong:var(--dsw-alias-border-l3,rgba(128,128,128,.3));--wcu-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));--wcu-accent:var(--dsw-alias-state-business-primary,#4176e6);--wcu-primary:var(--dsw-alias-button-primary-fill,#0f1115);--wcu-primary-fg:var(--dsw-alias-label-primary-foreground,#fff);--wcu-selected:var(--dsw-static-neutral-bluish-400,#adb2b8);--wcu-tip-bg:var(--dsw-alias-tooltip-bg,#2b2f36);--wcu-tip-fg:#fff;color:var(--wcu-fg);font:14px/1.55 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif);max-width:720px;list-style:none;box-sizing:border-box;margin:0;padding:0 0 8px}
      [data-wincu-settings] *{box-sizing:border-box}
      [data-wincu-settings] h2{font-size:18px;line-height:1.4;font-weight:600;margin:0}
      [data-wincu-settings] h3{font-size:15px;line-height:22px;font-weight:600;margin:0}
      [data-wincu-settings] p{margin:4px 0 0;color:var(--wcu-muted);font-size:13px;line-height:1.55}
      [data-wincu-settings] .wcu-header{padding:0 0 12px}
      [data-wincu-settings] .wcu-title-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      [data-wincu-settings] .wcu-version{font-size:13px;font-weight:500;color:var(--wcu-muted);white-space:nowrap}
      [data-wincu-settings] .wcu-title-end{display:flex;align-items:center;gap:6px;margin-left:auto}
      [data-wincu-settings] .wcu-update{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--wcu-muted);white-space:nowrap}
      [data-wincu-settings] .wcu-title-end button.wcu-small{height:30px}
      [data-wincu-settings] .wcu-update a.wcu-update-link{display:inline-flex;align-items:center;height:30px;padding:0 10px;border:.5px solid var(--wcu-line-strong);border-radius:var(--dsw-radius-sm,8px);color:var(--wcu-fg);font-size:12px;text-decoration:none}
      [data-wincu-settings] .wcu-update a.wcu-update-link:hover{background:var(--wcu-hover);text-decoration:none}
      [data-wincu-settings] .wcu-update a{color:var(--dsw-alias-label-link,#4176e6);text-decoration:none;white-space:nowrap}
      [data-wincu-settings] .wcu-update a:hover{text-decoration:underline}
      [data-wincu-settings] dialog.wcu-dialog{box-sizing:border-box;width:min(380px,calc(100vw - 32px));margin:auto;padding:20px 20px 16px;border:.5px solid var(--wcu-card-stroke);border-radius:var(--dsw-radius-xl,16px);background:var(--wcu-control);color:var(--wcu-fg);box-shadow:0 16px 48px rgba(0,0,0,.22)}
      [data-wincu-settings] dialog.wcu-dialog::backdrop{background:rgba(0,0,0,.32)}
      [data-wincu-settings] dialog.wcu-dialog p{margin:0;color:var(--wcu-fg);font-size:14px;line-height:1.6}
      [data-wincu-settings] dialog.wcu-dialog p.wcu-dialog-detail{margin-top:6px;color:var(--wcu-muted);font-size:12px;overflow-wrap:anywhere}
      [data-wincu-settings] dialog.wcu-dialog .wcu-dialog-file{margin-top:8px;font-weight:600;overflow-wrap:anywhere}
      [data-wincu-settings] dialog.wcu-dialog .wcu-dialog-path{display:block;margin-top:4px;font-size:12px;overflow-wrap:anywhere;user-select:text}
      [data-wincu-settings] dialog.wcu-dialog p.wcu-dialog-title{font-weight:600}
      [data-wincu-settings] dialog.wcu-dialog p.wcu-dialog-body{margin-top:6px;font-size:13px}
      [data-wincu-settings] .wcu-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
      [data-wincu-settings] .wcu-spinner{width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--wcu-muted) 35%,transparent);border-top-color:var(--wcu-muted);animation:wcu-spin .8s linear infinite}
      @keyframes wcu-spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){[data-wincu-settings] .wcu-spinner{animation:none}}
      [data-wincu-settings] .wcu-update-note{margin:6px 0 0;font-size:12px;line-height:1.5}
      [data-wincu-settings] .wcu-update-note p{margin:0}
      [data-wincu-settings] .wcu-update-note p+p{margin-top:4px}
      [data-wincu-settings] .wcu-update-progress{margin:8px 0 0;padding:10px 12px 12px;border-radius:var(--dsw-radius-md,12px);background:var(--wcu-sunken);border:.5px solid var(--wcu-line);color:var(--wcu-muted)}
      [data-wincu-settings] .wcu-update-progress-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12.5px;line-height:1.5}
      [data-wincu-settings] .wcu-update-progress-row>span{min-width:0}
      [data-wincu-settings] .wcu-update-bytes{font-variant-numeric:tabular-nums;white-space:nowrap}
      [data-wincu-settings] .wcu-progress{position:relative;height:4px;margin-top:8px;border-radius:999px;background:color-mix(in srgb,var(--wcu-muted) 22%,transparent);overflow:hidden}
      [data-wincu-settings] .wcu-progress>span{position:absolute;top:0;bottom:0;left:0;width:34%;border-radius:inherit;background:var(--wcu-accent);animation:wcu-indeterminate 1.3s ease-in-out infinite}
      [data-wincu-settings] .wcu-progress[data-determinate]>span{animation:none;transition:width .3s}
      @keyframes wcu-indeterminate{from{left:-34%}to{left:100%}}
      @media (prefers-reduced-motion:reduce){[data-wincu-settings] .wcu-progress:not([data-determinate])>span{animation:none;width:100%;opacity:.45}}
      [data-wincu-settings] .wcu-update-progress-note{margin:8px 0 0;font-size:12px;line-height:1.5}
      [data-wincu-settings] .wcu-link-button{padding:0;border:0;background:none;color:var(--dsw-alias-label-link,#71a7ff);font:inherit;cursor:pointer}
      [data-wincu-settings] .wcu-link-button:hover{text-decoration:underline}
      [data-wincu-settings] dialog.wcu-dialog.wcu-market-dialog{width:min(980px,calc(100vw - 32px));height:min(760px,calc(100vh - 48px));padding:0;display:flex;flex-direction:column;overflow:hidden}
      [data-wincu-settings] dialog.wcu-dialog.wcu-market-dialog:not([open]){display:none}
      [data-wincu-settings] .wcu-market-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:.5px solid var(--wcu-line)}
      [data-wincu-settings] .wcu-market-body{flex:1;min-height:0;overflow:auto}
      [data-wincu-settings] .wcu-header-actions{display:flex;gap:4px;align-items:center;margin-left:auto}
      [data-wincu-settings] .wcu-header-actions[data-compact]{gap:0;padding:1px;border:.5px solid var(--wcu-line-strong);border-radius:8px;background:transparent}
      [data-wincu-settings] .wcu-project-icon{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 8px;height:28px;color:var(--wcu-muted);border-radius:6px;font-size:12px;text-decoration:none;white-space:nowrap}
      [data-wincu-settings] .wcu-project-icon svg{width:16px;height:16px}
      [data-wincu-settings] .wcu-community{margin-top:10px!important;margin-bottom:4px!important}
      [data-wincu-settings] .wcu-header-actions .wcu-fold{min-width:32px;height:30px;padding:4px 8px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--wcu-muted)}
      [data-wincu-settings] .wcu-community .wcu-fold{float:right;margin-left:8px;border:0;background:transparent;height:24px;padding:0 4px;color:var(--wcu-muted)}
      [data-wincu-settings] .wcu-header>p{color:var(--wcu-subtle)}
      [data-wincu-settings] .wcu-community{display:block;padding:9px 8px 9px 14px;margin:0 0 18px;border:.5px solid var(--wcu-card-stroke);border-radius:var(--dsw-radius-md,12px);background:var(--wcu-card)}
      [data-wincu-settings] .wcu-community p{display:flow-root;min-width:0;margin:0;font-size:12.5px;line-height:1.95;color:var(--wcu-muted)}
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
      [data-wincu-settings] .wcu-fold svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s}
      [data-wincu-settings] .wcu-fold[aria-expanded=false] svg{transform:rotate(180deg)}
      [data-wincu-settings] .wcu-tool-count[data-wincu-tool-count]{flex:none;font-size:12px;line-height:20px;color:var(--wcu-muted);padding:2px 10px;border-radius:999px;background:var(--wcu-sunken)}
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
      [data-wincu-settings] .wcu-art .a-lock{fill:none;stroke:#fff;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}
      [data-wincu-settings] .wcu-art .a-lock-open{fill:none;stroke:var(--wcu-ink-strong);stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}
      [data-wincu-settings] .wcu-art .a-spot0{stop-color:var(--wcu-accent);stop-opacity:.42}
      [data-wincu-settings] .wcu-art .a-spot1{stop-color:var(--wcu-accent);stop-opacity:0}
      [data-wincu-settings] .wcu-art .a-tag{fill:#fff;font:700 7px/1 'Segoe UI',sans-serif}
      [data-wincu-settings] .wcu-art .a-cap{fill:var(--wcu-fg);font:600 12px/1 'Segoe UI',sans-serif}
      [data-wincu-settings] .wcu-item:has(.wcu-presets)>.wcu-item-main{flex:1}
      [data-wincu-settings] .wcu-segment.wcu-presets{display:flex;width:auto;align-self:stretch}
      [data-wincu-settings] .wcu-presets>label{flex:1;justify-content:center}
      [data-wincu-settings] .wcu-desktops>label{flex:1 1 auto;padding:4px 8px;text-align:center}
      [data-wincu-settings] [data-tone=warning]{color:var(--dsw-alias-state-warning-primary,#b26a00)}
      [data-wincu-settings] .wcu-notice li[data-tone]{font-weight:600}
      [data-wincu-settings] .wcu-notice li>.wcu-control{display:block;max-width:320px;margin:4px 0 2px}
      [data-wincu-settings] .wcu-hyperv-action{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin:4px 0 2px}
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
      [data-wincu-settings] .wcu-detail>.wcu-notice{margin-top:2px}
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










    // Chinese first: a feature's English name appears once, in brackets, where
    // the page first names it. Each hint sits behind an info icon.




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
    // Hyper-V Administrators by its SID, so the line works in every Windows language.
    const HYPERV_GROUP_COMMAND='Add-LocalGroupMember -SID S-1-5-32-578 -Member (whoami)';
    // A connection result names the setup step that fixes it: [message, step].
    const HYPERV_ISSUES={WCU_HYPERV_UNAVAILABLE:['hypervErrUnavailable',1],WCU_HYPERV_PERMISSION:['hypervErrPermission',2],WCU_HYPERV_VM_UNAVAILABLE:['hypervErrVmState',3],WCU_HYPERV_NODE_REQUIRED:['hypervMissingNode',3],
      WCU_HYPERV_DESKTOP_REQUIRED:['hypervMissingDesktop',4],WCU_HYPERV_VM_UNKNOWN:['hypervErrVmUnknown',5],WCU_HYPERV_VM_REQUIRED:['hypervVmRequired',5],WCU_HYPERV_SIGNIN_FAILED:['hypervErrSignIn',6]};
    // Work modes: [value, label, one-line hint]. Saved choices from before 0.6.3
    // (the current or the background desktop) read as Low disruption.
    const DESKTOP_OPTIONS=[['quiet','modeQuiet','modeQuietHint'],['fast','modeFast','modeFastHint'],['hyperv','modeVm','modeVmHint']];
    const LEGACY_DESKTOP_TARGETS={current:'quiet',background:'quiet'};
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
      // Work modes. Low disruption: your window and pointer, DSH's pointer on a
      // hidden desktop beside them (dashed). Foreground: DSH's pointer in the
      // window in front of another, under the "hands off" banner. Virtual
      // machine: DSH's pointer inside a Hyper-V window, yours outside.
      desktop:target=>drawing(...monitor(),...(target==='hyperv'
        ?[box('a-win',16,9,66,38,3),h('path',{className:'a-bar',d:'M16 12a3 3 0 0 1 3-3h60a3 3 0 0 1 3 3v3H16z'}),box('a-desk',20,19,58,24,2),h('text',{className:'a-cap',x:39,y:35.5,textAnchor:'middle'},'VM'),dshArrow(57,25),box('a-frame',16,9,66,38,3),arrow(87,27)]
        :target==='fast'
          ?[...banner(7.5),box('a-win',60,22,33,21,2.5),box('a-frame',60,22,33,21,2.5),box('a-win',16,20,56,27,2.5),h('path',{className:'a-bar',d:'M16 22.5a2.5 2.5 0 0 1 2.5-2.5h51a2.5 2.5 0 0 1 2.5 2.5V25H16z'}),box('a-ink',21,30,28,2.2,1.1),box('a-ink',21,35,20,2.2,1.1),box('a-frame',16,20,56,27,2.5),dshArrow(48,31)]
          :[box('a-win',15,12,40,27,2.5),box('a-ink',19,19,24,2.2,1.1),box('a-ink',19,24,17,2.2,1.1),box('a-frame',15,12,40,27,2.5),arrow(38,26),box('a-ghost',60,9,37,32,2.5),dshArrow(75,20)])),
      // One square per tool: filled loads at startup, dashed loads on demand, faint is off.
      tools:(loaded,allowed)=>drawing(...toolGroups.flatMap(([,entries],row)=>entries.map(([name],col)=>box(loaded.has(name)?'a-acc':allowed.has(name)?'a-open':'a-ink',15.5+col*12,12.5+row*12,9,9,2.2)))),
      esc:()=>drawing(box('a-ink2',33,19,46,34,7),box('a-win',33,16,46,34,7),box('a-frame',33,16,46,34,7),h('text',{className:'a-cap',x:56,y:37.2,textAnchor:'middle'},'Esc')),
      progress:on=>drawing(...monitor(),box('a-win',16,13,34,24,2.5),box('a-ink',20,20,22,2.2,1.1),box('a-ink',20,25,16,2.2,1.1),box('a-frame',16,13,34,24,2.5),...(on?[box('a-pill',54,10,43,29,3.5),h('circle',{className:'a-dot',cx:59.5,cy:15.5,r:1.7}),box('a-text',63.5,14.6,22,1.8,.9),box('a-text',58,21,33,1.8,.9),box('a-text',58,26.5,27,1.8,.9),box('a-text',58,32,19,1.8,.9)]:[box('a-ghost',54,10,43,29,3.5)])),
      lock:locked=>drawing(box(locked?'a-win a-edge':'a-win a-frame',18,12,62,45,4.5),box('a-ink',25,23,36,2.6,1.3),box('a-ink',25,30,42,2.6,1.3),box('a-ink',25,37,28,2.6,1.3),box(locked?'a-acc':'a-win',68,9,22,22,5.5),...(!locked?[box('a-frame',68,9,22,22,5.5)]:[]),h('path',{className:locked?'a-lock':'a-lock-open',d:locked?'M76 19.5v-2.2a3 3 0 0 1 6 0v2.2M74.8 19.5h8.4v6.2h-8.4z':'M76 19.5v-2.4a3 3 0 0 1 5.6-1.4M74.8 19.5h8.4v6.2h-8.4z'}),...(locked?[arrow(48,31)]:[]))
    };

    // npm's latest tag supplies the target. DSH's market identifies the active
    // profile's install and performs the install on a click. Local installs and
    // older hosts get the upgrade instructions.
    const UPDATE_PACKAGE='dsh-computer-use-win';
    const UPDATE_SCHEMA='dsh-market/update-api/v1';
    // The market holds a release younger than its waiting period. The click
    // asked for the update, so it is sent once more with force; the market
    // checks host compatibility before it gets this far.
    const UPDATE_HOLD_CODES=['RELEASE_TOO_FRESH','VERSION_UNCHANGED'];
    const UPDATE_TERMINAL=['succeeded','failed','cancelled','rolled-back'];
    const versionParts=value=>{const m=/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value??'').trim());return m?{core:[+m[1],+m[2],+m[3]],pre:m[4]?m[4].split('.'):[]}:null;};
    // Semantic-version order; NaN when either side is not a version.
    function compareVersions(left,right){
      const a=versionParts(left),b=versionParts(right);
      if(!a||!b)return NaN;
      for(let i=0;i<3;i++)if(a.core[i]!==b.core[i])return a.core[i]<b.core[i]?-1:1;
      if(!a.pre.length||!b.pre.length)return a.pre.length===b.pre.length?0:a.pre.length?-1:1;
      for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++){
        const p=a.pre[i],q=b.pre[i];
        if(p===undefined)return -1;if(q===undefined)return 1;if(p===q)continue;
        const pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);
        if(pn&&qn)return +p<+q?-1:1;if(pn!==qn)return pn?-1:1;return p<q?-1:1;
      }
      return 0;
    }
    // A settings page can be reloaded while the market replaces the package.
    // Keep the operation it accepted in this window; never send it again.
    const UPDATE_RECEIPT_KEY='dsh-computer-use-win.update.v1';
    const UPDATE_TIMEOUT_MS=15*60000;
    function updateReceipt(value){
      try{
        if(value===null){sessionStorage.removeItem(UPDATE_RECEIPT_KEY);return null;}
        if(value!==undefined){sessionStorage.setItem(UPDATE_RECEIPT_KEY,JSON.stringify(value));return value;}
        const receipt=JSON.parse(sessionStorage.getItem(UPDATE_RECEIPT_KEY));
        if(receipt&&versionParts(receipt.before)&&versionParts(receipt.target)&&typeof receipt.id==='string'&&receipt.id.length<=256&&Date.now()-receipt.at>=0&&Date.now()-receipt.at<24*60*60000)return receipt;
      }catch{}
      return null;
    }
    const updateStore={state:{phase:'idle'},listeners:new Set(),
      set(patch){this.state={...this.state,...patch};for(const listener of [...this.listeners])listener();},
      subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}};
    async function requestJson(url,{method='GET',body,timeoutMs=10000,headers={}}={}){
      const controller=typeof AbortController==='function'?new AbortController():undefined;
      const timer=controller&&setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),...(controller?{signal:controller.signal}:{})});
        let data=null;try{data=await response.json();}catch{}
        return {status:response.status,ok:response.ok,data};
      }finally{if(timer)clearTimeout(timer);}
    }
    // undefined: not asked yet; null: no usable market (asked again on the next check).
    let updateMarket,updateChecking,updateRecoveryTimer,updateStarted=false;
    async function discoverMarket(){
      if(updateMarket)return updateMarket;
      try{
        const {ok,data}=await requestJson('/dsh-market/api/v1/capabilities');
        updateMarket=ok&&data?.schema===UPDATE_SCHEMA&&data.features?.check&&data.features?.update&&typeof data.endpoints?.updates==='string'&&typeof data.endpoints?.operations==='string'?data:null;
      }catch{updateMarket=null;}
      return updateMarket;
    }
    async function marketPackage(market,{fresh=false}={}){
      if(!market)return null;
      try{
        const {status,data}=await requestJson(market.endpoints.updates+'?name='+UPDATE_PACKAGE+(fresh?'&force=1':''),{timeoutMs:30000});
        return status===200&&versionParts(data?.package?.installedVersion)?data.package:null;
      }catch{return null;}
    }
    // npm's own registry first. Where it cannot be reached, the public mirrors
    // DSH's market uses in mainland China answer instead.
    const UPDATE_REGISTRIES=['https://registry.npmjs.org','https://mirrors.cloud.tencent.com/npm','https://registry.npmmirror.com'];
    async function latestNpmVersion(){
      for(const registry of UPDATE_REGISTRIES){
        try{
          const {ok,data}=await requestJson(registry+'/'+UPDATE_PACKAGE+'/latest',{timeoutMs:8000});
          if(ok&&versionParts(data?.version))return data.version;
        }catch{}
      }
      return null;
    }
    async function recoverUpdateConfirmation(market,found,latest){
      const receipt=updateReceipt();
      if(!market||!receipt)return null;
      const {status,data}=await requestJson(market.endpoints.operations+'?operationId='+encodeURIComponent(receipt.id),{timeoutMs:5000}).catch(()=>({}));
      const operation=data?.operation?.operationId===receipt.id?data.operation:null;
      if(operation&&['queued','running'].includes(operation.state))return {pending:true};
      if(operation&&operation.state!=='succeeded'){updateReceipt(null);return null;}
      const verified=operation?.state==='succeeded'?operation.installedVersion:null;
      if(compareVersions(verified,receipt.before)>0&&(compareVersions(verified,receipt.target)===0||
          (compareVersions(verified,receipt.target)>0&&compareVersions(latest,verified)>=0))){
        const restartRequired=operation.outcome?.restartRequired===true;
        return {installed:verified,restartRequired,refreshRequired:operation.outcome?.refreshRequired===true&&compareVersions(verified,PLUGIN_VERSION)>0,dialog:!receipt.dismissed};
      }
      // The market can discard its in-memory operation on a host restart.
      // An older client still running against a newer disk install needs a restart.
      if(compareVersions(found?.installedVersion,receipt.target)>=0&&compareVersions(found.installedVersion,PLUGIN_VERSION)>0)
        return {restartRequired:true,refreshRequired:false,dialog:!receipt.dismissed};
      if(status===404)updateReceipt(null);
      return null;
    }
    function settleUpdateCheck({found,latest,confirmation}){
      const installed=confirmation?.installed??found?.installedVersion??PLUGIN_VERSION;
      const source=found?.source==='npm'?'market':'help';
      // A newer version already on disk is an update waiting for a restart.
      const phase=confirmation?.pending?'updating':confirmation||compareVersions(installed,PLUGIN_VERSION)>0?'updated':compareVersions(latest,installed)>0?'available':latest?'latest':'unknown';
      const success=phase==='updated';
      const restartRequired=confirmation?.restartRequired??success;
      updateStore.set({phase,source,installed,latest,failure:null,waiting:null,notice:null,marketMissing:false,stage:null,bytes:null,stoppable:false,stopping:false,checkedAt:Date.now(),restartRequired,refreshRequired:confirmation?.refreshRequired??false,dialog:confirmation?.dialog??false,runtime:updateMarket?.runtime??null,restartSupported:source==='market'&&updateMarket?.restart?.supported===true&&typeof updateMarket.endpoints?.restart==='string'});
      if(restartRequired)void probeRestart();
      if(confirmation?.pending)updateRecoveryTimer=setTimeout(()=>{void checkUpdate();},2000);
    }
    // Checks run on their own: once per DSH start, and again when the settings
    // page opens on a result that is old or missing. "Check for updates" asks
    // the market to skip its cache.
    function checkUpdate({fresh=false}={}){
      if(updateRun||updateStore.state.phase==='updated')return Promise.resolve();
      if(updateChecking)return updateChecking;
      updateStore.set({checking:true});
      updateChecking=(async()=>{
        const [found,latest]=await Promise.all([discoverMarket().then(market=>marketPackage(market,{fresh})),latestNpmVersion()]);
        const confirmation=await recoverUpdateConfirmation(updateMarket,found,latest);
        settleUpdateCheck({found,latest,confirmation});
      })().finally(()=>{updateChecking=undefined;updateStore.set({checking:false});});
      return updateChecking;
    }
    function failUpdate(failure){updateStore.set({phase:'failed',percent:null,waiting:null,stage:null,bytes:null,stoppable:false,stopping:false,stopLate:false,stopUnsupported:false,notice:null,failure:{code:String(failure?.code||'UPDATE_FAILED'),message:String(failure?.message||'').slice(0,300),retryable:failure?.retryable!==false}});}
    // Stop update. Each run has its own flag, and `wake` ends the wait it is in.
    let updateRun=null;
    const nap=(run,ms)=>new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);if(run.wake===done)run.wake=null;resolve();};timer=setTimeout(done,ms);run.wake=done;});
    // The step the market reports. pnpm resolves, downloads, then links (it
    // swaps the plugin's folder) and builds; before pnpm starts, the market
    // prepares. A stop is sent only before the swap: one during it leaves the
    // old build half removed, and the market then drops the plugin.
    function marketStage(operation){
      const phase=operation?.state==='running'?operation.progress?.phase:null;
      return phase==='resolving'?'resolve':phase==='downloading'?'download':phase==='linking'||phase==='building'?'install':'prepare';
    }
    // The public update API has no cancel. The market's own Cancel button posts
    // here, and it stops pnpm.
    async function cancelMarket(){
      try{const {status}=await requestJson('/dsh-market/cancel',{method:'POST',body:{},timeoutMs:10000});return status===200?'sent':status===404||status===405?'unsupported':'retry';}
      catch{return 'retry';}
    }
    // One market operation: the request, then its progress until it ends.
    async function runUpdateOperation(market,force,run){
      const {status,data}=await requestJson(market.endpoints.updates,{method:'POST',body:{packageName:UPDATE_PACKAGE,...(force?{force:true}:{})},timeoutMs:30000});
      let operation=data?.operation;
      if(status!==202||!operation?.operationId)return {failure:data?.failure??{code:status===409?'OPERATION_BUSY':'UPDATE_FAILED',message:data?.error||('HTTP '+status),retryable:status===409}};
      const id=operation.operationId,at=Date.now(),deadline=at+UPDATE_TIMEOUT_MS;
      updateReceipt({id,at,before:run.before,target:run.target});
      let swapping=false,cancel=null;
      const poll=async()=>{
        const polled=await requestJson(market.endpoints.operations+'?operationId='+encodeURIComponent(id),{timeoutMs:15000}).catch(()=>null);
        if(polled?.status===404)return false;
        if(polled?.data?.operation?.operationId===id)operation=polled.data.operation;
        return true;
      };
      const show=()=>{
        const stage=marketStage(operation);
        // Once the swap begins the operation stays unstoppable, a rollback included.
        if(stage==='install')swapping=true;
        const progress=operation.progress??{},size=Number(progress.size),done=Number(progress.downloaded);
        const bytes=!swapping&&stage==='download'&&size>0&&Number.isFinite(done)?{done:Math.max(0,Math.min(size,done)),total:size}:null;
        const percent=bytes?Math.round(bytes.done/bytes.total*100):Number.isFinite(progress.percent)?Math.max(0,Math.min(100,Math.round(progress.percent))):null;
        const stopping=run.stop&&!swapping&&cancel!=='unsupported';
        updateStore.set({waiting:null,stage:swapping?'install':stage,bytes,percent,stoppable:!swapping&&cancel!=='unsupported',stopping,stopLate:run.stop&&swapping&&cancel!=='sent',stopUnsupported:run.stop&&cancel==='unsupported'});
      };
      show();
      while(!UPDATE_TERMINAL.includes(operation.state)){
        if(Date.now()>deadline)return {failure:{code:'UPDATE_STATUS_UNKNOWN'}};
        const cancelling=()=>run.stop&&!swapping&&cancel!=='sent'&&cancel!=='unsupported';
        if(cancelling()){
          // A fresh read right before the request: the cancel has to land before the swap.
          if(!await poll())return {failure:{code:'UPDATE_STATUS_UNKNOWN'}};
          show();
          if(!swapping&&operation.state==='running')cancel=await cancelMarket();
          show();
        }
        await nap(run,cancelling()?300:500);
        if(!await poll())return {failure:{code:'UPDATE_STATUS_UNKNOWN'}};
        show();
      }
      if(operation.state==='cancelled')return {cancelled:true};
      if(operation.state!=='succeeded')return {failure:operation.failure??{code:'UPDATE_FAILED'}};
      return {operation};
    }
    // Tests shorten both waits below.
    const updateWaitMs=normal=>Number.isFinite(globalThis.__wcuUpdateSyncMs)?globalThis.__wcuUpdateSyncMs:normal;
    // The market runs one install at a time. A busy market is waited for
    // (every 5 s, up to 3 minutes) rather than reported.
    const UPDATE_BUSY_TRIES=36;
    async function runWhenFree(market,force,run){
      let result=await runUpdateOperation(market,force,run);
      for(let tries=0;result.failure?.code==='OPERATION_BUSY'&&tries<UPDATE_BUSY_TRIES;tries++){
        updateStore.set({waiting:'busy',stoppable:true});
        await nap(run,updateWaitMs(5000));
        if(run.stop)return {stopped:true};
        result=await runUpdateOperation(market,force,run);
      }
      updateStore.set({waiting:null});
      return result;
    }
    // Before the market swaps the plugin's folder, nothing may hold it open; the
    // plugin checks by renaming it away and back (mcp/update-guard.mjs).
    const UPDATE_READY_ROUTE='/dsh-computer-use-win/api/update-ready';
    async function checkReplaceable(){
      try{
        const {status,data}=await requestJson(UPDATE_READY_ROUTE,{method:'POST',body:{},headers:{'x-wcu-request':'1'},timeoutMs:70000});
        if(status===200&&data?.ready===true)return {};
        if(status===200&&data?.ready===false)return {failure:{code:'UPDATE_LOCKED',message:String(data.code||''),retryable:true}};
        // A host that serves no plugin routes updates as before.
        if(status===404)return {};
        return {failure:{code:'UPDATE_CHECK_FAILED',message:data?.error||('HTTP '+status),retryable:true}};
      }catch{return {failure:{code:'UPDATE_CHECK_FAILED',retryable:true}};}
    }
    // A failed or stopped run can leave the market without the plugin (it drops
    // one whose old files were already half replaced); the page then says how
    // to get it back.
    async function withInstallState(market,failure){
      try{const {status}=await requestJson(market.endpoints.updates+'?name='+UPDATE_PACKAGE+'&force=1',{timeoutMs:30000});if(status===404)return {code:'PLUGIN_REMOVED',message:failure?.message,retryable:false};}catch{}
      return failure;
    }
    // The market installs from its own registry, a mirror in some regions, which
    // can trail npm by a few minutes after a release. A click waits for it
    // (up to 40 checks, 15 s apart) rather than failing.
    const UPDATE_SYNC_CHECKS=40;
    async function startUpdate(){
      const state=updateStore.state,market=updateMarket;
      if(!market||state.source!=='market'||state.checking||!['available','failed'].includes(state.phase))return;
      const before=state.installed,run={stop:false,wake:null,before};
      updateRun=run;
      updateStore.set({phase:'updating',percent:null,failure:null,waiting:null,stage:'prepare',bytes:null,stoppable:true,stopping:false,stopLate:false,stopUnsupported:false,notice:null,restartVia:undefined});
      // Back to Update, saying the plugin is as it was.
      const stopped=()=>updateStore.set({phase:'available',percent:null,waiting:null,stage:null,bytes:null,stoppable:false,stopping:false,stopLate:false,stopUnsupported:false,notice:{kind:'stopped',version:before}});
      try{
        const [checked,target]=await Promise.all([marketPackage(market),latestNpmVersion()]);
        if(run.stop)return stopped();
        if(!target)return failUpdate({code:'NPM_CHECK_FAILED'});
        let found=checked;
        for(let checks=0;;checks++){
          if(found?.source==='linked'||(found&&compareVersions(found.installedVersion,target)>=0))return settleUpdateCheck({found,latest:target});
          if(found?.source==='npm'&&compareVersions(found.latestVersion,target)===0)break;
          if(checks>0&&!found)return failUpdate({code:'UPDATE_FAILED'});
          // Another source, or a market ahead of npm, does not change by waiting.
          if((found&&(found.source!=='npm'||compareVersions(found.latestVersion,target)>0))||checks>=UPDATE_SYNC_CHECKS)return failUpdate({code:'MARKET_NOT_SYNCED'});
          if(checks>0){updateStore.set({waiting:'sync'});await nap(run,updateWaitMs(15000));if(run.stop)return stopped();}
          found=await marketPackage(market,{fresh:true});
          if(run.stop)return stopped();
        }
        updateStore.set({waiting:null,stage:'check'});
        const ready=await checkReplaceable();
        if(run.stop)return stopped();
        if(ready.failure)return failUpdate(ready.failure);
        run.target=target;
        updateStore.set({stage:'prepare'});
        let result=await runWhenFree(market,false,run);
        if(UPDATE_HOLD_CODES.includes(result.failure?.code)&&!run.stop)result=await runWhenFree(market,true,run);
        if(result.stopped)return stopped();
        if(result.cancelled){
          updateReceipt(null);
          // The plugin must be as it was before; the market says what it has now.
          const now=await marketPackage(market,{fresh:true});
          if(now&&compareVersions(now.installedVersion,before)===0)return stopped();
          if(!now)return failUpdate(await withInstallState(market,{code:'UPDATE_CANCELLED'}));
          return settleUpdateCheck({found:now,latest:target});
        }
        if(result.failure){if(result.failure.code!=='UPDATE_STATUS_UNKNOWN')updateReceipt(null);return failUpdate(await withInstallState(market,result.failure));}
        const {operation}=result;
        // The API asks each client to compare the installed version with the
        // version it offered before it reports success or offers a restart.
        if(!(compareVersions(operation.installedVersion,target)>=0&&compareVersions(operation.installedVersion,found.installedVersion)>0)
          || compareVersions(operation.installedVersion,operation.beforeVersion)<0)return failUpdate({code:'RESOLVED_VERSION_MISMATCH',message:String(operation.installedVersion??'')});
        if(compareVersions(operation.installedVersion,target)>0&&!(compareVersions(await latestNpmVersion(),operation.installedVersion)>=0))return failUpdate({code:'UPDATE_STATUS_UNKNOWN'});
        const restartRequired=operation.outcome?.restartRequired===true;
        updateStore.set({phase:'updated',installed:operation.installedVersion,percent:null,stage:null,bytes:null,stoppable:false,stopping:false,restartRequired,refreshRequired:operation.outcome?.refreshRequired===true,dialog:true,restartFailed:false});
        if(restartRequired)await probeRestart();
      }catch{failUpdate({code:'UPDATE_STATUS_UNKNOWN'});}
      finally{if(updateRun===run)updateRun=null;}
    }
    function stopUpdate(){
      const run=updateRun,state=updateStore.state;
      if(!run||run.stop||state.phase!=='updating'||!state.stoppable)return;
      run.stop=true;
      updateStore.set({stopping:true});
      run.wake?.();
    }
    // The fallback when this button cannot update: the market's own panel on
    // its Installed tab, searched for this plugin (market.render, the market's
    // public client service). Without that service, its entry in the settings
    // navigation and then its Installed tab.
    let pageCtx=null;
    function marketService(){
      try{const market=pageCtx?.reflect?.get?.('market');return market&&typeof market.render==='function'?market:null;}catch{return null;}
    }
    const MARKET_LABELS=['插件市场','Plugin Market'],MARKET_INSTALLED=['已安装','Installed'];
    function openMarketInstalled(){
      if(marketService()){updateStore.set({marketDialog:true});return true;}
      const nav=[...document.querySelectorAll('button[class*="navCell"]')].find(button=>MARKET_LABELS.includes(button.textContent.trim()));
      if(!nav)return false;
      nav.click();
      let tries=0;
      const timer=setInterval(()=>{
        const tab=[...document.querySelectorAll('button,[role=tab]')].find(node=>!node.closest('[data-wincu-settings]')&&MARKET_INSTALLED.includes(node.textContent.trim()));
        if(tab)tab.click();
        if(tab||++tries>=40)clearInterval(timer);
      },50);
      return true;
    }
    const formatBytes=value=>value<1024?value+' B':value<1048576?Math.round(value/1024)+' KB':(value/1048576).toFixed(1)+' MB';
    // Who runs "Restart now": the plugin market, which restarts a host nothing
    // supervises, else this plugin, which restarts DSH Desktop (mcp/restart.mjs).
    // null: neither can, and the page says how to restart by hand.
    const RESTART_ROUTE='/dsh-computer-use-win/api/restart';
    async function probeRestart(){
      if(updateStore.state.restartSupported){updateStore.set({restartVia:'market'});return;}
      let via=null;
      try{
        const {status,data}=await requestJson(RESTART_ROUTE,{headers:{'x-wcu-request':'1'},timeoutMs:5000});
        if(status===200&&data?.supported===true)via='plugin';
      }catch{}
      updateStore.set({restartVia:via});
    }
    // A restart that works closes this page together with DSH. A page still
    // open a minute later means DSH did not restart; the dialog then says how
    // to restart by hand.
    const restartWaitMs=()=>Number.isFinite(globalThis.__wcuRestartWaitMs)?globalThis.__wcuRestartWaitMs:60000;
    async function restartNow(){
      const {restartVia,restarting}=updateStore.state;
      if(!restartVia||restarting)return;
      updateStore.set({restarting:true,restartFailed:false});
      let ok=true;
      try{
        const url=restartVia==='market'?updateMarket?.endpoints?.restart:RESTART_ROUTE;
        ({ok}=await requestJson(url,{method:'POST',body:{},headers:restartVia==='plugin'?{'x-wcu-request':'1'}:{},timeoutMs:15000}));
      }catch{/* A restart under way may close the connection before it replies. */}
      if(!ok){updateStore.set({restarting:false,restartFailed:true});return;}
      setTimeout(()=>{if(updateStore.state.restarting)updateStore.set({restarting:false,restartFailed:true});},restartWaitMs());
    }
    const fill=(text,values)=>String(text).replace(/\{(\w+)\}/g,(_,key)=>values[key]??'');
    const UPDATE_STALE_MS=6*60*60*1000;
    const updateResultMs=()=>Number.isFinite(globalThis.__wcuUpdateResultMs)?globalThis.__wcuUpdateResultMs:4000;
    // Left of the GitHub link, one transparent button: "Check for updates", or
    // "Update" when a newer version can be installed; a word or two while
    // either runs and after it. Versions sit in the tooltips.
    function UpdateInline({t}){
      const state=React.useSyncExternalStore(listener=>updateStore.subscribe(listener),()=>updateStore.state);
      // What a check the user asked for found, shown for a moment before the
      // button returns; null when nothing was asked.
      const [asked,setAsked]=React.useState(null),resultTimer=React.useRef();
      // DSH can stay open for days: an old or failed check is repeated when
      // the page opens.
      React.useEffect(()=>{const current=updateStore.state;if((current.phase==='idle'&&updateReceipt())||current.phase==='unknown'||(['latest','available'].includes(current.phase)&&Date.now()-(current.checkedAt??0)>UPDATE_STALE_MS))void checkUpdate();return ()=>clearTimeout(resultTimer.current);},[]);
      const checkNow=async()=>{
        clearTimeout(resultTimer.current);setAsked('checking');
        // A check already running may have read the market's cache: ask again.
        try{await updateChecking;await checkUpdate({fresh:true});}catch{}
        const phase=updateStore.state.phase;
        if(phase!=='latest'&&phase!=='unknown'){setAsked(null);return;}
        setAsked(phase);resultTimer.current=setTimeout(()=>setAsked(null),updateResultMs());
      };
      const small=(text,props)=>h('button',{type:'button',className:'wcu-small',...props},text);
      const wrap=(tone,...children)=>h('span',{className:'wcu-update','data-wincu-update':state.phase,'data-tone':tone||undefined},...children);
      if(['idle','latest','unknown'].includes(state.phase)){
        if(asked==='checking')return wrap('',h('span',{className:'wcu-spinner','aria-hidden':true}),h('span',{role:'status'},t('updateChecking')));
        if(asked)return wrap('',h('span',{role:'status','data-wincu-update-result':asked},t(asked==='latest'?'updateLatest':'updateCheckFailed')));
        return wrap('',small(t('updateCheck'),{'data-wincu-update-check':true,title:fill(t('updateCurrent'),{version:PLUGIN_VERSION}),onClick:()=>{void checkNow();}}));
      }
      if(state.phase==='available')return wrap('',state.source==='market'
        ?small(t('updateNow'),{'data-wincu-update-now':true,disabled:state.checking,title:fill(t('updateAvailable'),{version:state.latest}),onClick:()=>{void startUpdate();}})
        :h('a',{className:'wcu-update-link',href:t('updateHelpUrl'),target:'_blank',rel:'noopener noreferrer',title:fill(t('updateAvailable'),{version:state.latest})+' · '+t('updateHow'),'data-wincu-update-help':true},t('updateNow')));
      if(state.phase==='updating')return wrap('',h('span',{className:'wcu-spinner','aria-hidden':true}),h('span',null,t('updateRunning')+(state.percent!=null?' '+state.percent+'%':'')));
      // What finishes it comes from the market: a restart, a page reload, or
      // nothing. The dialog opens when an update the user started succeeds;
      // until DSH restarts, a button here opens it again (or, without a
      // one-click restart, the note below the title says what to do).
      if(state.phase==='updated')return h(React.Fragment,null,
        wrap('success',h('span',{title:fill(t('updateDoneTitle'),{version:state.installed})},t('updateDone')),
          state.restartRequired&&small(t(state.restarting?'updateRestartingShort':'updateRestartPending'),{'data-wincu-update-reminder':true,'data-wincu-update-restart':state.restartVia?true:undefined,disabled:state.restarting,onClick:()=>updateStore.set({dialog:true})}),
          !state.restartRequired&&state.refreshRequired&&small(t('updateRefresh'),{'data-wincu-update-refresh':true,onClick:refreshAfterUpdate})),
        state.dialog?h(UpdateDialog,{t,state}):null);
      if(state.phase==='failed'){
        const code=state.failure?.code;
        return wrap('error',h('span',null,t(code==='OPERATION_BUSY'?'updateBusy':code==='UPDATE_STATUS_UNKNOWN'?'updateUnconfirmed':'updateFailed')),
          code==='UPDATE_STATUS_UNKNOWN'?small(t('updateRecheck'),{'data-wincu-update-recheck':true,disabled:state.checking,onClick:()=>{void checkUpdate({fresh:true});}})
          :state.failure?.retryable&&updateMarket&&state.source==='market'?small(t('updateRetry'),{'data-wincu-update-retry':true,onClick:()=>{void startUpdate();}}):null);
      }
      return null;
    }
    // "Report a problem": the plugin writes the diagnostics to Downloads, then
    // opens that folder and the new-issue page (mcp/diagnostics.mjs); this page
    // says where the file went, and offers a link if the browser could not start.
    const REPORT_ISSUE_URL='https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new';
    // A modal <dialog>: the browser keeps it above the page, traps focus and
    // closes it on Esc.
    function ReportDialog({t,dialog,onClose}){
      const ref=React.useRef(null),ok=React.useRef(null),close=React.useRef(onClose);close.current=onClose;
      React.useEffect(()=>{
        const node=ref.current;if(!node)return;
        const closed=()=>close.current();
        node.addEventListener('close',closed);
        try{if(!node.open)node.showModal();}catch{node.setAttribute('open','');}
        ok.current?.focus({preventScroll:true});
        return ()=>node.removeEventListener('close',closed);
      },[]);
      const dismiss=()=>{const node=ref.current;if(node&&typeof node.close==='function'&&node.open)node.close();else close.current();};
      const description=[dialog.fileName&&'wcu-report-dialog-file',dialog.filePath&&'wcu-report-dialog-path',dialog.detail&&'wcu-report-dialog-detail'].filter(Boolean).join(' ');
      const [beforeLink,afterLink]=String(dialog.detail??'').split('{issueLink}');
      return h('dialog',{ref,className:'wcu-dialog','data-wincu-report-dialog':dialog.tone,'aria-labelledby':'wcu-report-dialog-text','aria-describedby':description||undefined},
        h('p',{id:'wcu-report-dialog-text'},dialog.text),
        dialog.fileName?h('p',{id:'wcu-report-dialog-file',className:'wcu-dialog-file','data-wincu-report-file':true},dialog.fileName):null,
        dialog.filePath?h('code',{id:'wcu-report-dialog-path',className:'wcu-dialog-path','data-wincu-report-path':true},dialog.filePath):null,
        dialog.detail?h('p',{id:'wcu-report-dialog-detail',className:'wcu-dialog-detail'},beforeLink,
          afterLink!==undefined?h('a',{href:REPORT_ISSUE_URL,target:'_blank',rel:'noopener noreferrer'},t('reportIssuePage')):null,afterLink):null,
        dialog.link?h('a',{href:REPORT_ISSUE_URL,target:'_blank',rel:'noopener noreferrer'},t('reportOpenIssue')):null,
        h('div',{className:'wcu-dialog-actions'},h('button',{ref:ok,type:'button',className:'wcu-small wcu-primary',onClick:dismiss},t('reportOk'))));
    }
    // After an update the user started: the new version, and the one step that
    // finishes it. A restart first says that it stops the task in progress, then
    // runs with one click where DSH allows it; elsewhere the dialog says how to
    // restart by hand.
    function dismissUpdateConfirmation(){
      const receipt=updateReceipt();
      if(receipt)updateReceipt({...receipt,dismissed:true});
      updateStore.set({dialog:false});
    }
    function refreshAfterUpdate(){
      dismissUpdateConfirmation();
      try{window.location.reload();}catch{}
    }
    function UpdateDialog({t,state}){
      const ref=React.useRef(null),safeButton=React.useRef(null);
      React.useEffect(()=>{
        const node=ref.current;if(!node)return;
        node.addEventListener('close',dismissUpdateConfirmation);
        try{if(!node.open)node.showModal();}catch{node.setAttribute('open','');}
        safeButton.current?.focus({preventScroll:true});
        return ()=>node.removeEventListener('close',dismissUpdateConfirmation);
      },[]);
      const dismiss=()=>{const node=ref.current;if(node&&typeof node.close==='function'&&node.open)node.close();else dismissUpdateConfirmation();};
      const button=(text,props)=>h('button',{type:'button',className:'wcu-small',...props},text);
      const probing=state.restartRequired&&state.restartVia===undefined;
      const oneClick=state.restartRequired&&state.restartVia&&!state.restartFailed;
      const kind=probing?'checking':oneClick?(state.restarting?'restarting':'restart'):state.restartRequired?(state.restartFailed?'failed':'manual'):state.refreshRequired?'refresh':'done';
      const body=oneClick?t(state.restarting?'updateRestarting':'updateDialogRestart')
        :state.restartRequired?(state.restartFailed?t('updateRestartFailed')+' ':'')+t(state.runtime==='web'?'updateRestartWeb':'updateRestartDesktop')
        :t(state.refreshRequired?'updateDialogRefresh':'updateDialogReady');
      const later=()=>button(t('updateLater'),{key:'later',ref:safeButton,disabled:state.restarting,onClick:dismiss});
      const actions=probing?[later()]:oneClick?[later(),
          button(t(state.restarting?'updateRestartingShort':'updateRestartNow'),{key:'now',className:'wcu-small wcu-primary','data-wincu-update-restart-now':true,disabled:state.restarting,onClick:()=>{void restartNow();}})]
        :kind==='refresh'?[later(),button(t('updateRefresh'),{key:'refresh',className:'wcu-small wcu-primary',onClick:refreshAfterUpdate})]
        :[button(t('reportOk'),{key:'ok',ref:safeButton,className:'wcu-small wcu-primary',onClick:dismiss})];
      return h('dialog',{ref,className:'wcu-dialog',role:'dialog','aria-modal':true,'data-wincu-update-dialog':kind,'aria-labelledby':'wcu-update-dialog-title','aria-describedby':'wcu-update-dialog-body',
        onKeyDown:event=>{if(event.key==='Tab')event.stopPropagation();if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!state.restarting)dismiss();}}},
        h('p',{id:'wcu-update-dialog-title',className:'wcu-dialog-title'},fill(t('updateDoneTitle'),{version:state.installed})),
        h('p',{id:'wcu-update-dialog-body',className:'wcu-dialog-body',role:kind==='restarting'||kind==='failed'?'status':undefined},body),
        h('div',{className:'wcu-dialog-actions'},...actions));
    }
    function ReportButton({t}){
      const [state,setState]=React.useState({phase:'idle',dialog:null});
      const running=React.useRef(false);
      const run=async()=>{
        if(running.current)return;
        running.current=true;
        setState({phase:'running',dialog:null});
        let dialog={tone:'failed',text:t('reportUnconfirmed'),link:true};
        try{
          const {status,data}=await requestJson('/dsh-computer-use-win/api/diagnostics',{method:'POST',body:{},headers:{'x-wcu-request':'1'},timeoutMs:165000});
          if(status===200&&data?.ok){
            dialog={tone:'saved',text:t('reportSaved'),fileName:data.fileName,filePath:data.filePath,
              detail:t(data.issueOpened===true?'reportIssueOpened':'reportAttachFile')};
          }else if(status===200&&data?.cancelled){
            dialog={tone:'failed',text:t('reportCancelled'),detail:t('reportDescribeIssue')};
          }else if(status===409){
            dialog={tone:'busy',text:t('reportBusy')};
          }else if(status===500&&data?.ok===false){
            dialog={tone:'failed',text:t('reportFailed'),detail:t('reportDescribeIssue')};
          }
        }catch{}
        running.current=false;
        setState({phase:'idle',dialog});
      };
      const button=state.phase==='running'
        ?h('span',{className:'wcu-update','data-wincu-report':'running',role:'status'},h('span',{className:'wcu-spinner','aria-hidden':true}),h('span',null,t('reportRunning')))
        :h('button',{type:'button',className:'wcu-small','data-wincu-report':'idle',title:t('reportTitle'),onClick:run},t('report'));
      return h(React.Fragment,null,button,state.dialog?h(ReportDialog,{t,dialog:state.dialog,onClose:()=>setState(current=>({...current,dialog:null}))}):null);
    }
    // While an update runs: the step it is on, a bar (bytes while the package
    // downloads, moving otherwise), and Stop update until the market starts
    // replacing the plugin's files.
    function UpdateProgress({t,state}){
      const stage=state.waiting==='sync'?'sync':state.waiting==='busy'?'busy':state.stage||'prepare';
      const text=t({sync:'updateSyncing',busy:'updateBusyWaiting',check:'updateStageCheck',prepare:'updateStagePrepare',resolve:'updateStageResolve',download:'updateStageDownload',install:'updateStageInstall'}[stage]||'updateRunning');
      const bytes=stage==='download'?state.bytes:null;
      return h('div',{className:'wcu-update-note wcu-update-progress','data-wincu-update-note':stage==='sync'?'syncing':stage==='busy'?'busy':'progress','data-wincu-update-stage':stage},
        h('div',{className:'wcu-update-progress-row'},
          h('span',{role:'status'},text,bytes?h('span',{className:'wcu-update-bytes','data-wincu-update-bytes':true},' '+formatBytes(bytes.done)+' / '+formatBytes(bytes.total)):null),
          h('button',{type:'button',className:'wcu-small','data-wincu-update-stop':true,disabled:state.stopping||!state.stoppable,title:stage==='install'?t('updateStopInstallTitle'):undefined,onClick:stopUpdate},t(state.stopping?'updateStopping':'updateStop'))),
        h('div',{className:'wcu-progress',role:'progressbar','aria-label':text,...(bytes?{'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':state.percent??0,'data-determinate':true}:{})},
          h('span',{style:bytes?{width:(state.percent??0)+'%'}:undefined})),
        state.stopLate?h('p',{className:'wcu-update-progress-note','data-wincu-update-stop-late':true},t('updateStopLate')):null,
        state.stopUnsupported?h('p',{className:'wcu-update-progress-note','data-wincu-update-stop-unsupported':true},t('updateStopUnsupported')):null);
    }
    // The market's own panel in a dialog, on its Installed tab, searched for
    // this plugin. Closing it checks the version again.
    function MarketDialog({t}){
      const ref=React.useRef(null);
      React.useEffect(()=>{
        const node=ref.current;if(!node)return;
        const closed=()=>{updateStore.set({marketDialog:false});void checkUpdate({fresh:true});};
        node.addEventListener('close',closed);
        try{if(!node.open)node.showModal();}catch{node.setAttribute('open','');}
        return ()=>node.removeEventListener('close',closed);
      },[]);
      const dismiss=()=>{const node=ref.current;if(node&&typeof node.close==='function'&&node.open)node.close();else{updateStore.set({marketDialog:false});void checkUpdate({fresh:true});}};
      let panel=null;
      try{panel=marketService()?.render({preferredSubsectionId:'installed:'+UPDATE_PACKAGE})??null;}catch{}
      return h('dialog',{ref,className:'wcu-dialog wcu-market-dialog','data-wincu-market-dialog':true,'aria-label':t('updateMarketTitle')},
        h('div',{className:'wcu-market-head'},h('strong',null,t('updateMarketTitle')),h('button',{type:'button',className:'wcu-small','data-wincu-market-close':true,onClick:dismiss},t('updateClose'))),
        h('div',{className:'wcu-market-body'},panel));
    }
    // The one line below the title: the progress of an update, a step it needs
    // from the user (a restart the market does not run), or why it did not finish.
    function UpdateNote({t}){
      const state=React.useSyncExternalStore(listener=>updateStore.subscribe(listener),()=>updateStore.state);
      const dialog=state.marketDialog?h(MarketDialog,{t}):null;
      const note=(()=>{
        if(state.phase==='updating')return h(UpdateProgress,{t,state});
        if(state.phase==='available'&&state.notice?.kind==='stopped')return h('p',{className:'wcu-update-note','data-wincu-update-note':'stopped',role:'status'},fill(t('updateStopped'),{version:state.notice.version??PLUGIN_VERSION}));
        if(state.phase==='updated'&&state.restartRequired&&state.restartVia===null)return h('p',{className:'wcu-update-note','data-wincu-update-note':'restart'},t(state.runtime==='web'?'updateRestartWeb':'updateRestartDesktop'));
        // One plain sentence; the market's own message is in the tooltip. When
        // this button could not update, the market's Installed tab is offered
        // too; it lists a release some time after npm does.
        if(state.phase==='failed'&&!['OPERATION_BUSY','UPDATE_STATUS_UNKNOWN'].includes(state.failure?.code)){
          const code=state.failure.code;
          const hint={AGENTS_RUNNING:'updateAgentsRunning',RESOLVED_VERSION_MISMATCH:'updateMismatch',MARKET_NOT_SYNCED:'updateMarketWaiting',NPM_CHECK_FAILED:'updateNpmUnavailable',UPDATE_LOCKED:'updateLocked',PLUGIN_REMOVED:'updatePluginRemoved'}[code]||'updateFailedHint';
          const fallback=!['AGENTS_RUNNING','UPDATE_LOCKED','PLUGIN_REMOVED'].includes(code);
          return h('div',{className:'wcu-update-note','data-tone':'error','data-wincu-update-note':'failed','data-wincu-update-failure':code,title:state.failure.message||undefined},
            h('p',null,t(hint)+' ',h('a',{href:t('updateHelpUrl'),target:'_blank',rel:'noopener noreferrer'},t('updateHow'))),
            fallback?h('p',{'data-wincu-update-fallback':true},fill(t('updateMarketFallback'),{version:state.latest??''})+' ',
              h('button',{type:'button',className:'wcu-link-button','data-wincu-open-market':true,onClick:()=>{if(!openMarketInstalled())updateStore.set({marketMissing:true});}},t('updateOpenMarket')),
              state.marketMissing?h('span',{'data-wincu-market-missing':true},' '+t('updateMarketManual')):null):null);
        }
        return null;
      })();
      return dialog?h(React.Fragment,null,note,dialog):note;
    }

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
      saved.desktopTarget = LEGACY_DESKTOP_TARGETS[saved.desktopTarget] ?? saved.desktopTarget;
      if(!state.value?.toolPreset||saved.toolPreset==='auto')saved.toolPreset=saved.enabledTools.length===allToolNames.length?'full':'custom';
      const [draft,setDraft] = React.useState(saved), [dirty,setDirty] = React.useState(false);
      const [saving,setSaving] = React.useState(false), [message,setMessage] = React.useState(''),[tone,setTone]=React.useState('');
      const [recording,setRecording] = React.useState(false), [recordMessage,setRecordMessage] = React.useState('');
      const [noteView,setNoteView] = React.useState(null), [noteSaving,setNoteSaving] = React.useState(false);
      const [hypervConfiguring,setHypervConfiguring] = React.useState(false), [hypervMessage,setHypervMessage] = React.useState('');
      const savedKey = JSON.stringify(Object.fromEntries(Object.keys(defaults).map(key=>[key,saved[key]])));
      const visibleBeforeFirefox=React.useRef(null),attachBeforeFirefox=React.useRef(null),prevSaved=React.useRef(saved);
      const liveOverlayKeys=['progressOverlayWidth','progressOverlayHeight','progressOverlayPosition','progressOverlayX','progressOverlayY','progressOverlayLocked','progressOverlayEnabled'];
      React.useEffect(()=>{
        const prev=prevSaved.current;prevSaved.current=saved;
        if(!dirty){setDraft(saved);visibleBeforeFirefox.current=null;attachBeforeFirefox.current=null;return;}
        const synced={};
        for(const key of Object.keys(defaults))if(!equal(saved[key],prev[key])&&!equal(draft[key],saved[key])&&(liveOverlayKeys.includes(key)||equal(draft[key],prev[key])))synced[key]=saved[key];
        if(Object.keys(synced).length){const next={...draft,...synced};setDraft(next);setDirty(Object.keys(defaults).some(key=>!equal(next[key],saved[key])));}
      },[savedKey,dirty]);
      // The Firefox that DSH starts has no window yet, so choosing Firefox turns
      // the switches off, and choosing another browser turns them back.
      const change = (field,value) => {const next={...draft,[field]:value};
        if(field==='desktopTarget'&&value==='hyperv')next.browserAttachUser=false;
        if(field==='desktopTarget'||field==='hypervVm')setHypervMessage('');
        // Choosing Custom starts with every tool checked: the user unchecks what
        // to leave out and saves. A Custom selection already saved stays as saved.
        if(field==='toolPreset'&&value==='custom'&&draft.toolPreset!=='custom')next.enabledTools=saved.toolPreset==='custom'?saved.enabledTools:[...allToolNames];
        if(field==='browserApp'&&value==='firefox'&&draft.browserApp!=='firefox'){visibleBeforeFirefox.current=draft.browserVisible;attachBeforeFirefox.current=draft.browserAttachUser;next.browserVisible=false;next.browserAttachUser=false;}
        else if(field==='browserApp'&&draft.browserApp==='firefox'&&value!=='firefox'){if(visibleBeforeFirefox.current!==null){next.browserVisible=visibleBeforeFirefox.current;visibleBeforeFirefox.current=null;}if(attachBeforeFirefox.current!==null){next.browserAttachUser=attachBeforeFirefox.current;attachBeforeFirefox.current=null;}}
        setDraft(next);setDirty(Object.keys(defaults).some(key=>!equal(next[key],saved[key])));setMessage('');};
      const selectTools=(names,enabled)=>{const selected=new Set(draft.enabledTools);for(const name of names)enabled?selected.add(name):selected.delete(name);change('enabledTools',allToolNames.filter(name=>selected.has(name)));};
      React.useEffect(()=>{
        if(!recording)return;
        if(!writable||saving){setRecording(false);return;}
        const native=window.dshDesktop?.shortcuts;
        let disposed=false,timer;
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
        const start=()=>{
          if(disposed)return;
          timer=setTimeout(()=>{setRecording(false);setRecordMessage('recordTimedOut');},15000);
          window.addEventListener('keydown',keydown,true);
        };
        window.addEventListener('blur',cancel);
        // Desktop intercepts reserved keys before DOM delivery, including Esc.
        // Use the same native recording lease as the host's shortcut editor.
        if(native?.recording)native.recording(true).then(start,()=>{if(!disposed){setRecording(false);setRecordMessage('recordUnavailable');}});
        else start();
        return ()=>{disposed=true;clearTimeout(timer);window.removeEventListener('keydown',keydown,true);window.removeEventListener('blur',cancel);if(native?.recording)native.recording(false).catch(console.error);};
      },[recording,writable,saving,savedKey]);
      const run = async (patch,success) => {
        setSaving(true);setMessage('');
        try {await savePatch(patch);setMessage(t(success));setTone('success');return true;}
        catch(error){setMessage(t('failed')+': '+String(error.message||error));setTone('error');return false;}
        finally{setSaving(false);}
      };
      // Persist section-scoped actions without committing unrelated draft fields.
      const overlayKeys=Object.keys(defaults).filter(key=>key.startsWith('progress'));
      const indicatorKeys=['indicatorEnabled','cursorIndicatorEnabled','indicatorPosition','indicatorIdleMs','indicatorText','remoteIndicatorVisible'];
      const validInt=(value,rule)=>Number.isInteger(value)&&value>=rule.min&&value<=rule.max;
      const validIndicator=d=>Boolean(d.indicatorText.trim())&&d.indicatorText.length<=settingRules.indicatorText.maxLength&&!/[\r\n\x00-\x1f]/.test(d.indicatorText)&&validInt(d.indicatorIdleMs,settingRules.indicatorIdleMs);
      const validOverlay=(d,lockKey)=>['progressOverlayOpacity','progressOverlayWidth','progressOverlayHeight','progressOverlayX','progressOverlayY'].every(k=>validInt(d[k],settingRules[k]))&&isValidShortcut(lockKey);
      const applySectionPatch=async(patch,success='saved')=>{
        const next={...draft,...patch};setDraft(next);
        if(await run(patch,success)){
          const base={...saved,...patch};setDirty(Object.keys(defaults).some(key=>!equal(next[key],base[key])));
        }else setDirty(true);
      };
      const applyOverlaySwitch=(field,value)=>applySectionPatch({[field]:value});
      const openProgress=()=>{
        const lockKey=formatShortcutInput(draft.progressLockShortcut);
        if(!validOverlay(draft,lockKey)){setMessage(t('invalidOverlay'));setTone('error');return;}
        if(lockKey&&lockKey===(draft.stopShortcut||saved.stopShortcut)){setMessage(t('shortcutConflict'));setTone('error');return;}
        return applySectionPatch({...Object.fromEntries(overlayKeys.map(key=>[key,draft[key]])),progressLockShortcut:lockKey,progressOverlayEnabled:true,progressPreviewToken:Date.now()});
      };
      const previewIndicator=()=>{
        if(!validIndicator(draft)){setMessage(t('invalid'));setTone('error');return;}
        return applySectionPatch({...Object.fromEntries(indicatorKeys.map(key=>[key,draft[key]])),previewToken:Date.now()},'previewed');
      };
      const save = async () => {
        const lockKey=formatShortcutInput(draft.progressLockShortcut);
        const normalized=lockKey===draft.progressLockShortcut?draft:{...draft,progressLockShortcut:lockKey};
        if(normalized!==draft)setDraft(normalized);
        if(!validIndicator(normalized)){setMessage(t('invalid'));setTone('error');return;}
        if(!validOverlay(normalized,lockKey)){setMessage(t('invalidOverlay'));setTone('error');return;}
        if(lockKey&&lockKey===normalized.stopShortcut){setMessage(t('shortcutConflict'));setTone('error');return;}
        if(normalized.desktopTarget==='hyperv'&&(!normalized.hypervVm.trim()||normalized.hypervVm.trim().startsWith('-'))){setMessage(t('hypervVmRequired'));setTone('error');return;}
        const patch=Object.fromEntries(Object.keys(defaults).filter(key=>!equal(normalized[key],saved[key])).map(key=>[key,normalized[key]]));
        if(Object.keys(patch).length===0){setDirty(false);setMessage(t('saved'));setTone('success');return;}
        if(await run(patch,'saved'))setDirty(false);
      };
      // The result says which setup step to look at; Windows' own words stay
      // in the tooltip.
      const configureHyperv = async () => {
        setHypervConfiguring(true);setHypervMessage('');
        try {
          const {status,data}=await requestJson('/dsh-computer-use-win/api/hyperv',{method:'POST',body:{},headers:{'x-wcu-request':'1'},timeoutMs:165000});
          const detail=String(data?.error||''),issue=HYPERV_ISSUES[data?.ok?data.missing:detail.match(/^WCU_HYPERV_[A-Z_]+/)?.[0]];
          setHypervMessage(data?.cancelled?{text:t('reportCancelledConnection')}
            :data?.ok?(issue?{text:t(issue[0]),tone:'warning',step:issue[1]}:{text:t('hypervReady'),tone:'success'})
            :issue?{text:t(issue[0]),tone:'error',step:issue[1],detail}
            :{text:t('hypervFailed')+(detail?' '+detail:status===409?' '+t('hypervBusy'):''),tone:'error'});
        } catch {setHypervMessage({text:t('hypervFailed'),tone:'error'});}
        finally {setHypervConfiguring(false);}
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
      const dirtyStatus=[t('dirty'),['browserVisible','browserApp','browserSignIn','browserAttachUser'].some(key=>draft[key]!==saved[key])?t('browserChange'):'',['toolPreset','enabledTools','mode'].some(key=>!equal(draft[key],saved[key]))?t('toolsChange'):''].filter(Boolean).join(' ');
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
      const toggle=(field,label,locked,checked=draft[field])=>h('input',{id:idPrefix+'-'+field,type:'checkbox',role:'switch','aria-label':t(label),checked,disabled:disabled||locked,onChange:e=>['progressOverlayEnabled','progressOverlayLocked'].includes(field)?applyOverlaySwitch(field,e.target.checked):change(field,e.target.checked)});
      const switchItem=(field,label,hint,art,locked,checked)=>item(h('label',{className:'wcu-art',htmlFor:idPrefix+'-'+field,'aria-hidden':true},art),title(t(label),hint,{htmlFor:idPrefix+'-'+field}),toggle(field,label,locked,checked));
      const field=(label,control)=>h('div',{className:'wcu-field'},label,control);
      const numProps=key=>({value:draft[key],onChange:e=>change(key,e.target.value===''?'':Number(e.target.value)),onBlur:()=>{if(draft[key]===''||Number.isNaN(draft[key]))change(key,saved[key]);}});
      const allowedTools=['full','lazy'].includes(draft.toolPreset)?allToolNames:activeTools;
      const keycap=(key,label)=>h('kbd',{className:'wcu-key',key},label);
      const shortcutKeys=recording?[h('span',{key:'listen'},t('listening')),h('small',{key:'cancel'},t('listeningCancel'))]
        :draft.stopShortcut?draft.stopShortcut.split('+').flatMap((key,i)=>i?[h('span',{className:'wcu-plus',key:'+'+i},' + '),keycap(i,key)]:[keycap(i,key)])
        :[keycap('esc','Esc'),h('small',{key:'default'},t('noShortcut').slice(3))];
      const noteToggle=h('button',{type:'button',className:'wcu-fold','data-wincu-note-toggle':true,'aria-expanded':!noteCompact,title:t(noteCompact?'fullNoteTitle':'compactNoteTitle'),'aria-label':t(noteCompact?'fullNote':'compactNote'),disabled:noteSaving||saving||!writable,onClick:toggleNote},!noteCompact&&h('span',null,t('compactNote')),h('svg',{viewBox:'0 0 16 16','aria-hidden':true,focusable:false},h('path',{d:'M4 10l4-4 4 4'})));
      return h(as,{'data-wincu-settings':'true'},h('style',null,css),
        h('header',{className:'wcu-header'},
          !noteCompact&&h('aside',{className:'wcu-community','data-wincu-community':'true'},h('p',null,t('starPrefix'),
            communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win','starLink','star','starTitle'),t('starAfter'),t('issueBefore'),
            communityLink('https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new','issueLink','issue','issueTitle'),t('issueAfter'),noteToggle)),
          h('div',{className:'wcu-title-row'},h('h2',null,t('title')),h('span',{className:'wcu-version','data-wincu-version':true},'v'+PLUGIN_VERSION),
            h('div',{className:'wcu-title-end'},h(UpdateInline,{t}),h(ReportButton,{t}),noteCompact&&h('div',{className:'wcu-header-actions','data-compact':true},h('a',{href:'https://github.com/Yu-tao-Li/dsh-computer-use-win',target:'_blank',rel:'noopener noreferrer',className:'wcu-project-icon',title:t('projectTitle'),'aria-label':t('projectTitle')},linkIcon('github'),h('span',null,'GitHub')),noteToggle))),
          h(UpdateNote,{t}),
          h('p',null,t('intro'))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-tools-title'},
          head(idPrefix+'-tools-title','toolsTitle','toolsInfo',h('span',{className:'wcu-tool-count','data-wincu-tool-count':true},draft.toolPreset==='lazy'?t('lazyCount')+' '+allToolNames.length:t('toolsSelected')+' '+activeTools.length+' / '+allToolNames.length)),
          item(picture(arts.tools(new Set(activeTools),new Set(allowedTools))),
            h('div',{className:'wcu-segment wcu-presets',role:'radiogroup','aria-label':t('toolsTitle')},...['full','lite','lazy','custom'].map(preset=>h('label',{key:preset},h('input',{type:'radio',name:idPrefix+'-toolPreset',id:idPrefix+'-toolPreset-'+preset,value:preset,checked:draft.toolPreset===preset,disabled,onChange:()=>change('toolPreset',preset)}),t(preset)))),
            h('p',{className:'wcu-hint','data-wincu-preset-hint':true},t(draft.toolPreset+'Summary'))),
          h('details',{className:'wcu-tool-detail','data-wincu-tools':true,hidden:draft.toolPreset!=='custom',open:draft.toolPreset==='custom'},h('summary',null,t('customTools')),
            h('div',{className:'wcu-tool-body'},h('div',{className:'wcu-tool-toolbar'},button('allTools',{className:'wcu-small',disabled:customDisabled||draft.enabledTools.length===allToolNames.length,onClick:()=>change('enabledTools',[...allToolNames])}),button('noTools',{className:'wcu-small',disabled:customDisabled||!draft.enabledTools.length,onClick:()=>change('enabledTools',[])})),
              ...toolGroups.map(([group,entries])=>{const names=entries.map(entry=>entry[0]),count=names.filter(name=>draft.enabledTools.includes(name)).length;return h('fieldset',{className:'wcu-tool-group',disabled:customDisabled,key:group},
                h('legend',null,h('label',{className:'wcu-tool-group-label'},h('input',{type:'checkbox',id:idPrefix+'-tool-group-'+group,checked:count===names.length,'aria-checked':count&&count<names.length?'mixed':count===names.length,ref:input=>{if(input)input.indeterminate=count>0&&count<names.length;},onChange:e=>selectTools(names,e.target.checked)}),t('toolGroup_'+group),h('span',{className:'wcu-tool-count'},count+' / '+names.length))),
                h('div',{className:'wcu-tool-grid'},...entries.map(([name])=>h('label',{className:'wcu-tool-item',key:name,title:'windows_computer_use_'+name},h('input',{type:'checkbox',id:idPrefix+'-tool-'+name,'data-wincu-tool':name,checked:draft.enabledTools.includes(name),disabled:customDisabled,onChange:e=>selectTools([name],e.target.checked)}),h('span',null,h('strong',null,t('tool_'+name)),h('small',null,t('toolHint_'+name)))))));})))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-desktop-title'},
          head(idPrefix+'-desktop-title','workMode',null),
          // Each mode says in one line when it fits. Low disruption's notes
          // fold under More details; the virtual machine keeps its setup steps
          // in view.
          item(picture(arts.desktop(draft.desktopTarget)),
            h('div',{className:'wcu-segment wcu-presets wcu-desktops',role:'radiogroup','aria-labelledby':idPrefix+'-desktop-title'},...DESKTOP_OPTIONS.map(([value,label])=>h('label',{key:value},
              h('input',{type:'radio',name:idPrefix+'-desktopTarget',id:idPrefix+'-desktopTarget-'+value,value,checked:draft.desktopTarget===value,disabled,onChange:()=>change('desktopTarget',value)}),t(label)))),
            h('p',{className:'wcu-hint','data-wincu-desktop-hint':true},t((DESKTOP_OPTIONS.find(([value])=>value===draft.desktopTarget)??DESKTOP_OPTIONS[0])[2]))),
          draft.desktopTarget==='quiet'&&h('details',{className:'wcu-detail','data-wincu-quiet-notes':true},h('summary',null,t('moreNotes')),
            h('div',{className:'wcu-notice'},h('ul',null,...[1,2,3,4].map(n=>h('li',{key:n},t('modeQuietNote'+n)))))),
          draft.desktopTarget==='hyperv'&&h('div',{className:'wcu-notice','data-wincu-hyperv-steps':true},
            h('strong',null,t('hypervSetup')),
            h('ol',null,...[1,2,3,4,5,6].map(n=>h('li',{key:n,'data-tone':hypervMessage&&hypervMessage.step===n?hypervMessage.tone:undefined},t('hypervStep'+n),
              n===2&&h('span',{className:'wcu-address'},h('code',null,HYPERV_GROUP_COMMAND),h(CopyButton,{text:HYPERV_GROUP_COMMAND,t})),
              n===5&&h('input',{className:'wcu-control',id:idPrefix+'-hypervVm','aria-label':t('hypervVm'),placeholder:t('hypervVm'),type:'text',maxLength:120,value:draft.hypervVm,disabled,onChange:e=>change('hypervVm',e.target.value)}),
              n===6&&h('div',{className:'wcu-hyperv-action'},
                button(hypervConfiguring?'hypervConfiguring':'hypervConfigure',{className:'wcu-small',disabled:disabled||hypervConfiguring||saved.desktopTarget!=='hyperv'||!saved.hypervVm||draft.hypervVm.trim()!==saved.hypervVm,onClick:configureHyperv}),
                hypervMessage&&h('span',{role:'status','data-wincu-hyperv-result':hypervMessage.tone||'info','data-tone':hypervMessage.tone,title:hypervMessage.detail||undefined},hypervMessage.text))))))),
        h('section',{className:'wcu-section','data-wincu-browser-policy':true,'aria-labelledby':idPrefix+'-browser-title'},
          head(idPrefix+'-browser-title','browserTitle','browserInfo'),
          h('div',{className:'wcu-grid'},
            switchItem('browserFirst','browserFirst','browserFirstHint',arts.browserFirst(draft.browserFirst)),
            switchItem('browserVisible','browserVisible','browserVisibleHint',arts.browserVisible(draft.browserVisible),draft.browserApp==='firefox',draft.browserVisible),
            item(h('label',{className:'wcu-art',htmlFor:idPrefix+'-browserApp','aria-hidden':true},arts.app(draft.browserApp==='default'?t('browserAppShort'):draft.browserApp==='firefox'?'Firefox':t('browserApp_'+draft.browserApp))),
              title(t('browserApp'),'browserAppHint',{htmlFor:idPrefix+'-browserApp'}),
              h('select',{className:'wcu-control',id:idPrefix+'-browserApp',value:draft.browserApp,disabled,onChange:e=>change('browserApp',e.target.value)},
                ...['default','edge','chrome','firefox'].map(app=>h('option',{key:app,value:app},t('browserApp_'+app))))),
            switchItem('browserSignIn','browserSignIn','browserSignInHint',arts.signIn(draft.browserSignIn),false,draft.browserSignIn),
            switchItem('browserAttachUser','browserAttachUser','browserAttachUserHint',arts.app(t('myBrowser')),draft.browserApp==='firefox'||draft.desktopTarget==='hyperv')),
          draft.browserAttachUser&&draft.browserApp!=='firefox'&&h('div',{className:'wcu-notice','data-wincu-attach-notice':true},
            h('strong',null,t('attachSetup')),h('ol',null,h('li',null,t('attachStep1'),...['chrome://inspect/#remote-debugging','edge://inspect/#remote-debugging'].map(url=>h('span',{className:'wcu-address',key:url},h('code',null,url),h(CopyButton,{text:url,t})))),h('li',null,t('attachStep2'))),
            h('strong',null,t('attachRisks')),h('ul',null,h('li',null,t('attachRisk1')),h('li',null,t('attachRisk2')))),
          // Kept sign-ins need nothing set up, but how to sign in, where the
          // sign-ins stay and the risks remain in view while the switch is on.
          draft.browserApp==='firefox'&&h('p',{className:'wcu-notice','data-wincu-firefox-notice':true},t('firefoxNotice'),' ',h('a',{href:'https://github.com/Yu-tao-Li/dsh-computer-use-win/blob/main/docs/browser-bidi.md',target:'_blank',rel:'noopener noreferrer'},t('learnMore'))),
          draft.browserSignIn&&draft.browserApp!=='firefox'&&h('div',{className:'wcu-notice','data-wincu-signin-notice':true},
            h('strong',null,t('signInSetup')),
            h('ol',null,h('li',null,t('signInStep1')),h('li',null,t('signInStep2')),
              !draft.browserVisible&&h('li',{'data-wincu-signin-hidden':true},t('signInStepHidden')),
              draft.browserApp!=='chrome'&&h('li',{'data-wincu-signin-edge':true},t('signInStepEdge')),
              h('li',null,t('signInStep3'),h('span',{className:'wcu-address'},h('code',null,KEPT_FOLDER),h(CopyButton,{text:KEPT_FOLDER,t})))),
            h('strong',null,t('signInRisks')),
            h('ul',null,...[1,2,3].map(n=>h('li',{key:n},t('signInRisk'+n)))))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-indicator-title'},
          head(idPrefix+'-indicator-title','indicatorTitle','indicatorInfo',button('preview',{className:'wcu-small',disabled:disabled||(!draft.indicatorEnabled&&!draft.cursorIndicatorEnabled),onClick:previewIndicator,title:t('previewTitle')})),
          h('div',{className:'wcu-grid'},
            switchItem('indicatorEnabled','indicator','indicatorHint',arts.indicator(draft.indicatorEnabled,draft.indicatorPosition==='bottom')),
            switchItem('cursorIndicatorEnabled','cursorIndicator','cursorIndicatorHint',arts.cursor(draft.cursorIndicatorEnabled,idPrefix+'-spot'))),
          h('details',{className:'wcu-detail'},h('summary',null,t('appearance')),
            h('div',{className:'wcu-fields'},
              field(title(t('position'),null,{id:idPrefix+'-position-label'}),h('div',{className:'wcu-segment',role:'radiogroup','aria-labelledby':idPrefix+'-position-label'},radio('indicatorPosition','top',t('top')),radio('indicatorPosition','bottom',t('bottom')))),
              field(title(t('delay'),'delayHint',{htmlFor:idPrefix+'-delay'}),h('div',{className:'wcu-number'},h('input',{className:'wcu-control',id:idPrefix+'-delay',type:'number',min:settingRules.indicatorIdleMs.min,max:settingRules.indicatorIdleMs.max,step:100,disabled:indicatorDisabled,...numProps('indicatorIdleMs')}),h('span',null,t('ms')))),
              field(title(t('text'),null,{htmlFor:idPrefix+'-text'}),h('input',{className:'wcu-control wcu-text',id:idPrefix+'-text',type:'text',maxLength:settingRules.indicatorText.maxLength,value:isDefaultIndicatorText(draft.indicatorText)&&draft.indicatorText.trim()?t('indicatorDefault'):draft.indicatorText,disabled:indicatorDisabled,onChange:e=>change('indicatorText',e.target.value)})),
              field(title(t('remoteVisible'),'remoteVisibleHint',{htmlFor:idPrefix+'-remoteIndicatorVisible'}),toggle('remoteIndicatorVisible','remoteVisible'))))),
        h('section',{className:'wcu-section','data-wincu-progress-settings':true,'aria-labelledby':idPrefix+'-progress-title'},
          head(idPrefix+'-progress-title','progressSettings','progressInfo',h('span',{className:'wcu-caption'},t('instantSave')),button('openProgress',{'data-wincu-open-progress':true,title:t('progressSync'),className:'wcu-small',disabled,onClick:openProgress})),
          h('div',{className:'wcu-grid'},switchItem('progressOverlayEnabled','progressOverlay','progressOverlayHint',arts.progress(draft.progressOverlayEnabled)),switchItem('progressOverlayLocked','progressLocked','progressLockedHint',arts.lock(draft.progressOverlayLocked))),
          h('details',{className:'wcu-detail','data-wincu-progress-details':true},h('summary',null,t('appearance')),
          h('p',{className:'wcu-hint'},t('progressSync')),
          h('div',{className:'wcu-fields'},
            field(title(t('progressMode'),'progressModeHint',{htmlFor:idPrefix+'-progressOverlayMode'}),h('select',{className:'wcu-control',id:idPrefix+'-progressOverlayMode',value:draft.progressOverlayMode,disabled,onChange:e=>change('progressOverlayMode',e.target.value)},h('option',{value:'source'},t('progressModeSource')),h('option',{value:'summary'},t('progressModeSummary')))),
            ...[['progressOverlayOpacity','progressOpacity'],['progressOverlayWidth','progressWidth'],['progressOverlayHeight','progressHeight']].map(([key,label])=>field(title(t(label),null,{htmlFor:idPrefix+'-'+key}),h('input',{className:'wcu-control',id:idPrefix+'-'+key,type:'number',min:settingRules[key].min,max:settingRules[key].max,disabled,...numProps(key)}))),
            field(title(t('progressPosition'),null,{htmlFor:idPrefix+'-progressOverlayPosition'}),h('select',{className:'wcu-control',id:idPrefix+'-progressOverlayPosition',value:draft.progressOverlayPosition,disabled,onChange:e=>change('progressOverlayPosition',e.target.value)},...['top-right','top-left','bottom-right','bottom-left','custom'].map((key,index)=>h('option',{key,value:key},t(['progress_topRight','progress_topLeft','progress_bottomRight','progress_bottomLeft','progress_custom'][index]))))),
            ...[['progressOverlayX','progressX'],['progressOverlayY','progressY']].map(([key,label])=>field(title(t(label),null,{htmlFor:idPrefix+'-'+key}),h('input',{className:'wcu-control',id:idPrefix+'-'+key,type:'number',min:settingRules[key].min,max:settingRules[key].max,disabled:disabled||draft.progressOverlayPosition!=='custom',...numProps(key)}))),
            field(title(t('progressShortcut'),'progressShortcutHint',{htmlFor:idPrefix+'-progressLockShortcut'}),h('input',{className:'wcu-control wcu-text',id:idPrefix+'-progressLockShortcut',value:draft.progressLockShortcut,placeholder:'Ctrl+Alt+P',maxLength:50,disabled,onChange:e=>change('progressLockShortcut',e.target.value),onKeyDown:e=>{if(e.isComposing||e.repeat||['Control','Alt','Shift','Meta','OS','Escape','Tab'].includes(e.key))return;if(e.altKey||e.metaKey||(e.ctrlKey&&e.shiftKey)||/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(e.code||'')){const s=shortcutFromEvent(e);if(s){e.preventDefault();e.stopPropagation();change('progressLockShortcut',s);}}},onBlur:e=>{const s=formatShortcutInput(e.target.value);if(s!==draft.progressLockShortcut)change('progressLockShortcut',s);}}))))),
        h('section',{className:'wcu-section','aria-labelledby':idPrefix+'-stop-title'},
          head(idPrefix+'-stop-title','stop','stopInfo',button('clearShortcut',{title:t('clearShortcutTitle'),className:'wcu-small',disabled:disabled||!draft.stopShortcut,onClick:()=>{change('stopShortcut','');setRecordMessage('');}})),
          h('div',{className:'wcu-grid'},
            item(picture(arts.esc()),title(t('escTitle'),'stopHint'),h('span',{className:'wcu-caption'},t('escAlways'))),
            h('div',{className:'wcu-item','data-wincu-shortcut':'true'},
              h('output',{className:'wcu-art wcu-shortcut-value','data-recording':recording,'data-keys':draft.stopShortcut.split('+').length,'aria-live':'polite','aria-label':t('extraStop')},...shortcutKeys),
              h('div',{className:'wcu-item-main'},title(t('extraStop'),'shortcutHint'),
                button(recording?'cancelRecord':draft.stopShortcut?'rerecord':'record',{className:'wcu-small',disabled:saving||!writable,onClick:()=>{setRecordMessage('');setRecording(!recording);}})))),
          recordMessage&&h('p',{role:'status',className:'wcu-hint'},t(recordMessage))),
        !writable&&h('p',{role:'status','data-tone':'error'},t(available?'unavailable':'notLoaded')),
        h('footer',{className:'wcu-footer'},h('span',{className:'wcu-status',role:'status','aria-live':'polite','data-tone':message?tone:undefined},[message,dirty?dirtyStatus:!message?t('clean'):''].filter(Boolean).join(' · ')),
          h('div',{className:'wcu-actions'},button('discard',{disabled:!dirty||saving||recording,onClick:()=>{setDraft(saved);setDirty(false);setMessage('');setRecordMessage('');}}),button('save',{className:'wcu-primary',disabled:!dirty||disabled,onClick:save}))));
    }
    const actionKeys={snapshot:'see',screenshot:'see',accessibility_tree:'read',list_windows:'windows',find:'findControl',element_info:'read',click:'clickAction',double_click:'doubleClick',move:'movePointer',drag:'dragAction',scroll:'scrollAction',type_text:'typeAction',keypress:'keyAction',focus:'focusAction',invoke:'invokeAction',set_value:'valueAction',activate_window:'windowAction',wait:'waitAction',ocr:'ocrAction',wait_for:'verifyAction',close_window:'closeAction',move_window:'moveWindowAction',launch_app:'launchAction',health:'healthAction',tools:'toolsAction'};


    const shortTool=name=>String(name||'').replace(/^(?:mcp__wincu__)?windows_computer_use_/,'');
    const desktopTool=name=>/^(?:mcp__wincu__)?windows_computer_use_(?!health$|tools$)[a-z_]+$/.test(name||'');
    const objectArgs=value=>{if(typeof value==='string')try{return JSON.parse(value);}catch{return {};}return value&&typeof value==='object'?value:{};};
    // DSH 0.1.7 and later send a tool result as {role:'tool', toolCallId,
    // source:{callId}, content, isError}. DSH 0.1.5 wraps it in one
    // {type:'tool-result', toolCallId, content, isError} block of a user
    // message. Neither has a top-level callId.
    function toolResult(message){
      const block=Array.isArray(message?.content)?message.content.find(part=>part?.type==='tool-result'):undefined;
      const inner=block??message??{};
      return {id:inner.toolCallId??message?.toolCallId??message?.source?.callId??message?.callId,content:Array.isArray(inner.content)?inner.content:[],isError:inner.isError===true};
    }
    function receipt(message){
      for(const part of toolResult(message).content)if(part.type==='text'&&typeof part.text==='string')try{return JSON.parse(part.text);}catch{}
      return {};
    }
    const resultStatus=message=>{const result=toolResult(message);return result.isError?(result.content.some(part=>part.type==='text'&&/COMPUTER_USE_STOPPED_BY_USER/.test(part.text))?'stopped':'failed'):'completed';};
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
      const data=receipt(call.message),images=toolResult(call.message).content.filter(x=>x.type==='image'&&x.attachment);
      return h(React.Fragment,null,
        ['sent','dispatched'].includes(data.verification)&&h('div',{className:'wcu-activity-note'},t('sentOnly')),
        ['failed','stopped'].includes(call.status)&&h('div',{role:'status'},t(call.status==='stopped'?'stoppedAction':'stepError')),
        images.length>0&&renderFactorySlot&&loadImage&&renderFactorySlot('conversation.images.content',{images,loadImage,align:'start'}));
    }
    // DSH 0.2 passes the call's phase and, once it returned, a node holding
    // the result message. DSH 0.1.5 passes the node alone: a finished one has
    // kind, call (with argsRaw), content and isError.
    function MouseToolRow({toolName,phase,block,renderFactorySlot,loadImage,inspect,t}){
      const done=phase?phase==='result':!!block&&typeof block==='object'&&'kind' in block;
      const message=done?block.message??block:undefined;
      const status=done?resultStatus(message):'working';
      const call={name:toolName,args:block?.call?.arguments??block?.call?.argsRaw??block?.arguments??block?.argsRaw,message,status};
      return h('details',{className:'wcu-activity','data-wincu-action':true},h('style',null,activityCss),h('summary',null,mouseIcon(),h('span',{className:'wcu-activity-label'},status==='working'?t('working'):actionText(call,t)),h('span',{className:'wcu-activity-state'},t(status==='failed'?'failedAction':status==='stopped'?'stoppedAction':status))),activityBody(call,renderFactorySlot,loadImage,t),inspect&&h('button',{type:'button',onClick:inspect},t('showDetails')));
    }
    function reduceSeries(state,event){
      const data=event.data||{};
      if(event.type==='tool/call'&&desktopTool(data.name))return {...state,calls:[...state.calls,{id:data.callId,name:data.name,args:data.arguments,seq:event.seq,status:'working'}]};
      if(event.type==='tool/result'){
        const id=toolResult(data.message).id??data.callId;
        return {...state,calls:state.calls.map(call=>id!==undefined&&call.id===id?{...call,message:data.message,status:resultStatus(data.message)}:call)};
      }
      if(event.type==='turn/end')return {...state,ended:true,reason:data.reason?.kind||'completed'};
      return state;
    }
    // One Context per turn, started only by turn/start, as DSH's own turn-tail
    // Definition does. DSH 0.1.5 throws on a second start Match for a Context,
    // and the throw left every conversation's history paging stuck (#76).
    const seriesEvents=['turn/start','turn/end','tool/call','tool/result'];
    const seriesDefinition={
      kind:'wincu-series',target:'chat',
      match:event=>seriesEvents.includes(event.type)&&Number.isInteger(event.data?.turn)?{id:String(event.data.turn),role:event.type==='turn/start'?'start':'update'}:null,
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
      // The nav button carries the icon only: an update is offered on the page.
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
      pageCtx=ctx;ctx.effect(()=>()=>{if(pageCtx===ctx)pageCtx=null;});
      ctx.effect(()=>ctx.locale.register(NS,dictionaries));
      ctx.effect(()=>watchNavIcon([dictionaries.zh.nav,dictionaries.en.nav]));
      // One update check per DSH start, a few seconds in, so it never competes
      // with the start itself. A second apply in the same page does not repeat it.
      ctx.effect(()=>{
        const delay=Number.isFinite(globalThis.__wcuUpdateDelayMs)?globalThis.__wcuUpdateDelayMs:8000;
        // Tests set the delay; they also get a way back to a fresh, unchecked state.
        if(Number.isFinite(globalThis.__wcuUpdateDelayMs))globalThis.__wcuUpdateTest={check:()=>checkUpdate(),state:()=>updateStore.state,reset:({keepReceipt=false}={})=>{clearTimeout(updateRecoveryTimer);if(!keepReceipt)updateReceipt(null);updateMarket=undefined;updateChecking=undefined;updateStore.set({phase:'idle',checking:false,waiting:null,checkedAt:undefined,failure:null,percent:null,installed:undefined,latest:undefined,source:undefined,runtime:null,restartSupported:false,restartVia:undefined,restarting:false,restartFailed:false,dialog:false,restartRequired:false,refreshRequired:false,stage:null,bytes:null,stoppable:false,stopping:false,stopLate:false,stopUnsupported:false,notice:null,marketDialog:false,marketMissing:false});}};
        if(updateStarted||delay<0||typeof setTimeout!=='function'||typeof fetch!=='function')return ()=>{};
        updateStarted=true;
        const timer=setTimeout(()=>{void checkUpdate();},delay);
        return ()=>clearTimeout(timer);
      });
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
      // A keyed slot on DSH 0.1.x: the Plugins tab shows the card registered
      // under the settings namespace it edits (#76). Later hosts never declare it.
      ctx.slots.inject('settings.plugin.item',()=>ctx.slots.register({name:'settings.plugin.item',key:namespace,order:30,locale:NS,inject:()=>({scope,savePatch})},Card));
      };
      ctx.inject(['configForms'],owner=>mount(owner.configForms.get('mcp-dsh-computer-use-win'),owner,'mcp-dsh-computer-use-win'));
      ctx.inject(['settingsScope','connection','remote'],owner=>mount(owner.settingsScope.bind({namespace:'windows-computer-use'}),owner,'windows-computer-use'));
    }
    return {apply,inject:['slots','locale']};
  }
});

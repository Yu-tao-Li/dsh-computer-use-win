#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TakeoverControl, STOPPED } from './takeover.mjs';
import { TOOL_NAMES, normalizeEnabledTools, browserRoutingInstructions } from './settings.mjs';
import { BrowserLane, isBrowserCall, isQuietCall, BACKGROUND_FIRST } from './browser.mjs';

const MCP_PROTOCOL_VERSION = "2024-11-05";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
// Advertised over MCP serverInfo; derived from package.json so the two
// cannot drift apart between releases.
const SERVER_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;
  } catch {
    return "0.2.5";
  }
})();
const backendPath = path.join(pluginRoot, "scripts", "windows-uia.ps1");
const powershell = process.env.WINDOWS_CU_POWERSHELL || "powershell.exe";

const wikiResources = [
  {
    uri: "windows-computer-use://wiki/home",
    name: "Windows Computer Use Wiki Home",
    mimeType: "text/markdown",
    file: path.join(pluginRoot, "docs", "wiki", "Home.md")
  },
  {
    uri: "windows-computer-use://wiki/architecture",
    name: "Architecture",
    mimeType: "text/markdown",
    file: path.join(pluginRoot, "docs", "wiki", "architecture.md")
  },
  {
    uri: "windows-computer-use://wiki/mac-codex-computer-use",
    name: "Mac Codex Computer Use Notes",
    mimeType: "text/markdown",
    file: path.join(pluginRoot, "docs", "wiki", "mac-codex-computer-use.md")
  },
  {
    uri: "windows-computer-use://wiki/app-technology-matrix",
    name: "App Technology Matrix",
    mimeType: "text/markdown",
    file: path.join(pluginRoot, "docs", "wiki", "app-technology-matrix.md")
  },
  {
    uri: "windows-computer-use://wiki/mcp-tools",
    name: "MCP Tools",
    mimeType: "text/markdown",
    file: path.join(pluginRoot, "docs", "wiki", "mcp-tools.md")
  },
  {
    uri: "windows-computer-use://wiki/safety",
    name: "Safety",
    mimeType: "text/markdown",
    file: path.join(pluginRoot, "docs", "wiki", "safety.md")
  }
];

const windowTargetProperties = {
  windowTitle: {
    type: "string",
    description: "Substring of a top-level window title to target instead of the active window."
  },
  processId: {
    type: "integer",
    minimum: 1,
    description: "Process id of a top-level window to target instead of the active window."
  },
  nativeWindowHandle: {
    type: "integer",
    minimum: 1,
    description: "Native HWND of a top-level window to target instead of the active window."
  },
  activate: {
    type: "boolean",
    default: false,
    description: "Bring the target to the foreground and keep it there. Otherwise reads and element actions leave the foreground alone, and real input borrows it: the target comes forward for the action, then the foreground and pointer go back, unless a menu, list or dialog it opened is showing. Without a window target, the active window is the one this operation series last gave input to, else the foreground window. close_window ignores this; activate_window always activates."
  }
};

const treeViewProperties = {
  viewMode: {
    type: "string",
    enum: ["control", "content", "raw"],
    default: "control",
    description: "UI Automation view used for traversal. control is the default compact app-control tree; content returns end-user content nodes; raw returns provider internals for debugging. Applies to scope resolution and tree walking; element ids of the form uia:rt:* are looked up directly by RuntimeId and bypass view filtering (the value is still validated, but not applied)."
  },
  includeOffscreen: {
    type: "boolean",
    default: false,
    description: "Include UIA elements currently reported as offscreen. Leave false for normal app workflows; set true for debugging or resolving ids from an offscreen-inclusive tree. Like viewMode, this applies to scope resolution and tree walking; uia:rt:* element ids bypass it."
  }
};

const treeDetailProperties = {
  detailLevel: {
    type: "string",
    enum: ["compact", "full"],
    default: "compact",
    description: "compact omits empty or heavyweight metadata on tree nodes; full returns localized type, process id, runtime id, value, and patterns on every node."
  }
};

const browserTabProperty = {
  browserTab: {
    type: "string",
    description: "Browser-lane tab id from list_windows (browserLane.browsers[].tabs[].id, for example t1a2b). Works on that page over the Chrome DevTools Protocol, in the background: no pointer movement, keyboard focus, clipboard or window activation. Do not combine with windowTitle, processId, nativeWindowHandle or x/y."
  }
};

const treeBudgetProperties = {
  treeTimeoutMs: {
    type: "integer", minimum: 100, maximum: 30000, default: 5000,
    description: "Traversal time budget checked between synchronous UIA provider calls. Returns a partial tree with truncationReason when exceeded; an individual provider call may exceed this budget."
  }
};

const maxDepthDescription = "Levels below the root. In window-scoped trees, unnamed Chromium layout panes (Electron, Chrome/Edge, CEF, WebView2) do not count, so page content stays within the default depth.";
const webContentNote = " In a Chromium-based window (Electron, Chrome/Edge, CEF, WebView2) the first observation enables the page's accessibility tree; webContent reports whether it is ready.";

const tools = [
  {
    name: "windows_computer_use_health",
    description: "Check that the Windows UI Automation backend, screenshot capture, and input stack are available.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "windows_computer_use_snapshot",
    description: "Capture a screenshot and a UI Automation tree for the active window or desktop." + webContentNote + " With browserTab, return that tab's page as an accessibility outline (element ids such as t1a2b:57 for click/set_value/focus/scroll) plus its viewport image, read in the background.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...windowTargetProperties,
        ...browserTabProperty,
        ...treeViewProperties,
        ...treeDetailProperties,
        ...treeBudgetProperties,
        includeScreenshot: { type: "boolean", default: true },
        captureWindow: {
          type: "boolean",
          default: false,
          description: "Capture only the target (or active) window instead of the whole virtual screen; an active window behind another window is captured this way anyway. An unobstructed foreground window uses a checked screen crop; other windows use PrintWindow/WGC, then a screen fallback flagged occludedPossible. Much smaller image."
        },
        maxWidth: {
          type: "integer",
          minimum: 0,
          maximum: 7680,
          default: 1600,
          description: "Downscale the screenshot so its width is at most this many pixels (0 = native resolution). The response then carries imageScale + origin so image pixels can be mapped back to screen coordinates."
        },
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 5, description: maxDepthDescription },
        maxNodes: { type: "integer", minimum: 1, maximum: 2000, default: 250 }
      }
    }
  },
  {
    name: "windows_computer_use_accessibility_tree",
    description: "Read the UI Automation tree without taking a screenshot." + webContentNote + " With browserTab, read that tab's page as an accessibility outline in the background; its element ids (t1a2b:57) work in click/double_click/set_value/focus/invoke/scroll/element_info.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...windowTargetProperties,
        ...browserTabProperty,
        ...treeViewProperties,
        ...treeDetailProperties,
        ...treeBudgetProperties,
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 6, description: maxDepthDescription },
        maxNodes: { type: "integer", minimum: 1, maximum: 3000, default: 500 }
      }
    }
  },
  {
    name: "windows_computer_use_list_windows",
    description: "List top-level windows visible to Windows UI Automation. browserLane lists the tabs of connected Chromium browsers with ids for browserTab, and explains how to open a background tab (set_value elementId new-tab).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeInvisible: { type: "boolean", default: false },
        maxWindows: { type: "integer", minimum: 1, maximum: 200, default: 50 }
      }
    }
  },
  {
    name: "windows_computer_use_find",
    description: "Find UIA elements by name, automation id, class, value or type. When UIA is sparse or incomplete and no match is found, automatically read visible text with OCR. OCR candidates have SCREEN coordinates and source:'ocr', not UIA element ids. If the literal query misses, inspect ocr.lines and reformulate using the visible text (a search box may say '大家都在搜'). With browserTab, search that page's accessibility outline instead and return page element ids.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...windowTargetProperties,
        ...browserTabProperty,
        ...treeViewProperties,
        ...treeBudgetProperties,
        controlType: { type: "string" },
        ocrFallback: { type: "boolean", default: true, description: "Use OCR after an empty sparse/incomplete UIA search. Disable for UIA-only diagnostics. No input is sent." },
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 8, description: maxDepthDescription },
        maxNodes: { type: "integer", minimum: 1, maximum: 5000, default: 1200 },
        maxResults: { type: "integer", minimum: 1, maximum: 200, default: 25 }
      }
    }
  },
  {
    name: "windows_computer_use_element_info",
    description: "Return UI Automation information for an element id or a screen point. A browser-lane page element id (t1a2b:57) returns its tag, text, value, link and page box.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties,
        ...treeDetailProperties,
        x: { type: "integer" },
        y: { type: "integer" }
      }
    }
  },
  {
    name: "windows_computer_use_click",
    description: "Click a screen coordinate or the center of a UI Automation element. dispatch:'auto' (default) = a left click on an element runs in the background (BM_CLICK on a Win32 button, else its UIA Invoke/Toggle pattern); a coordinate click is real SendInput input: the target comes forward for it, a point that shows another window is refused (POINT_COVERED), then the pointer and the foreground go back; dispatch:'background' = PostMessage into the target window's queue (no foreground steal, delivery unverified — Chromium/Electron/UWP may drop it, then retry with foreground); dispatch:'foreground' = always foreground SendInput. Raw-coordinate clicks home-correct if the target window moved since it was observed (reported as 'homed'). A browser-lane page element id (t1a2b:57) is clicked inside the page itself, in the background; a covered element is refused and the covering element is named.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties,
        x: { type: "integer" },
        y: { type: "integer" },
        button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
        dispatch: { type: "string", enum: ["auto", "background", "foreground"], default: "auto" }
      }
    }
  },
  {
    name: "windows_computer_use_double_click",
    description: "Double click a screen coordinate or the center of a UI Automation element. Supports the same dispatch modes as click (background posts a real WM_LBUTTONDBLCLK). Browser-lane page element ids are double-clicked inside the page.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties,
        x: { type: "integer" },
        y: { type: "integer" },
        button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
        dispatch: { type: "string", enum: ["auto", "background", "foreground"], default: "auto" }
      }
    }
  },
  {
    name: "windows_computer_use_move",
    description: "Move the mouse pointer to a screen coordinate or the center of an element. A browser-lane page element id hovers it inside the page without moving the desktop pointer.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties,
        x: { type: "integer" },
        y: { type: "integer" }
      }
    }
  },
  {
    name: "windows_computer_use_drag",
    description: "Drag through a path of screen coordinates.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        ...windowTargetProperties,
        path: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["x", "y"],
            additionalProperties: false,
            properties: {
              x: { type: "integer" },
              y: { type: "integer" }
            }
          }
        },
        button: { type: "string", enum: ["left", "right", "middle"], default: "left" }
      }
    }
  },
  {
    name: "windows_computer_use_scroll",
    description: "Scroll at a screen coordinate or an element. An element scrolls in the background first (WM_VSCROLL on a Win32 scroll bar, else the UIA ScrollPattern of the element or of its nearest scrolling ancestor) and reports scrollPercent before/after; otherwise the wheel is real input at the point, with the foreground and pointer given back. Positive deltaY scrolls down; 120 is one wheel notch. With browserTab (the page) or a browser-lane page element id, scroll inside the page in the background.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...browserTabProperty,
        ...treeViewProperties,
        x: { type: "integer" },
        y: { type: "integer" },
        deltaY: { type: "integer", default: 480 },
        deltaX: { type: "integer", default: 0 }
      }
    }
  },
  {
    name: "windows_computer_use_type_text",
    description: "Type text into the focused control of the target (or active) window. method:'auto' (default) = a focused Win32 edit takes the text in the background (EM_REPLACESEL at the caret: no clipboard, keyboard or foreground; text with line breaks is pasted instead); any other control gets a clipboard paste with the window borrowed for it (reliable for CJK; the clipboard is restored and the paste kept out of clipboard history); method:'clipboard' always pastes; method:'sendinput' sends each character as a KEYEVENTF_UNICODE SendInput event (no clipboard, best for ASCII/short text); method:'background' posts WM_CHAR straight into the target window's message queue — no clipboard, no foreground steal, delivery unverified. After a background write, or with a window target and focusMode:'main', the result includes verifyValue (the text control's value after typing, truncated to 200 chars). With browserTab, insert the text at that page's focused field inside the browser: no clipboard, pointer or foreground change.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        ...windowTargetProperties,
        ...browserTabProperty,
        text: { type: "string" },
        method: { type: "string", enum: ["auto", "clipboard", "sendinput", "background"], default: "auto" },
        focusMode: { type: "string", enum: ["preserve", "main"], default: "preserve", description: "preserve keeps the focus established by a previous click, essential for OCR/visual targets. main explicitly tries to focus the window's largest Edit/Document control." },
        restoreClipboard: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "windows_computer_use_keypress",
    description: "Press a key or key chord, such as Ctrl+L, Enter, Alt+F4, or Shift+Tab. The Windows key is blocked by design. The keys go to the target (or active) window, which comes forward for them and then gives the foreground back, unless a menu or dialog they opened is showing. dispatch:'background' supports only a single printable character (posted as WM_CHAR into the target window, no foreground steal); chords and functional keys must use dispatch:'foreground' (SendKeys). With browserTab, the key goes to that page inside the browser: Alt+Left/Alt+Right/F5 go back/forward/reload, Enter/Escape answer an open JavaScript dialog, and browser-window shortcuts such as Ctrl+L or Ctrl+T are refused.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["keys"],
      properties: {
        ...windowTargetProperties,
        ...browserTabProperty,
        keys: {
          type: "array",
          minItems: 1,
          items: { type: "string" }
        },
        dispatch: { type: "string", enum: ["foreground", "background"], default: "foreground" }
      }
    }
  },
  {
    name: "windows_computer_use_focus",
    description: "Set keyboard focus to a UI Automation element, or to a browser-lane page element inside its page.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["elementId"],
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties
      }
    }
  },
  {
    name: "windows_computer_use_invoke",
    description: "Invoke a UI Automation element in the background: BM_CLICK on a Win32 button, else its Invoke, Toggle, SelectionItem, or ExpandCollapse pattern, with click fallback. action expands, collapses or scrolls the element into view instead. A browser-lane page element id is clicked inside the page.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["elementId"],
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties,
        action: { type: "string", enum: ["default", "expand", "collapse", "scroll_into_view"], default: "default", description: "default = the first of Invoke, Toggle, SelectionItem, ExpandCollapse the element has. expand/collapse = ExpandCollapse only; an element already in that state is left as is. scroll_into_view = ScrollItem: its container scrolls until the element shows, with no pointer. UI Automation elements only." },
        fallbackClick: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "windows_computer_use_set_value",
    description: "Set a value in the background (EM_REPLACESEL on a Win32 edit, else the UI Automation ValuePattern), or focus and type as fallback. Browser lane: a page element id fills that field, selects that option or sets that checkbox inside the page; <tab>:address (for example t1a2b:address) navigates the tab to a web address; new-tab opens the address in a background tab, in a separate DSH browser without sign-ins or, when the user turned on sign-ins, in their own browser; <browser>:new-tab opens it in that connected browser.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["elementId", "value"],
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties,
        value: { type: "string" },
        fallbackType: { type: "boolean", default: true },
        restoreClipboard: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "windows_computer_use_activate_window",
    description: "Bring a top-level window to the foreground by title substring, process id, or native HWND. This tool always activates its target; the shared activate flag cannot suppress it. With browserTab, bring that tab to the front of its browser window.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { ...windowTargetProperties, ...browserTabProperty }
    }
  },
  {
    name: "windows_computer_use_wait",
    description: "Wait for a short period before observing the UI again.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        milliseconds: { type: "integer", minimum: 1, maximum: 30000, default: 500 }
      }
    }
  },
  {
    name: "windows_computer_use_ocr",
    description: "Read visible text with Windows.Media.Ocr, independent of UIA by default. Returns text, lines and word boxes in SCREEN coordinates. query is literal text matching, not semantic recognition; inspect lines if 'search' misses a placeholder. Click matched.word.x/y using foreground dispatch, then type_text with focusMode:'preserve'. Optional resolveControl performs a potentially blocking UIA hit-test; its control may be the whole page rather than the text input.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...windowTargetProperties,
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        maxWidth: { type: "integer", minimum: 0, maximum: 7680, default: 1920 },
        resolveControl: { type: "boolean", default: false },
        includeScreenshot: { type: "boolean", default: false },
        query: {
          type: "string",
          description: "Optional literal text query, case-insensitive and ignoring whitespace. Returns up to 3 matched word runs with screen boundingBox and center in word.x/y. control is null unless resolveControl:true opts into a UIA hit-test. Supports character-segmented CJK text."
        }
      }
    }
  },
  {
    name: "windows_computer_use_screenshot",
    description: "Capture a window or desktop without querying UIA. Returns an image plus bounds and imageScale for mapping image pixels to SCREEN coordinates: screen = bounds origin + image / imageScale. Use when the accessibility provider is unavailable, or to locate icons visually. Capture does not prove an action succeeded; inspect the resulting state. With browserTab, capture that tab's viewport inside the browser, also in the background; its pixels are page pixels, not screen coordinates.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      ...windowTargetProperties,
      ...browserTabProperty,
      scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
      maxWidth: { type: "integer", minimum: 0, maximum: 7680, default: 1600 }
    } }
  },
  {
    name: "windows_computer_use_wait_for",
    description: "Wait for a window, a UIA element, or literal visible OCR text to appear/disappear. condition:'window' uses native window enumeration; 'element' uses a bounded UIA query; 'text' uses OCR without UIA. Returns verification:'observed' only when the condition was observed; truncated UIA absence is inconclusive. Text is literal, so use the actual expected text, not an inferred semantic label. With browserTab, element/text conditions poll that page's accessibility outline.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...windowTargetProperties,
        ...browserTabProperty,
        condition: { type: "string", enum: ["window", "element", "text"], default: "window" },
        query: { type: "string" },
        controlType: { type: "string" },
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...treeViewProperties,
        treeTimeoutMs: { type: "integer", minimum: 100, maximum: 30000, default: 1000 },
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 8, description: maxDepthDescription },
        maxNodes: { type: "integer", minimum: 1, maximum: 5000, default: 1200 },
        appear: { type: "boolean", default: true },
        timeoutMs: { type: "integer", minimum: 100, maximum: 60000, default: 5000 },
        intervalMs: { type: "integer", minimum: 50, maximum: 5000, default: 250 }
      }
    }
  },
  {
    name: "windows_computer_use_close_window",
    description: "Close a window gracefully by posting WM_CLOSE (the app can veto with a save dialog). Safer than killing the process; use close_window instead of alt+f4 when the app may have unsaved state you want to handle. The shared activate flag is ignored: WM_CLOSE is posted in the background and needs no foreground switch. With browserTab, close that tab; the page may still ask to confirm leaving.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { ...windowTargetProperties, ...browserTabProperty }
    }
  },
  {
    name: "windows_computer_use_move_window",
    description: "Move (not resize) a window to screen coordinates without activating it. Useful for arranging windows, and it also refreshes the homing cache for coordinate-based actions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        ...windowTargetProperties,
        x: { type: "integer" },
        y: { type: "integer" }
      }
    }
  }
];

// Keep execution/validation schemas intact; only the model-facing prose is
// shortened. The discovery tool returns the original definition on demand.
const conciseDescriptions = {
  health: 'Check Windows backend availability.',
  snapshot: 'Screenshot and UIA tree. Partial trees report truncation; use OCR for sparse UIA. browserTab: page outline and viewport.',
  accessibility_tree: 'Read a bounded UIA tree; partial output does not establish absence. browserTab: page outline with element ids.',
  list_windows: 'List native top-level windows, HWND/PID and responsiveness; browserLane lists browser tabs for browserTab.',
  find: 'Find UIA controls; empty sparse searches add OCR. OCR hits use SCREEN coordinates, not element IDs.',
  element_info: 'Inspect a UIA element ID, page element ID or physical SCREEN point.',
  click: 'Click elementId (in the background) or physical SCREEN x/y (real click; the foreground and pointer go back). background delivery is unverified. Page ids (t1a2b:57) act inside the page.',
  double_click: 'Double-click elementId or physical SCREEN x/y; background delivery is unverified.',
  move: 'Move pointer to elementId or physical SCREEN x/y.',
  drag: 'Drag a path of physical SCREEN coordinates; the target comes forward for it.',
  scroll: 'Scroll elementId (in the background first) or physical SCREEN x/y; positive deltaY scrolls down.',
  type_text: 'Type into the focus. auto: Win32 edits in the background, else a paste with the window borrowed; restores the clipboard. background (WM_CHAR) is unverified.',
  keypress: 'Send key/chord, e.g. ["ctrl","a"]. Windows key blocked; background supports one printable character only.',
  focus: 'Focus a UIA element.',
  invoke: 'Invoke/toggle/select/expand a UIA element in the background, with optional click fallback; action expands, collapses or scrolls it into view.',
  set_value: 'Set a value in the background, with optional focus/type fallback. Page ids fill fields; <tab>:address navigates; new-tab opens a URL in a background tab.',
  activate_window: 'Activate target window; activation cannot be suppressed.',
  wait: 'Pause briefly before observing again.',
  ocr: 'Read visible text without UIA. Literal query; inspect lines on misses. Click word.x/y in SCREEN coordinates.',
  screenshot: 'Capture without UIA. SCREEN = bounds origin + image pixel / imageScale. Inspect resulting state to verify actions. browserTab: page pixels.',
  wait_for: 'Wait for window/UIA element/literal OCR text. observed means condition met; partial UIA absence is inconclusive.',
  close_window: 'Post WM_CLOSE in background; application may close or show a save dialog.',
  move_window: 'Move window to physical SCREEN x/y; updates coordinate homing.'
};
const concisePropertyDescriptions = {
  windowTitle: 'Target title substring.', processId: 'Target PID.', nativeWindowHandle: 'Target HWND.',
  activate: 'Bring forward and keep in front.',
  viewMode: 'UIA view; runtime IDs bypass view filtering.',
  includeOffscreen: 'Include offscreen UIA nodes.', detailLevel: 'compact omits heavy/empty node metadata.',
  treeTimeoutMs: 'Budget between UIA calls; a provider call may overrun.',
  captureWindow: 'Crop target window; bounds/imageScale map SCREEN coordinates.',
  ocrFallback: 'Add OCR after empty sparse/incomplete UIA search.',
  focusMode: 'preserve keeps clicked focus; main chooses largest text control.',
  query: 'Literal text; OCR ignores case/whitespace.',
  resolveControl: 'Optional UIA hit-test; may block or return a whole document.',
  browserTab: 'Browser tab id from list_windows; background page access.'
};
function compactSchema(schema, key) {
  const result = {};
  for (const [field, value] of Object.entries(schema)) {
    if (field === 'description') {
      if (concisePropertyDescriptions[key]) result.description = concisePropertyDescriptions[key];
    } else if (field === 'properties') {
      result.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, compactSchema(child, name)]));
    } else if (field === 'items') result.items = compactSchema(value);
    else result[field] = value;
  }
  return result;
}
const toolMode = process.env.WCU_TOOL_MODE || 'full';
if (!['lite', 'full', 'lazy'].includes(toolMode)) throw new Error('WCU_TOOL_MODE must be lite, full or lazy');
const prefix = 'windows_computer_use_';
const discoveryName = prefix + 'tools';
const liteNames = ['list_windows', 'find', 'click', 'scroll', 'type_text', 'keypress', 'ocr', 'screenshot', 'wait_for'];
if (JSON.stringify([...TOOL_NAMES].sort()) !== JSON.stringify([...tools.map(tool=>tool.name.slice(prefix.length)),'tools'].sort())) throw new Error('Tool settings catalogue does not match the MCP tool definitions');
const configuredSelection = process.env.WCU_ENABLED_TOOLS === undefined ? null : normalizeEnabledTools(JSON.parse(process.env.WCU_ENABLED_TOOLS));
const selectionMode = toolMode === 'lazy' ? 'lazy' : configuredSelection === null ? toolMode : configuredSelection.length === TOOL_NAMES.length ? 'full' : 'custom';
const allowedTools = new Set((configuredSelection ?? TOOL_NAMES).map(name=>prefix+name));
if (toolMode === 'lazy' && !allowedTools.has(discoveryName)) throw new Error('Lazy startup requires tools in WCU_ENABLED_TOOLS');
const initialNames = toolMode === 'lazy' ? [discoveryName] : configuredSelection ? configuredSelection.map(name=>prefix+name) : [...(toolMode === 'lite' ? liteNames : tools.map(tool => tool.name.slice(prefix.length))).map(name => prefix + name),discoveryName];
const enabledTools = new Set(initialNames);
// Models infer what a server can do from the names of its tools. A Lazy startup
// advertises the management entry alone, so no capability name is left to infer
// from. MCP instructions are the channel for that statement: DSH publishes them
// as a system-prompt section attributed to this server.
const capabilityInstructions = 'Windows Computer Use reads and operates real Windows applications on this machine: it lists windows, reads UI Automation trees, takes screenshots, recognizes on-screen text with OCR, clicks, types, sends keys and manages windows. The current tool-loading preset starts without those desktop tools, so call windows_computer_use_tools with operation "enable" and the names a task needs (or ["*"] for all allowed tools) before using them; "describe" returns one tool\'s full arguments. Prefer UI Automation elements over screen coordinates, and observe again to verify that an action took effect. Web pages in Chromium browsers can also be read and operated in the background through the browser lane: list_windows shows its tabs.';
// A Custom checklist that allows no desktop tool must not claim the capability:
// enabling one is refused, and saying otherwise contradicts the user's setting.
const managementOnly = initialNames.length === 1 && initialNames[0] === discoveryName
  && [...allowedTools].some(name => name !== discoveryName);
const routingInstructions = browserRoutingInstructions(process.env.WCU_SETTINGS_JSON ? JSON.parse(process.env.WCU_SETTINGS_JSON) : {}, [...allowedTools].map(name => name.slice(prefix.length)));
const serverInstructions = [...allowedTools].some(name => name !== discoveryName)
  ? (managementOnly ? capabilityInstructions + '\n\n' : '') + routingInstructions : undefined;
// Saved settings the DSH adapter reset to their defaults (dsh-plugin.mjs)
// surface in health and the tools list (#39).
let adapterNotices = null;
try { adapterNotices = process.env.WCU_ADAPTER_NOTICES ? JSON.parse(process.env.WCU_ADAPTER_NOTICES) : null; } catch {}
const discoveryTool = {
  name: discoveryName,
  // Desktop tools carry their own capability names. A management-only startup
  // advertises this entry alone, so the name "tools" no longer tells the model
  // that the machine can be read and operated — state the capability first.
  description: (toolMode === 'lazy' ? 'Lazy startup: ' : '') + (managementOnly ? 'reads and operates real Windows apps (UI Automation, screenshots, OCR, input, windows); enable tools before desktop use. ' : '') + 'List capabilities; describe reads one full schema; enable/disable accepts names or ["*"] for all allowed desktop tools; reset restores startup selection.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    operation: { type: 'string', enum: ['list','describe','enable','disable','reset'], default: 'list' },
    names: { type: 'array', maxItems: 23, items: { type: 'string' } }
  } }
};
function advertisedTools() {
  return [...tools.filter(tool => enabledTools.has(tool.name)).map(tool => ({
    name: tool.name,
    description: conciseDescriptions[tool.name.slice(prefix.length)],
    inputSchema: compactSchema(tool.inputSchema)
  })), ...(enabledTools.has(discoveryName)?[discoveryTool]:[])];
}
function manageTools(args) {
  args = validateArguments(discoveryTool.inputSchema, args);
  const requested = args.names || [];
  if (requested.includes('*') && (!['enable','disable'].includes(args.operation) || requested.length !== 1)) throw new Error('INVALID_ARGUMENTS: use ["*"] alone with enable or disable');
  const names = requested[0] === '*' ? tools.filter(tool=>allowedTools.has(tool.name)).map(tool=>tool.name) : [...new Set(requested.map(name => name.startsWith(prefix) ? name : prefix + name))];
  // Resolve every name before mutation, so one typo cannot partially change
  // the client's advertised list. Management is available only if selected.
  const definitions = names.map(name => {
    const tool = tools.find(tool => tool.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  });
  let result;
  if (args.operation === 'list') {
    result = { mode: selectionMode, ...(adapterNotices ? { notices: adapterNotices } : {}), tools: tools.map(tool => ({
      name: tool.name.slice(prefix.length), description: conciseDescriptions[tool.name.slice(prefix.length)], enabled: enabledTools.has(tool.name), available: allowedTools.has(tool.name)
    })) };
  } else if (args.operation === 'describe') {
    if (definitions.length !== 1) throw new Error('INVALID_ARGUMENTS: describe requires exactly one name');
    result = definitions[0];
  } else {
    if (args.operation === 'reset' && names.length) throw new Error('INVALID_ARGUMENTS: reset takes no names');
    if (args.operation !== 'reset' && !requested.length) throw new Error('INVALID_ARGUMENTS: enable/disable requires names');
    if (args.operation === 'enable' && names.some(name=>!allowedTools.has(name))) throw new Error('TOOL_DISABLED_IN_SETTINGS: Change the user-selected tools in Settings > Computer Use (设置 > 电脑操控 in the Chinese interface) before enabling this tool.');
    const before = [...enabledTools].sort().join(',');
    if (args.operation === 'reset') {
      enabledTools.clear(); for (const name of initialNames) enabledTools.add(name);
    } else for (const name of names) args.operation === 'enable' ? enabledTools.add(name) : enabledTools.delete(name);
    result = { mode: selectionMode, enabled: advertisedTools().map(tool => tool.name) };
    if (before !== [...enabledTools].sort().join(',')) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  }
  return { content: [{ type: 'text', text: safeJson(result) }] };
}

function safeJson(value) {
  return JSON.stringify(value);
}

// Validate and apply defaults from the same schemas advertised to MCP clients.
// Never coerce strings/booleans into input coordinates or other action arguments.
function validateArguments(schema, value, location = "arguments") {
  const fail = message => { throw new Error(`INVALID_ARGUMENTS: ${location} ${message}`); };
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object");
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) fail(`has unknown property '${key}'`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`requires '${key}'`);
    const normalized = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) normalized[key] = validateArguments(child, value[key], `${location}.${key}`);
      else if (Object.hasOwn(child, "default")) normalized[key] = child.default;
    }
    return normalized;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be an array");
    if (value.length < (schema.minItems || 0)) fail(`needs at least ${schema.minItems} items`);
    if (value.length > (schema.maxItems ?? 10000)) fail("has too many items");
    return value.map((item, i) => validateArguments(schema.items, item, `${location}[${i}]`));
  }
  if (schema.type === "integer" ? !Number.isSafeInteger(value) : typeof value !== schema.type) fail(`must be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(", ")}`);
  if (schema.minimum !== undefined && value < schema.minimum) fail(`must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) fail(`must be <= ${schema.maximum}`);
  return value;
}

function stripImagePayload(result) {
  if (!result || typeof result !== "object") return result;
  const clone = structuredClone(result);
  if (clone.screenshot?.base64) {
    clone.screenshot.base64 = `<${clone.screenshot.base64.length} base64 chars omitted>`;
  }
  return clone;
}

// ----------------------------------------------------------------------------
// Persistent backend: one long-lived PowerShell process speaking a
// one-JSON-per-line protocol. Repeated actions skip PowerShell startup, .NET
// assembly loading and native-DLL resolution entirely (bench: ~550ms per
// one-shot action -> ~8-50ms hot). If the backend wedges or dies it is
// killed and respawned lazily on the next call.
// ----------------------------------------------------------------------------
let backendProc = null;
let backendNextId = 0;
const backendWaiters = new Map(); // id -> {resolve, reject, timer, proc}
const pendingToolCalls = new Map(); // MCP request id -> {proc}
const retiringBackends = new WeakSet();
const interruptibleActions = new Set(["health", "snapshot", "screenshot", "tree", "list_windows", "find", "element_info", "wait", "ocr", "wait_for"]);
const takeover = new TakeoverControl({ powershell, config: process.env.WCU_SETTINGS_JSON ? JSON.parse(process.env.WCU_SETTINGS_JSON) : {}, onStop(error) {
  for (const request of pendingToolCalls.values()) { request.takeoverError = error.message; request.stoppedByUser = error.message === STOPPED; cancelBackendRequest(request); }
} });

const browserLane = new BrowserLane();
// A tab DSH works in keeps its badge until the host ends the operation series.
browserLane.seriesActive = () => takeover.seriesHeld && !takeover.paused;

// Browser-lane calls work inside the page in the background; the user keeps
// the pointer, the keyboard and the foreground. They take a quiet lease: it
// honours a stopped series and holds settings reconnects, but shows no screen
// indicator and arms no global Esc. DSH's stop button cancels them.
async function runBrowser(action, args, request) {
  let acquired = false;
  const prepared = takeoverSetup.then(async () => {
    if (request?.cancelled) throw new Error(request.stoppedByUser ? STOPPED : 'COMPUTER_USE_CANCELLED');
    await takeover.begin({ quiet: true }); acquired = true;
  });
  takeoverSetup = prepared.catch(() => {});
  try {
    await prepared;
    const result = await browserLane.run(action, args, request);
    const content = [{ type: "text", text: "" }];
    if (result.text) content.push({ type: "text", text: result.text });
    if (result.screenshot?.base64) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: result.screenshot.mimeType });
      result.meta.screenshot = { ...result.screenshot, base64: `<${result.screenshot.base64.length} base64 chars omitted>` };
    }
    content[0].text = safeJson(result.meta);
    return { content, ...(result.meta.ok === false ? { isError: true } : {}) };
  } finally { if (acquired) await takeover.end({ quiet: true }); }
}

function dispatchNextBackend(proc) {
  if (retiringBackends.has(proc)) return;
  const pending = [...backendWaiters.entries()].filter(([, w]) => w.proc === proc);
  if (pending.some(([, w]) => w.sent)) return;
  const entry = pending[0];
  if (!entry) return;
  const [id, w] = entry;
  w.sent = true;
  // Queue time is not execution time. An unsent request must never kill
  // a different action that currently owns the backend or the input state.
  w.timer = setTimeout(w.onTimeout, w.timeoutMs);
  proc.stdin.write(JSON.stringify({ id, action: w.action, args: w.args }) + "\n");
}

function cancelBackendRequest(request) {
  if (request) request.cancelled = true;
  const proc = request?.proc;
  const entry = [...backendWaiters.entries()].find(([, w]) => w.request === request);
  if (!proc || !entry) return;
  const [id, w] = entry;
  const error = new Error("COMPUTER_USE_CANCELLED");
  if (!w.sent) {
    backendWaiters.delete(id); clearTimeout(w.timer); w.reject(error);
    return;
  }
  // Read tools may activate a target, including an Alt press/release in the
  // foreground helper. Let those calls finish just like explicit input actions.
  if (interruptibleActions.has(w.action) && !w.args?.activate) {
    killBackend(error, proc);
    return;
  }
  // Input routines may currently hold a button/key. Let their key-up cleanup finish,
  // but discard every not-yet-started action and retire this worker immediately after.
  // The existing timeout still bounds cleanup; cancellation does not extend it.
  retiringBackends.add(proc);
  for (const [queuedId, queued] of backendWaiters) {
    if (queued.proc !== proc || queued.sent) continue;
    backendWaiters.delete(queuedId); clearTimeout(queued.timer); queued.reject(error);
  }
}

function failBackendWaiters(error, proc) {
  for (const [id, w] of backendWaiters) {
    if (w.proc !== proc) continue;
    backendWaiters.delete(id);
    clearTimeout(w.timer);
    w.reject(error);
  }
}

function spawnBackend() {
  let backendBuf = "";
  const proc = backendProc = spawn(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-Sta",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      backendPath,
      "-Persistent"
    ],
    {
      cwd: pluginRoot,
      env: { ...process.env, WCU_CANCEL_EVENT: takeover.disabledForTest ? '' : takeover.eventName },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  proc.stdout.setEncoding("utf8");
  // Forward backend diagnostics (parse errors, P/Invoke failures, backend
  // tracebacks) to our stderr so they surface in the MCP client's log and in CI.
  proc.stderr.on("data", (chunk) => {
    process.stderr.write(`[wcu-backend] ${chunk}`);
  });
  proc.stdout.on("data", (chunk) => {
    backendBuf += chunk;
    let idx;
    while ((idx = backendBuf.indexOf("\n")) >= 0) {
      const line = backendBuf.slice(0, idx).trim();
      backendBuf = backendBuf.slice(idx + 1);
      if (!line) continue;
      let resp;
      try {
        resp = JSON.parse(line);
      } catch {
        continue;
      }
      const w = backendWaiters.get(resp.id);
      if (!w || w.proc !== proc) continue;
      backendWaiters.delete(resp.id);
      clearTimeout(w.timer);
      if (resp.ok === false) {
        w.reject(new Error(resp.error || `Backend action '${resp.action}' failed`));
      } else {
        w.resolve(resp);
      }
      if (retiringBackends.has(proc)) killBackend(new Error("COMPUTER_USE_CANCELLED"), proc);
      else dispatchNextBackend(proc);
    }
  });
  proc.stdin.on("error", () => { /* EPIPE when the backend dies; the exit handler fails waiters */ });
  const onDeath = (err) => {
    failBackendWaiters(err || new Error("Backend process exited"), proc);
    if (backendProc === proc) backendProc = null;
  };
  proc.on("error", onDeath);
  proc.on("exit", () => onDeath());
}

function ensureBackend() {
  if (backendProc && retiringBackends.has(backendProc)) throw new Error("COMPUTER_USE_STOPPING");
  if (!backendProc || backendProc.exitCode !== null) {
    spawnBackend();
  }
  return backendProc;
}

function killBackend(error = new Error("Backend process stopped"), proc = backendProc) {
  if (proc) {
    if (backendProc === proc) backendProc = null;
    failBackendWaiters(error, proc);
    try {
      proc.kill();
    } catch {
      /* already dead */
    }
  }
}

let takeoverSetup = Promise.resolve();
// Element actions start in the background, with no indicator and no Esc stop.
// One that needs the real pointer or keyboard says so before sending any
// (WCU_NEEDS_INPUT) and runs again with both.
async function runBackend(action, args = {}, timeoutMs = 30000, request) {
  const quiet = isQuietCall(action, args);
  const mayUpgrade = BACKGROUND_FIRST.has(action) || (action === 'click' && (args.dispatch ?? 'auto') === 'auto' && args.elementId != null);
  if (quiet && mayUpgrade) {
    try { return await runBackendOnce(action, { ...args, _wcuQuiet: true }, timeoutMs, request, true); }
    catch (error) { if (!/^WCU_NEEDS_INPUT\b/.test(error.message) || request?.cancelled) throw error; }
    return runBackendOnce(action, args, timeoutMs, request, false);
  }
  return runBackendOnce(action, { ...args, _wcuQuiet: quiet }, timeoutMs, request, quiet);
}

async function runBackendOnce(action, args, timeoutMs, request, quiet) {
  const changesDesktop = action!=='health';
  let acquired = false;
  // Reserve preparation in arrival order. Otherwise awaiting the native
  // indicator can let a later observation reach the backend before its input.
  const prepared = takeoverSetup.then(async () => {
    if (request?.cancelled) throw new Error(request.stoppedByUser ? STOPPED : 'COMPUTER_USE_CANCELLED');
    if (changesDesktop) { await takeover.begin({ quiet }); acquired = true; }
  });
  takeoverSetup = prepared.catch(() => {});
  try {
    await prepared;
    if (request?.cancelled) throw new Error(request.stoppedByUser ? STOPPED : 'COMPUTER_USE_CANCELLED');
    // The series lets typing without a window target follow the window the
    // series last gave input to, after the user got the foreground back.
    return await dispatchBackend(action, { ...args, _wcuCornerFailsafe: false, _wcuTakeoverPid: takeover.child?.pid ?? 0, _wcuSeries: takeover.seriesKey ?? null }, timeoutMs, request);
  } finally { if (acquired) await takeover.end({ quiet }); }
}

function dispatchBackend(action, args = {}, timeoutMs = 30000, request) {
  const proc = ensureBackend();
  if (request) request.proc = proc;
  const id = ++backendNextId;
  return new Promise((resolve, reject) => {
    const onTimeout = () => {
      if (!backendWaiters.has(id)) return;
      backendWaiters.delete(id);
      const targetHint = ['snapshot', 'tree', 'find', 'element_info', 'type_text', 'focus', 'invoke', 'set_value', 'activate_window'].includes(action)
        ? '. Target responsiveness is unknown; the target may also be unresponsive. Avoid immediately retrying tree/input calls; check the window with list_windows and prefer screenshot/ocr after it recovers.' : '';
      const error = new Error(`Windows Computer Use backend timed out after ${timeoutMs}ms during ${action}${targetHint}`);
      error.backendTimeout = true;
      reject(error);
      // The wedged call may have stalled the backend loop: kill it and
      // respawn lazily on the next call.
      killBackend(new Error("Backend stopped after another action timed out"), proc);
    };
    backendWaiters.set(id, { resolve, reject, timer: null, onTimeout, timeoutMs, proc, request, action, args, sent: false });
    dispatchNextBackend(proc);
  });
}

async function callTool(name, args, request) {
  if (!allowedTools.has(name) && TOOL_NAMES.includes(name.slice(prefix.length))) throw new Error('TOOL_DISABLED_IN_SETTINGS: This tool is disabled by the user in Settings > Computer Use (设置 > 电脑操控 in the Chinese interface).');
  if (name === discoveryName) return manageTools(args);
  const definition = tools.find(tool => tool.name === name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  args = validateArguments(definition.inputSchema, args);
  const actionName = name.replace("windows_computer_use_", "");
  const browser = isBrowserCall(args);
  // A browser tab alone names the page, which is what scroll needs.
  if (["click", "double_click", "move", "scroll", "element_info"].includes(actionName) && !args.elementId && (args.x === undefined || args.y === undefined) && !(browser && actionName === "scroll")) throw new Error("INVALID_ARGUMENTS: provide elementId or both x and y");
  if (actionName === "wait_for") {
    if (args.condition === "window" && !browser && !args.windowTitle?.trim() && !args.processId && !args.nativeWindowHandle) throw new Error("INVALID_ARGUMENTS: window wait requires a target");
    if (args.condition !== "window" && !args.query?.trim()) throw new Error("INVALID_ARGUMENTS: text/element wait requires query");
  }
  if (actionName === "keypress" && args.keys.filter(key => !/^(ctrl|control|alt|option|shift)$/i.test(key)).length !== 1) throw new Error("INVALID_ARGUMENTS: keypress needs exactly one non-modifier key");
  if (browser) return runBrowser(actionName === "accessibility_tree" ? "tree" : actionName, args, request);
  switch (name) {
    case "windows_computer_use_health": {
      const result = await runBackend("health", args, undefined, request);
      result.browserLane = await browserLane.health();
      if (adapterNotices) result.adapterNotices = adapterNotices;
      return { content: [{ type: "text", text: safeJson(result) }] };
    }
    case "windows_computer_use_snapshot": {
      const result = await observeBackend("snapshot", args, request);
      const content = [{ type: "text", text: safeJson(stripImagePayload(result)) }];
      if ((args?.includeScreenshot ?? true) && result.screenshot?.base64) {
        content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
      }
      return { content, ...(result.ok === false ? { isError: true } : {}) };
    }
    case "windows_computer_use_accessibility_tree":
      return observationText("tree", args, request);
    case "windows_computer_use_list_windows": {
      const result = await runBackend("list_windows", args, undefined, request);
      try { await browserLane.annotateWindows(result); } catch (error) { result.browserLane = { error: error.message }; }
      return { content: [{ type: "text", text: safeJson(result) }] };
    }
    case "windows_computer_use_find":
      return observationText("find", args, request);
    case "windows_computer_use_element_info":
      return backendText("element_info", args, undefined, request);
    case "windows_computer_use_click":
      return backendText("click", args, undefined, request);
    case "windows_computer_use_double_click":
      return backendText("double_click", args, undefined, request);
    case "windows_computer_use_move":
      return backendText("move", args, undefined, request);
    case "windows_computer_use_drag":
      return backendText("drag", args, undefined, request);
    case "windows_computer_use_scroll":
      return backendText("scroll", args, undefined, request);
    case "windows_computer_use_type_text":
      return backendText("type_text", args, undefined, request);
    case "windows_computer_use_keypress":
      return backendText("keypress", args, undefined, request);
    case "windows_computer_use_focus":
      return backendText("focus", args, undefined, request);
    case "windows_computer_use_invoke":
      return backendText("invoke", args, undefined, request);
    case "windows_computer_use_set_value":
      return backendText("set_value", args, undefined, request);
    case "windows_computer_use_activate_window":
      return backendText("activate_window", args, undefined, request);
    case "windows_computer_use_wait":
      return backendText("wait", args, Math.max(31000, Number(args?.milliseconds || 500) + 1000), request);
    case "windows_computer_use_ocr":
      return imageResult(await runBackend("ocr", args, 20000, request));
    case "windows_computer_use_screenshot":
      return imageResult(await runBackend("screenshot", args, 15000, request));
    case "windows_computer_use_wait_for":
      return backendText("wait_for", args, Math.max(31000, Number(args?.timeoutMs || 5000) + 2000), request);
    case "windows_computer_use_close_window":
      return backendText("close_window", args, undefined, request);
    case "windows_computer_use_move_window":
      return backendText("move_window", args, undefined, request);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function imageResult(result) {
  const content = [{ type: "text", text: safeJson(stripImagePayload(result)) }];
  if (result.screenshot?.base64) content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
  return { content, ...(result.ok === false ? { isError: true } : {}) };
}

async function observeBackend(action, args, request) {
  let result;
  try {
    // Allows cold startup and capture overhead while bounding a wedged provider.
    result = await runBackend(action, args, args.treeTimeoutMs + 10000, request);
  } catch (error) {
    if (!error.backendTimeout || request?.cancelled) throw error;
    // Never replay a timed-out input action. Only capture a fresh native image;
    // retain explicit failure so callers cannot mistake it for a successful tree.
    result = { ok: false, action, source: "uia", truncated: true, truncationReason: "backendTimeout", warning: error.message };
    if (action !== "snapshot" || args.includeScreenshot) {
      try {
        const shot = await runBackend("screenshot", { ...args, activate: false }, 15000, request);
        result.screenshot = shot.screenshot;
      } catch (captureError) { result.captureError = captureError.message; }
    }
    return result;
  }
  result.source = "uia";
  // Browser window chrome can itself expose ~10 nodes without any app content.
  // This is a fallback heuristic, not proof that the app is inaccessible.
  const sparse = (result.nodeCount ?? result.scannedNodes) <= 20;
  if (sparse || result.truncated) result.hint = "UIA is sparse or incomplete. Use OCR text/coordinates or screenshot vision; literal 'search' may miss a placeholder. Inspect visible text before choosing a coordinate.";
  // A Chromium page whose accessibility tree has not arrived is not an app
  // without accessibility: say whether observing again can still help.
  const web = result.webContent;
  if (web && web.ready === 0) result.hint = web.state === "unavailable"
    ? "This Chromium window exposes no page content to UI Automation. Use OCR text/coordinates or screenshot vision."
    : "Chromium is still building this page's accessibility tree. Observe the window again shortly before falling back to OCR coordinates.";
  if (action === "find" && args.ocrFallback && !args.controlType && result.results?.length === 0 && (sparse || result.truncated) && result.targetResponsive !== false && !request?.cancelled) {
    try {
      const ocr = await runBackend("ocr", { ...args, resolveControl: false, maxWidth: 1920 }, 20000, request);
      result.ocr = ocr;
      result.results = (ocr.matched || []).map(hit => ({ source: "ocr", name: hit.word.text, boundingBox: hit.boundingBox, x: hit.word.x, y: hit.word.y }));
      result.source = "uia+ocr";
    } catch (error) {
      if (request?.cancelled) throw error;
      result.ocrError = error.message;
    }
  }
  return result;
}

async function observationText(action, args, request) {
  return imageResult(await observeBackend(action, args, request));
}

const inputActions = new Set(["click", "double_click", "move", "drag", "scroll", "type_text", "keypress", "focus", "invoke", "set_value", "activate_window", "close_window", "move_window"]);
async function backendText(action, args, timeoutMs, request) {
  const result = await runBackend(action, args, timeoutMs, request);
  if (inputActions.has(action)) {
    result.verification = result.moved === false || result.posted === false || result.activated === false ? "unconfirmed" : "sent";
    result.verificationNote = result.verification === "sent" ? "The action was dispatched. Use wait_for or a fresh observation to verify the expected effect." : "Windows did not confirm dispatch. Inspect the warning and observe the target before retrying.";
  }
  return { content: [{ type: "text", text: safeJson(stripImagePayload(result)) }] };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "notifications/initialized") return null;
  if (method === "notifications/cancelled") {
    const request = pendingToolCalls.get(params?.requestId);
    // Only this MCP process's own request and worker may be affected.
    if (request) cancelBackendRequest(request);
    return null;
  }
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
          resources: {}
        },
        serverInfo: {
          name: "windows-computer-use",
          version: SERVER_VERSION
        },
        ...(serverInstructions === undefined ? {} : { instructions: serverInstructions })
      }
    };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: advertisedTools() } };
  }
  if (method === "tools/call") {
    const request = { proc: null };
    pendingToolCalls.set(id, request);
    try {
      const result = await callTool(params?.name, params?.arguments === undefined ? {} : params.arguments, request);
      if (request.cancelled) return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: request.takeoverError || "COMPUTER_USE_CANCELLED_AFTER_CURRENT_ACTION" }] } };
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: request.takeoverError || (error instanceof Error ? error.message : String(error)) }]
        }
      };
    } finally {
      if (pendingToolCalls.get(id) === request) pendingToolCalls.delete(id);
    }
  }
  if (method === "resources/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        resources: wikiResources.map(({ uri, name, mimeType }) => ({ uri, name, mimeType }))
      }
    };
  }
  if (method === "resources/read") {
    const resource = wikiResources.find((item) => item.uri === params?.uri);
    if (!resource) {
      return rpcError(id, -32602, `Unknown resource: ${params?.uri}`);
    }
    const text = await readFile(resource.file, "utf8");
    return {
      jsonrpc: "2.0",
      id,
      result: {
        contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }]
      }
    };
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

let framingMode = "line";
function send(message) {
  if (!message) return;
  const payload = JSON.stringify(message);
  if (framingMode === "headers") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
}

let buffer = Buffer.alloc(0);
function ingest(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length > 0) {
    const asText = buffer.toString("utf8");
    if (asText.startsWith("Content-Length:")) {
      framingMode = "headers";
      const headerEnd = asText.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = asText.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) throw new Error("Invalid MCP Content-Length header");
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      dispatch(JSON.parse(body));
      continue;
    }
    const newline = asText.indexOf("\n");
    if (newline === -1) return;
    const line = asText.slice(0, newline).trim();
    buffer = buffer.subarray(Buffer.byteLength(asText.slice(0, newline + 1), "utf8"));
    if (line) dispatch(JSON.parse(line));
  }
}

function dispatch(message) {
  pendingRequests += 1;
  Promise.resolve(handleRequest(message))
    .then(send)
    .catch((error) => {
      const id = message && Object.hasOwn(message, "id") ? message.id : null;
      send(rpcError(id, -32603, error instanceof Error ? error.message : String(error)));
    })
    .finally(() => {
      pendingRequests -= 1;
      maybeExitAfterStdinEnd();
    });
}

async function selfTest() {
  const health = await runBackend("health", {});
  const snapshot = await runBackend(
    "snapshot",
    { scope: "active_window", includeScreenshot: true, maxDepth: 0, maxNodes: 1 },
    45000
  );
  const toolsOk = tools.length >= 10;
  const screenshotBytes = snapshot?.screenshot?.base64 ? Buffer.byteLength(snapshot.screenshot.base64, "base64") : 0;
  const screenshotOk = screenshotBytes > 1000 && snapshot?.screenshot?.mimeType === "image/png";
  return {
    ok: Boolean(health.ok && toolsOk && screenshotOk && snapshot?.tree),
    server: { name: "windows-computer-use", version: SERVER_VERSION },
    pluginRoot,
    backendPath,
    tools: tools.length,
    backend: health,
    screenshot: {
      ok: screenshotOk,
      mimeType: snapshot?.screenshot?.mimeType,
      bytes: screenshotBytes,
      bounds: snapshot?.screenshot?.bounds,
      path: snapshot?.screenshot?.path
    }
  };
}

if (process.argv.includes("--self-test")) {
  selfTest()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      killBackend();
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      killBackend();
      process.exit(1);
    });
} else if (process.argv[2] === "--backend") {
  const action = process.argv[3] || "health";
  parseBackendCliArgs()
    .then((args) => runBackend(action, args))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      killBackend();
      process.exit(0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      killBackend();
      process.exit(1);
    });
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("exit", () => { killBackend(); browserLane.close(); takeover.child?.stdin.end(); });
  process.stdin.on("data", (chunk) => {
    try {
      ingest(chunk);
    } catch (error) {
      send(rpcError(null, -32700, error instanceof Error ? error.message : String(error)));
    }
  });
  process.stdin.on("end", () => {
    stdinEnded = true;
    maybeExitAfterStdinEnd();
  });
  process.stderr.write(`windows-computer-use MCP server ${SERVER_VERSION} ready\n`);
}

let pendingRequests = 0;
let stdinEnded = false;

function maybeExitAfterStdinEnd() {
  if (stdinEnded && pendingRequests === 0) {
    // A kept-profile DSH browser closes itself first, saving its last cookies.
    Promise.allSettled([takeover.close(), browserLane.shutdown()]).finally(() => process.exit(0));
  }
}

async function parseBackendCliArgs() {
  const rawArg = process.argv.slice(4).join(" ").trim();
  if (rawArg) {
    return JSON.parse(rawArg);
  }
  if (process.stdin.isTTY) {
    return {};
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const rawStdin = Buffer.concat(chunks).toString("utf8").trim();
  return rawStdin ? JSON.parse(rawStdin) : {};
}

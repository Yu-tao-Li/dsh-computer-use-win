#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TakeoverControl, STOPPED } from './takeover.mjs';
import { TOOL_NAMES, normalizeEnabledTools } from './settings.mjs';

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
    description: "Substring of a top-level window title to target instead of the foreground window."
  },
  processId: {
    type: "integer",
    minimum: 1,
    description: "Process id of a top-level window to target instead of the foreground window."
  },
  nativeWindowHandle: {
    type: "integer",
    minimum: 1,
    description: "Native HWND of a top-level window to target instead of the foreground window."
  },
  activate: {
    type: "boolean",
    default: false,
    description: "Bring the targeted window to the foreground before acting. Honoured by: drag, type_text and keypress (input needs the foreground); element-target resolution in snapshot/accessibility_tree/find/element_info/focus/invoke/set_value; the x/y coordinate paths of click/double_click/move/scroll and element_info; window capture in ocr; move_window (activates the moved window). Ignored by close_window (WM_CLOSE works in the background); activate_window always activates regardless of this flag."
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

const treeBudgetProperties = {
  treeTimeoutMs: {
    type: "integer", minimum: 100, maximum: 30000, default: 5000,
    description: "Traversal time budget checked between synchronous UIA provider calls. Returns a partial tree with truncationReason when exceeded; an individual provider call may exceed this budget."
  }
};

const tools = [
  {
    name: "windows_computer_use_health",
    description: "Check that the Windows UI Automation backend, screenshot capture, and input stack are available.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "windows_computer_use_snapshot",
    description: "Capture a screenshot and a UI Automation tree for the active window or desktop.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...windowTargetProperties,
        ...treeViewProperties,
        ...treeDetailProperties,
        ...treeBudgetProperties,
        includeScreenshot: { type: "boolean", default: true },
        captureWindow: {
          type: "boolean",
          default: false,
          description: "Capture only the target (or foreground) window instead of the whole virtual screen. An unobstructed foreground window uses a checked screen crop; other windows use PrintWindow/WGC, then a screen fallback flagged occludedPossible. Much smaller image."
        },
        maxWidth: {
          type: "integer",
          minimum: 0,
          maximum: 7680,
          default: 1600,
          description: "Downscale the screenshot so its width is at most this many pixels (0 = native resolution). The response then carries imageScale + origin so image pixels can be mapped back to screen coordinates."
        },
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 5 },
        maxNodes: { type: "integer", minimum: 1, maximum: 2000, default: 250 }
      }
    }
  },
  {
    name: "windows_computer_use_accessibility_tree",
    description: "Read the UI Automation tree without taking a screenshot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...windowTargetProperties,
        ...treeViewProperties,
        ...treeDetailProperties,
        ...treeBudgetProperties,
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 6 },
        maxNodes: { type: "integer", minimum: 1, maximum: 3000, default: 500 }
      }
    }
  },
  {
    name: "windows_computer_use_list_windows",
    description: "List top-level windows visible to Windows UI Automation.",
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
    description: "Find UIA elements by name, automation id, class, value or type. When UIA is sparse or incomplete and no match is found, automatically read visible text with OCR. OCR candidates have SCREEN coordinates and source:'ocr', not UIA element ids. If the literal query misses, inspect ocr.lines and reformulate using the visible text (a search box may say '大家都在搜').",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...windowTargetProperties,
        ...treeViewProperties,
        ...treeBudgetProperties,
        controlType: { type: "string" },
        ocrFallback: { type: "boolean", default: true, description: "Use OCR after an empty sparse/incomplete UIA search. Disable for UIA-only diagnostics. No input is sent." },
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 8 },
        maxNodes: { type: "integer", minimum: 1, maximum: 5000, default: 1200 },
        maxResults: { type: "integer", minimum: 1, maximum: 200, default: 25 }
      }
    }
  },
  {
    name: "windows_computer_use_element_info",
    description: "Return UI Automation information for an element id or a screen point.",
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
    description: "Click a screen coordinate or the center of a UI Automation element. dispatch:'auto' (default) = element clicks use the UIA Invoke/Toggle pattern in the background (no foreground steal), a coordinate click first resolves the UI Automation element under the point and uses its pattern when it has one (semantic click: the pointer does not move and the foreground window does not change), otherwise foreground SendInput; dispatch:'background' = PostMessage into the target window's queue (no foreground steal, delivery unverified — Chromium/Electron/UWP may drop it, then retry with foreground); dispatch:'foreground' = always foreground SendInput. Raw-coordinate clicks home-correct if the target window moved since it was observed (reported as 'homed').",
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
    description: "Double click a screen coordinate or the center of a UI Automation element. Supports the same dispatch modes as click (background posts a real WM_LBUTTONDBLCLK).",
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
    description: "Move the mouse pointer to a screen coordinate or the center of an element.",
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
    description: "Scroll at a screen coordinate or element center. Positive deltaY scrolls down.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
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
    description: "Type text into the focused control. method:'clipboard' (default) uses clipboard paste (reliable for CJK, restores the clipboard) and needs the target in the foreground; method:'sendinput' sends each character as a KEYEVENTF_UNICODE SendInput event (no clipboard, needs the target in the foreground, best for ASCII/short text); method:'background' posts WM_CHAR straight into the target window's message queue — no clipboard, no foreground steal, delivery unverified. With a window target the result includes verifyValue (the text control's value after typing, truncated to 200 chars).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        ...windowTargetProperties,
        text: { type: "string" },
        method: { type: "string", enum: ["clipboard", "sendinput", "background"], default: "clipboard" },
        focusMode: { type: "string", enum: ["preserve", "main"], default: "preserve", description: "preserve keeps the focus established by a previous click, essential for OCR/visual targets. main explicitly tries to focus the window's largest Edit/Document control." },
        restoreClipboard: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "windows_computer_use_keypress",
    description: "Press a key or key chord, such as Ctrl+L, Enter, Alt+F4, or Shift+Tab. The Windows key is blocked by design. dispatch:'background' supports only a single printable character (posted as WM_CHAR into the target window, no foreground steal); chords and functional keys must use dispatch:'foreground' (SendKeys).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["keys"],
      properties: {
        ...windowTargetProperties,
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
    description: "Set keyboard focus to a UI Automation element.",
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
    description: "Invoke a UI Automation element through Invoke, Toggle, SelectionItem, or ExpandCollapse patterns, with click fallback.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["elementId"],
      properties: {
        elementId: { type: "string" },
        ...windowTargetProperties,
        ...treeViewProperties,
        fallbackClick: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "windows_computer_use_set_value",
    description: "Set a UI Automation ValuePattern value, or focus and type as fallback.",
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
    description: "Bring a top-level window to the foreground by title substring, process id, or native HWND. This tool always activates its target; the shared activate flag cannot suppress it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: windowTargetProperties
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
    description: "Capture a window or desktop without querying UIA. Returns an image plus bounds and imageScale for mapping image pixels to SCREEN coordinates: screen = bounds origin + image / imageScale. Use when the accessibility provider is unavailable, or to locate icons visually. Capture does not prove an action succeeded; inspect the resulting state.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      ...windowTargetProperties,
      scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
      maxWidth: { type: "integer", minimum: 0, maximum: 7680, default: 1600 }
    } }
  },
  {
    name: "windows_computer_use_wait_for",
    description: "Wait for a window, a UIA element, or literal visible OCR text to appear/disappear. condition:'window' uses native window enumeration; 'element' uses a bounded UIA query; 'text' uses OCR without UIA. Returns verification:'observed' only when the condition was observed; truncated UIA absence is inconclusive. Text is literal, so use the actual expected text, not an inferred semantic label.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...windowTargetProperties,
        condition: { type: "string", enum: ["window", "element", "text"], default: "window" },
        query: { type: "string" },
        controlType: { type: "string" },
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...treeViewProperties,
        treeTimeoutMs: { type: "integer", minimum: 100, maximum: 30000, default: 1000 },
        maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 8 },
        maxNodes: { type: "integer", minimum: 1, maximum: 5000, default: 1200 },
        appear: { type: "boolean", default: true },
        timeoutMs: { type: "integer", minimum: 100, maximum: 60000, default: 5000 },
        intervalMs: { type: "integer", minimum: 50, maximum: 5000, default: 250 }
      }
    }
  },
  {
    name: "windows_computer_use_close_window",
    description: "Close a window gracefully by posting WM_CLOSE (the app can veto with a save dialog). Safer than killing the process; use close_window instead of alt+f4 when the app may have unsaved state you want to handle. The shared activate flag is ignored: WM_CLOSE is posted in the background and needs no foreground switch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: windowTargetProperties
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
  snapshot: 'Screenshot and UIA tree. Partial trees report truncation; use OCR for sparse UIA.',
  accessibility_tree: 'Read a bounded UIA tree; partial output does not establish absence.',
  list_windows: 'List native top-level windows, HWND/PID and responsiveness.',
  find: 'Find UIA controls; empty sparse searches add OCR. OCR hits use SCREEN coordinates, not element IDs.',
  element_info: 'Inspect a UIA element ID or physical SCREEN point.',
  click: 'Click elementId or physical SCREEN x/y. auto prefers a UIA action (the element itself, or the element under the point); background delivery is unverified.',
  double_click: 'Double-click elementId or physical SCREEN x/y; background delivery is unverified.',
  move: 'Move pointer to elementId or physical SCREEN x/y.',
  drag: 'Drag a path of physical SCREEN coordinates; target must be foreground.',
  scroll: 'Scroll at elementId or physical SCREEN x/y; positive deltaY scrolls down.',
  type_text: 'Type into current focus; clipboard supports CJK and restores prior contents. Background delivery is unverified.',
  keypress: 'Send key/chord, e.g. ["ctrl","a"]. Windows key blocked; background supports one printable character only.',
  focus: 'Focus a UIA element.',
  invoke: 'Invoke/toggle/select/expand a UIA element, with optional click fallback.',
  set_value: 'Set a UIA value, with optional focus/type fallback.',
  activate_window: 'Activate target window; activation cannot be suppressed.',
  wait: 'Pause briefly before observing again.',
  ocr: 'Read visible text without UIA. Literal query; inspect lines on misses. Click word.x/y in SCREEN coordinates.',
  screenshot: 'Capture without UIA. SCREEN = bounds origin + image pixel / imageScale. Inspect resulting state to verify actions.',
  wait_for: 'Wait for window/UIA element/literal OCR text. observed means condition met; partial UIA absence is inconclusive.',
  close_window: 'Post WM_CLOSE in background; application may close or show a save dialog.',
  move_window: 'Move window to physical SCREEN x/y; updates coordinate homing.'
};
const concisePropertyDescriptions = {
  windowTitle: 'Target title substring.', processId: 'Target PID.', nativeWindowHandle: 'Target HWND.',
  activate: 'Request foreground; close_window ignores this.',
  viewMode: 'UIA view; runtime IDs bypass view filtering.',
  includeOffscreen: 'Include offscreen UIA nodes.', detailLevel: 'compact omits heavy/empty node metadata.',
  treeTimeoutMs: 'Budget between UIA calls; a provider call may overrun.',
  captureWindow: 'Crop target window; bounds/imageScale map SCREEN coordinates.',
  ocrFallback: 'Add OCR after empty sparse/incomplete UIA search.',
  focusMode: 'preserve keeps clicked focus; main chooses largest text control.',
  query: 'Literal text; OCR ignores case/whitespace.',
  resolveControl: 'Optional UIA hit-test; may block or return a whole document.'
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
const capabilityInstructions = 'Windows Computer Use reads and operates real Windows applications on this machine: it lists windows, reads UI Automation trees, takes screenshots, recognizes on-screen text with OCR, clicks, types, sends keys and manages windows. The current tool-loading preset starts without those desktop tools, so call windows_computer_use_tools with operation "enable" and the names a task needs (or ["*"] for all allowed tools) before using them; "describe" returns one tool\'s full arguments. Prefer UI Automation elements over screen coordinates, and observe again to verify that an action took effect.';
// A Custom checklist that allows no desktop tool must not claim the capability:
// enabling one is refused, and saying otherwise contradicts the user's setting.
const managementOnly = initialNames.length === 1 && initialNames[0] === discoveryName
  && [...allowedTools].some(name => name !== discoveryName);
const serverInstructions = managementOnly ? capabilityInstructions : undefined;
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
    result = { mode: selectionMode, tools: tools.map(tool => ({
      name: tool.name.slice(prefix.length), description: conciseDescriptions[tool.name.slice(prefix.length)], enabled: enabledTools.has(tool.name), available: allowedTools.has(tool.name)
    })) };
  } else if (args.operation === 'describe') {
    if (definitions.length !== 1) throw new Error('INVALID_ARGUMENTS: describe requires exactly one name');
    result = definitions[0];
  } else {
    if (args.operation === 'reset' && names.length) throw new Error('INVALID_ARGUMENTS: reset takes no names');
    if (args.operation !== 'reset' && !requested.length) throw new Error('INVALID_ARGUMENTS: enable/disable requires names');
    if (args.operation === 'enable' && names.some(name=>!allowedTools.has(name))) throw new Error('TOOL_DISABLED_IN_SETTINGS: Change the user-selected tools in Settings > Computer Use before enabling this tool.');
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
async function runBackend(action, args = {}, timeoutMs = 30000, request) {
  const changesDesktop = action!=='health';
  let acquired = false;
  // Reserve preparation in arrival order. Otherwise awaiting the native
  // indicator can let a later observation reach the backend before its input.
  const prepared = takeoverSetup.then(async () => {
    if (request?.cancelled) throw new Error(request.stoppedByUser ? STOPPED : 'COMPUTER_USE_CANCELLED');
    if (changesDesktop) { await takeover.begin(); acquired = true; }
  });
  takeoverSetup = prepared.catch(() => {});
  try {
    await prepared;
    if (request?.cancelled) throw new Error(request.stoppedByUser ? STOPPED : 'COMPUTER_USE_CANCELLED');
    return await dispatchBackend(action, { ...args, _wcuCornerFailsafe: false, _wcuTakeoverPid: takeover.child?.pid ?? 0 }, timeoutMs, request);
  } finally { if (acquired) await takeover.end(); }
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
  if (!allowedTools.has(name) && TOOL_NAMES.includes(name.slice(prefix.length))) throw new Error('TOOL_DISABLED_IN_SETTINGS: This tool is disabled by the user in Settings > Computer Use.');
  if (name === discoveryName) return manageTools(args);
  const definition = tools.find(tool => tool.name === name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  args = validateArguments(definition.inputSchema, args);
  const actionName = name.replace("windows_computer_use_", "");
  if (["click", "double_click", "move", "scroll", "element_info"].includes(actionName) && !args.elementId && (args.x === undefined || args.y === undefined)) throw new Error("INVALID_ARGUMENTS: provide elementId or both x and y");
  if (actionName === "wait_for") {
    if (args.condition === "window" && !args.windowTitle?.trim() && !args.processId && !args.nativeWindowHandle) throw new Error("INVALID_ARGUMENTS: window wait requires a target");
    if (args.condition !== "window" && !args.query?.trim()) throw new Error("INVALID_ARGUMENTS: text/element wait requires query");
  }
  if (actionName === "keypress" && args.keys.filter(key => !/^(ctrl|control|alt|option|shift)$/i.test(key)).length !== 1) throw new Error("INVALID_ARGUMENTS: keypress needs exactly one non-modifier key");
  switch (name) {
    case "windows_computer_use_health":
      return backendText("health", args, undefined, request);
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
    case "windows_computer_use_list_windows":
      return backendText("list_windows", args, undefined, request);
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
  process.on("exit", () => { killBackend(); takeover.child?.stdin.end(); });
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
    takeover.close().finally(() => process.exit(0));
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

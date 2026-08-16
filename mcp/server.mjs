#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER_VERSION = "0.1.2";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
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
    description: "Bring the targeted window to the foreground before reading it."
  }
};

const treeViewProperties = {
  viewMode: {
    type: "string",
    enum: ["control", "content", "raw"],
    default: "control",
    description: "UI Automation view used for traversal. control is the default compact app-control tree; content returns end-user content nodes; raw returns provider internals for debugging."
  },
  includeOffscreen: {
    type: "boolean",
    default: false,
    description: "Include UIA elements currently reported as offscreen. Leave false for normal app workflows; set true for debugging or resolving ids from an offscreen-inclusive tree."
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
        includeScreenshot: { type: "boolean", default: true },
        captureWindow: {
          type: "boolean",
          default: false,
          description: "Capture only the target (or foreground) window instead of the whole virtual screen. Uses PrintWindow when supported (works for non-foreground windows) and falls back to the on-screen region (flagged occludedPossible). Much smaller image."
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
    description: "Find elements by name, automation id, class name, value text, or control type.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        ...windowTargetProperties,
        ...treeViewProperties,
        controlType: { type: "string" },
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
        x: { type: "integer" },
        y: { type: "integer" }
      }
    }
  },
  {
    name: "windows_computer_use_click",
    description: "Click a screen coordinate or the center of a UI Automation element. dispatch:'auto' (default) = element clicks use the UIA Invoke/Toggle pattern in the background (no foreground steal), coordinate clicks use foreground SendInput; dispatch:'background' = PostMessage into the target window's queue (no foreground steal, delivery unverified — Chromium/Electron/UWP may drop it, then retry with foreground); dispatch:'foreground' = always foreground SendInput. Raw-coordinate clicks home-correct if the target window moved since it was observed (reported as 'homed').",
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
    description: "Bring a top-level window to the foreground by title substring, process id, or native HWND.",
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
    description: "OCR a window (or the whole desktop) with Windows.Media.Ocr — the fallback for UIA-blind apps (games, self-drawn Tk/Qt, RDP, canvases). Returns the full text plus lines with word boxes in SCREEN coordinates, so you can click on OCR'd text. Slower than the UIA tree (~1-3s); use it after snapshot/find shows a sparse tree, or when the app is known to be UIA-blind.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...windowTargetProperties,
        scope: { type: "string", enum: ["active_window", "desktop"], default: "active_window" },
        maxWidth: { type: "integer", minimum: 0, maximum: 7680, default: 1920 }
      }
    }
  },
  {
    name: "windows_computer_use_wait_for",
    description: "Poll server-side until a window appears or disappears (or timeout). Prefer this over wait+check loops: saves round-trips. Returns found + waitedMs (and timedOut when the deadline passed).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["windowTitle"],
      properties: {
        windowTitle: { type: "string" },
        appear: { type: "boolean", default: true },
        timeoutMs: { type: "integer", minimum: 100, maximum: 60000, default: 5000 },
        intervalMs: { type: "integer", minimum: 50, maximum: 5000, default: 250 }
      }
    }
  },
  {
    name: "windows_computer_use_close_window",
    description: "Close a window gracefully by posting WM_CLOSE (the app can veto with a save dialog). Safer than killing the process; use close_window instead of alt+f4 when the app may have unsaved state you want to handle.",
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

function safeJson(value) {
  return JSON.stringify(value, null, 2);
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
let backendBuf = "";
let backendNextId = 0;
const backendWaiters = new Map(); // id -> {resolve, reject, timer}

function failBackendWaiters(error) {
  for (const [, w] of backendWaiters) {
    clearTimeout(w.timer);
    w.reject(error);
  }
  backendWaiters.clear();
}

function spawnBackend() {
  backendBuf = "";
  backendProc = spawn(
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
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  backendProc.stdout.setEncoding("utf8");
  backendProc.stderr.on("data", () => { /* diagnostics only */ });
  backendProc.stdout.on("data", (chunk) => {
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
      if (!w) continue;
      backendWaiters.delete(resp.id);
      clearTimeout(w.timer);
      if (resp.ok === false) {
        w.reject(new Error(resp.error || `Backend action '${resp.action}' failed`));
      } else {
        w.resolve(resp);
      }
    }
  });
  backendProc.stdin.on("error", () => { /* EPIPE when the backend dies; the exit handler fails waiters */ });
  const onDeath = (err) => {
    failBackendWaiters(err || new Error("Backend process exited"));
    backendProc = null;
  };
  backendProc.on("error", onDeath);
  backendProc.on("exit", () => onDeath());
}

function ensureBackend() {
  if (!backendProc || backendProc.exitCode !== null) {
    spawnBackend();
  }
  return backendProc;
}

function killBackend() {
  if (backendProc) {
    try {
      backendProc.kill();
    } catch {
      /* already dead */
    }
    backendProc = null;
  }
}

function runBackend(action, args = {}, timeoutMs = 30000) {
  const proc = ensureBackend();
  const id = ++backendNextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!backendWaiters.has(id)) return;
      backendWaiters.delete(id);
      reject(new Error(`Windows Computer Use backend timed out after ${timeoutMs}ms during ${action}`));
      // The wedged call may have stalled the backend loop: kill it and
      // respawn lazily on the next call.
      killBackend();
    }, timeoutMs);
    backendWaiters.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ id, action, args }) + "\n");
  });
}

async function callTool(name, args) {
  switch (name) {
    case "windows_computer_use_health":
      return backendText("health", args);
    case "windows_computer_use_snapshot": {
      const result = await runBackend("snapshot", args, 45000);
      const content = [{ type: "text", text: safeJson(stripImagePayload(result)) }];
      if ((args?.includeScreenshot ?? true) && result.screenshot?.base64) {
        content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
      }
      return { content };
    }
    case "windows_computer_use_accessibility_tree":
      return backendText("tree", args, 45000);
    case "windows_computer_use_list_windows":
      return backendText("list_windows", args);
    case "windows_computer_use_find":
      return backendText("find", args, 45000);
    case "windows_computer_use_element_info":
      return backendText("element_info", args);
    case "windows_computer_use_click":
      return backendText("click", args);
    case "windows_computer_use_double_click":
      return backendText("double_click", args);
    case "windows_computer_use_move":
      return backendText("move", args);
    case "windows_computer_use_drag":
      return backendText("drag", args);
    case "windows_computer_use_scroll":
      return backendText("scroll", args);
    case "windows_computer_use_type_text":
      return backendText("type_text", args);
    case "windows_computer_use_keypress":
      return backendText("keypress", args);
    case "windows_computer_use_focus":
      return backendText("focus", args);
    case "windows_computer_use_invoke":
      return backendText("invoke", args);
    case "windows_computer_use_set_value":
      return backendText("set_value", args);
    case "windows_computer_use_activate_window":
      return backendText("activate_window", args);
    case "windows_computer_use_wait":
      return backendText("wait", args, Math.max(31000, Number(args?.milliseconds || 500) + 1000));
    case "windows_computer_use_ocr":
      return backendText("ocr", args, 60000);
    case "windows_computer_use_wait_for":
      return backendText("wait_for", args, Math.max(31000, Number(args?.timeoutMs || 5000) + 2000));
    case "windows_computer_use_close_window":
      return backendText("close_window", args);
    case "windows_computer_use_move_window":
      return backendText("move_window", args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function backendText(action, args, timeoutMs) {
  const result = await runBackend(action, args, timeoutMs);
  return { content: [{ type: "text", text: safeJson(stripImagePayload(result)) }] };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "notifications/initialized") return null;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: "windows-computer-use",
          version: SERVER_VERSION
        }
      }
    };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools } };
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments || {});
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }]
        }
      };
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
  process.on("exit", () => killBackend());
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
    process.exit(0);
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

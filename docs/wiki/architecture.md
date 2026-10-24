# Architecture

DSH ToolRuntime calls the official MCP bridge, which starts mcp/server.mjs in Node mode (including Electron via ELECTRON_RUN_AS_NODE). The Node server validates arguments against the same schemas it advertises. One persistent PowerShell backend serializes desktop requests; queued request time is not counted as execution time.

## Observation

UIA trees use cached properties, a node cap, a depth cap and a traversal time budget. One synchronous provider call can still block. The server watchdog allows the budget plus 10 seconds, retires a stuck worker, and may obtain a native screenshot from a replacement. The response preserves explicit failure; an image is not a successful accessibility tree.

Native window enumeration, screenshot, default OCR, coordinate targeting and window management do not resolve UIA elements. Fully on-screen, unobstructed foreground windows use a screen crop, with foreground HWND, Z order and geometry checked before and after capture. Other windows use PrintWindow, Windows.Graphics.Capture and a flagged screen-region fallback. These capture APIs have their own watchdog; UIA independence is not a guarantee that every capture API is interruptible.

Empty sparse/incomplete find results can attach OCR. OCR candidates have source:ocr, recognized text and screen-space bounds. Literal OCR text does not prove a control role. Explicit resolveControl requests a UIA hit-test, whose result may be a whole document. Screenshot image pixels map to screen = bounds origin + image / imageScale.

## Actions and evidence

Foreground input verifies the requested target before dispatch. type_text preserves the current focus by default, so it can follow an OCR/visual click without refocusing another control. focusMode:main explicitly requests heuristic main-control focus.

RuntimeId references are cached from observations with HWND/PID ownership and a five-minute lifetime. Unseen/stale ids require re-observation; the backend does not globally search the desktop for them. Legacy tree paths remain view-dependent.

Actions report verification:sent. A UIA pattern call or native input acceptance does not prove the user's objective. wait_for supports native window presence, bounded UIA element queries, and literal OCR text. A satisfied observable condition reports verification:observed. Truncated UIA absence and occluded OCR remain inconclusive.

Input cancellation allows press/release cleanup before worker retirement. Timed-out input is never replayed. Clipboard data is read before replacement and restored in finally; drag release is also attempted in finally.

## Browser lane

mcp/browser.mjs speaks the Chrome DevTools Protocol from the Node server over WebSocket, beside the PowerShell backend rather than through it. A call routes there when it carries browserTab or a page element id. Each tab gets one flattened session; pages are read with Accessibility.getFullAXTree and flattened into an outline; input uses Input.dispatchMouseEvent / dispatchKeyEvent / insertText inside the page after a hit test. Browser-lane calls take the same takeover lease as backend actions, so the indicator, Esc and the stopped state apply to them too. The agent browser is a headless child process whose tabs run in an isolated browser context; see the browser lane section of mcp-tools.md.

## Vision

No visual model is bundled. A vision-capable caller or optional external parser such as OmniParser can consume screenshot content and return coordinates to the same guarded input tools.

# MCP tools for DeepSeek Harness

The Node server enforces the same schemas returned by tools/list. Unknown properties, wrong types and out-of-range values fail before backend execution. Tool names are prefixed windows_computer_use_; the DSH bridge typically adds mcp__wincu__.

## Observation and task verification

Prefer scoped UIA observations. find supplements an empty sparse (at most 20 nodes, a heuristic) or incomplete search with OCR, unless ocrFallback:false or controlType is specified. OCR candidates are recognized text and screen coordinates, not UIA ids. Inspect ocr.lines if a literal query misses a placeholder.

Chromium-based windows (Electron, Chrome/Edge, CEF, WebView2) build a page's accessibility tree only after a UIA client reads a property of the page root, the first child of each Chrome_RenderWidgetHostHWND window. The control view skips that empty root, so a tree walk alone can leave such a window at its frame and layout panes. Before a window-scoped snapshot, accessibility_tree, find or element wait_for, the backend reads that root for each visible renderer window and waits for the page tree: at most 1.5 seconds and half of treeTimeoutMs per call. The result then carries webContent with renderers, ready, waitedMs and state: ready, partial, starting (observe again shortly) or unavailable (no page tree after 30 seconds of observations, or an unresponsive renderer). element_info by point and OCR resolveControl warm the window the same way before hit-testing. In window-scoped trees, unnamed Chromium layout panes do not count toward maxDepth, so the default depths reach the page; reported depth values stay structural. Desktop-scoped trees neither warm pages nor change depth counting, so they remain an overview of every window.

screenshot and default OCR do not resolve UIA. An unobstructed foreground window uses a screen crop checked before and after capture; background/covered windows use window-capture fallbacks. OCR resolveControl:true opts into hit-testing; its control may represent the whole page. includeScreenshot:true returns MCP image content. Map image pixels to screen = imageBounds origin + image / imageScale. Screen-region captures report occludedPossible:false only when the foreground, Z-order and geometry checks passed; the last-resort screen fallback reports true.

After a coordinate click, type_text preserves focus. Explicit focusMode:main requests heuristic main-control focus. Input actions only report verification:sent; use wait_for for an expected window, UIA element or literal visible text. A confirmed condition reports verification:observed; truncated UIA absence and occluded OCR are inconclusive. Confirm text that exists only after the desired effect, rather than the same text just typed.

Tree watchdogs allow treeTimeoutMs + 10 seconds. A timeout retires the worker; an independently captured image remains supplemental to the explicit UIA error. Input is never replayed. Queue deadlines begin at actual dispatch. Observed RuntimeIds are cached for five minutes, at most 6000 references, with native owner checks; unknown/stale ids require a scoped re-observation.

No visual model is bundled. A vision-capable caller or external parser can consume screenshot content and send coordinates to the guarded input tools.

## Foreground, pointer and the takeover indicator

Each action uses the least intrusive way that works. Reads (snapshot, accessibility_tree, find, element_info, screenshot, ocr, wait_for), list_windows and wait touch nothing. Element actions run in the background: a Win32 or WinForms button, check box or radio button takes BM_CLICK, a Win32 edit takes EM_REPLACESEL, and other elements use their UI Automation pattern. Some UIA providers bring their window forward or move the pointer to carry out a pattern call (managed Win32 proxies call SetForegroundWindow; a list view item's Invoke double-clicks with the real pointer; Chromium activates its window); the backend gives the foreground and the pointer back at once, unless a menu, list or dialog the call opened is showing. Results then report `foreground` and `pointer`.

Real input (coordinate clicks, pastes, key presses, drags, wheel scrolls) borrows the foreground: the target comes forward for the action, a coordinate click is refused with POINT_COVERED when its point shows a window of another process, and afterwards the pointer goes back where the user left it and the foreground goes back to the window that was in front. The target stays in front while a menu, list or dialog the action opened is showing, with activate:true, and when the user switched windows meanwhile; a pointer the user moved is left where they put it. Keys are sent only after a last check that the target (or a window of its process) is still in front. Bringing a window forward first joins the input of the thread in front, which needs no key press, and falls back to the Alt-key method.

Without a window target, the active window is the window the operation series last gave input to, while it is open, else the foreground window. Input and observations without a target use it, so after the foreground went back to the user they keep to DSH's window; snapshot captures that window when it is behind another one. health.activeWindow still reports the real foreground window.

Reads, list_windows, wait, background dispatch and element actions that start in the background take a quiet lease: they honour a stopped series but show no indicator and arm no global Esc. An element action (invoke, set_value, scroll on an element) or type_text in auto mode that turns out to need real input fails in the background attempt with WCU_NEEDS_INPUT before anything is sent, and the server runs it again with the indicator and Esc. Text DSH pastes carries the clipboard formats that keep it out of clipboard history and the cloud clipboard, and the previous clipboard is restored.

## Published tool contracts

### tools — discovery and on-demand loading

DSH defaults to All (23 desktop tools plus management). Lite includes nine common tools plus management; Custom loads the user's selection. Standalone MCP also defaults to All. `windows_computer_use_tools` accepts `operation: list | describe | enable | disable | reset` and optional `names`, an array of short or complete tool names. `describe` requires exactly one name and returns its original full description and schema. `enable`/`disable` require names and send a tool-list change notification on changes. `reset` takes no names and restores the user's startup set. Invalid names never partially change the list. Discovery does not start PowerShell.

When the startup set is the management entry alone and at least one desktop tool is allowed (Lazy startup), `initialize` returns `instructions` describing the desktop capability and the requirement to enable tools first; that entry's own description states the capability too. A management-only start otherwise leaves no desktop tool name from which a model can infer what this server does. Other startup sets omit `instructions`, including a Custom checklist that allows no desktop tool: enabling one there is refused, so the capability must not be claimed.

See [on-demand tools](../tool-context.md) for bilingual configuration and client compatibility notes. The contracts below describe all desktop capabilities; they are not all injected in Lite mode. Compact advertised prose does not remove their parameter validation.

### health

Check that the Windows UI Automation backend, screenshot capture, and input stack are available.

| Argument | Type | Default / bounds |
|---|---|---|

### snapshot

Capture a screenshot and a UI Automation tree for the active window or desktop. In a Chromium-based window (Electron, Chrome/Edge, CEF, WebView2) the first observation enables the page's accessibility tree; webContent reports whether it is ready.

| Argument | Type | Default / bounds |
|---|---|---|
| scope | string | active_window/desktop; default: "active_window" |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| detailLevel | string | compact/full; default: "compact" |
| treeTimeoutMs | integer | default: 5000; min: 100; max: 30000 |
| includeScreenshot | boolean | default: true |
| captureWindow | boolean | default: false |
| maxWidth | integer | default: 1600; min: 0; max: 7680 |
| maxDepth | integer | default: 5; min: 0; max: 12 |
| maxNodes | integer | default: 250; min: 1; max: 2000 |

### accessibility_tree

Read the UI Automation tree without taking a screenshot. In a Chromium-based window (Electron, Chrome/Edge, CEF, WebView2) the first observation enables the page's accessibility tree; webContent reports whether it is ready.

| Argument | Type | Default / bounds |
|---|---|---|
| scope | string | active_window/desktop; default: "active_window" |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| detailLevel | string | compact/full; default: "compact" |
| treeTimeoutMs | integer | default: 5000; min: 100; max: 30000 |
| maxDepth | integer | default: 6; min: 0; max: 12 |
| maxNodes | integer | default: 500; min: 1; max: 3000 |

### list_windows

List top-level windows visible to Windows UI Automation.

| Argument | Type | Default / bounds |
|---|---|---|
| includeInvisible | boolean | default: false |
| maxWindows | integer | default: 50; min: 1; max: 200 |

### find

Find UIA elements by name, automation id, class, value or type. When UIA is sparse or incomplete and no match is found, automatically read visible text with OCR. OCR candidates have SCREEN coordinates and source:'ocr', not UIA element ids. If the literal query misses, inspect ocr.lines and reformulate using the visible text (a search box may say '大家都在搜').

| Argument | Type | Default / bounds |
|---|---|---|
| query | string | required |
| scope | string | active_window/desktop; default: "active_window" |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| treeTimeoutMs | integer | default: 5000; min: 100; max: 30000 |
| controlType | string |  |
| ocrFallback | boolean | default: true |
| maxDepth | integer | default: 8; min: 0; max: 12 |
| maxNodes | integer | default: 1200; min: 1; max: 5000 |
| maxResults | integer | default: 25; min: 1; max: 200 |

### element_info

Return UI Automation information for an element id or a screen point.

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string |  |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| detailLevel | string | compact/full; default: "compact" |
| x | integer |  |
| y | integer |  |

### click

Click a screen coordinate or the center of a UI Automation element. dispatch:'auto' (default) = a left click on an element runs in the background (BM_CLICK on a Win32 button, else its UIA Invoke/Toggle pattern); a coordinate click is real SendInput input: the target comes forward for it, a point that shows another window is refused (POINT_COVERED), then the pointer and the foreground go back; dispatch:'background' = PostMessage into the target window's queue (no foreground steal, delivery unverified — Chromium/Electron/UWP may drop it, then retry with foreground); dispatch:'foreground' = always foreground SendInput. Raw-coordinate clicks home-correct if the target window moved since it was observed (reported as 'homed').

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string |  |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| x | integer |  |
| y | integer |  |
| button | string | left/right/middle; default: "left" |
| dispatch | string | auto/background/foreground; default: "auto" |

### double_click

Double click a screen coordinate or the center of a UI Automation element. Supports the same dispatch modes as click (background posts a real WM_LBUTTONDBLCLK).

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string |  |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| x | integer |  |
| y | integer |  |
| button | string | left/right/middle; default: "left" |
| dispatch | string | auto/background/foreground; default: "auto" |

### move

Move the mouse pointer to a screen coordinate or the center of an element.

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string |  |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| x | integer |  |
| y | integer |  |

### drag

Drag through a path of screen coordinates.

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| path | array | min items: 2; required |
| button | string | left/right/middle; default: "left" |

### scroll

Scroll at a screen coordinate or an element. An element scrolls in the background first (WM_VSCROLL/WM_HSCROLL on a Win32 control with its own scroll bar, else the UIA ScrollPattern of the element or of its nearest scrolling ancestor) and reports scrollPercent before/after; otherwise the wheel is real input at the point, with the foreground and pointer given back. Positive deltaY scrolls down; 120 is one wheel notch, which scrolls the lines set for the wheel in Windows.

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string |  |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| x | integer |  |
| y | integer |  |
| deltaY | integer | default: 480 |
| deltaX | integer | default: 0 |

### type_text

Type text into the focused control of the target (or active) window. method:'auto' (default) = a focused Win32 edit takes the text in the background (EM_REPLACESEL at the caret: no clipboard, keyboard or foreground; text with line breaks is pasted instead); any other control gets a clipboard paste with the window borrowed for it (reliable for CJK; the clipboard is restored and the paste kept out of clipboard history); method:'clipboard' always pastes; method:'sendinput' sends each character as a KEYEVENTF_UNICODE SendInput event (no clipboard, best for ASCII/short text); method:'background' posts WM_CHAR straight into the target window's message queue — no clipboard, no foreground steal, delivery unverified. After a background write, or with a window target and focusMode:'main', the result includes verifyValue (the text control's value after typing, truncated to 200 chars).

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| text | string | required |
| method | string | auto/clipboard/sendinput/background; default: "auto" |
| focusMode | string | preserve/main; default: "preserve" |
| restoreClipboard | boolean | default: true |

### keypress

Press a key or key chord, such as Ctrl+L, Enter, Alt+F4, or Shift+Tab. The Windows key is blocked by design. The keys go to the target (or active) window, which comes forward for them and then gives the foreground back, unless a menu or dialog they opened is showing. dispatch:'background' supports only a single printable character (posted as WM_CHAR into the target window, no foreground steal); chords and functional keys must use dispatch:'foreground' (SendKeys).

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| keys | array | min items: 1; required |
| dispatch | string | foreground/background; default: "foreground" |

### focus

Set keyboard focus to a UI Automation element.

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string | required |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |

### invoke

Invoke a UI Automation element in the background: BM_CLICK on a Win32 button, else its Invoke, Toggle, SelectionItem, or ExpandCollapse pattern, with click fallback. action expands, collapses or scrolls the element into view instead: expand/collapse use ExpandCollapse only and leave an element already in that state as it is; scroll_into_view uses ScrollItem, so its container scrolls with no pointer. These actions are for UI Automation elements; a browser-lane page element id refuses them.

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string | required |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| action | string | default/expand/collapse/scroll_into_view; default: "default" |
| fallbackClick | boolean | default: true |

### set_value

Set a value in the background (EM_REPLACESEL on a Win32 edit, else the UI Automation ValuePattern), or focus and type as fallback.

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string | required |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| value | string | required |
| fallbackType | boolean | default: true |
| restoreClipboard | boolean | default: true |

### activate_window

Bring a top-level window to the foreground by title substring, process id, or native HWND. This tool always activates its target; the shared activate flag cannot suppress it.

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |

### wait

Wait for a short period before observing the UI again.

| Argument | Type | Default / bounds |
|---|---|---|
| milliseconds | integer | default: 500; min: 1; max: 30000 |

### ocr

Read visible text with Windows.Media.Ocr, independent of UIA by default. Returns text, lines and word boxes in SCREEN coordinates. query is literal text matching, not semantic recognition; inspect lines if 'search' misses a placeholder. Click matched.word.x/y using foreground dispatch, then type_text with focusMode:'preserve'. Optional resolveControl performs a potentially blocking UIA hit-test; its control may be the whole page rather than the text input.

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| scope | string | active_window/desktop; default: "active_window" |
| maxWidth | integer | default: 1920; min: 0; max: 7680 |
| resolveControl | boolean | default: false |
| includeScreenshot | boolean | default: false |
| query | string |  |

### screenshot

Capture a window or desktop without querying UIA. Returns an image plus bounds and imageScale for mapping image pixels to SCREEN coordinates: screen = bounds origin + image / imageScale. Use when the accessibility provider is unavailable, or to locate icons visually. Capture does not prove an action succeeded; inspect the resulting state.

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| scope | string | active_window/desktop; default: "active_window" |
| maxWidth | integer | default: 1600; min: 0; max: 7680 |

### wait_for

Wait for a window, a UIA element, or literal visible OCR text to appear/disappear. condition:'window' uses native window enumeration; 'element' uses a bounded UIA query; 'text' uses OCR without UIA. Returns verification:'observed' only when the condition was observed; truncated UIA absence is inconclusive. Text is literal, so use the actual expected text, not an inferred semantic label.

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| condition | string | window/element/text; default: "window" |
| query | string |  |
| controlType | string |  |
| scope | string | active_window/desktop; default: "active_window" |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| treeTimeoutMs | integer | default: 1000; min: 100; max: 30000 |
| maxDepth | integer | default: 8; min: 0; max: 12 |
| maxNodes | integer | default: 1200; min: 1; max: 5000 |
| appear | boolean | default: true |
| timeoutMs | integer | default: 5000; min: 100; max: 60000 |
| intervalMs | integer | default: 250; min: 50; max: 5000 |

### close_window

Close a window gracefully by posting WM_CLOSE (the app can veto with a save dialog). Safer than killing the process; use close_window instead of alt+f4 when the app may have unsaved state you want to handle. The shared activate flag is ignored: WM_CLOSE is posted in the background and needs no foreground switch.

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |

### move_window

Move (not resize) a window to screen coordinates without activating it. Useful for arranging windows, and it also refreshes the homing cache for coordinate-based actions.

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| x | integer | required |
| y | integer | required |

## Browser lane

Chromium pages (Chrome, Edge, Brave) can be read and operated over the Chrome DevTools Protocol (CDP) instead of UI Automation. Everything happens inside the browser: no desktop pointer, keyboard focus, clipboard or window activation, so background tabs work. The lane adds no tool; it adds the `browserTab` argument and page element ids. `mcp/browser.mjs` implements it inside the Node server; the PowerShell backend is not involved.

### Where pages come from

| Source | How it connects | What its tabs can see |
|---|---|---|
| agent | The first `set_value` on `new-tab` starts the browser chosen in settings (`browserApp`: by default the Windows default browser, and Chrome, then Edge, when that is neither) in a visible background-created window under `%LOCALAPPDATA%\dsh-computer-use-win\agent-browser`, with `--disable-sync`, `--disable-extensions` and `--mute-audio`, its frame tinted DSH blue (`--install-autogenerated-theme=65,118,230`); calls that arrive while it starts share that launch. The browser is a child of the server process and closes after 10 idle minutes. By default every launch gets a fresh profile `profile-<server pid>-*`; profiles of servers that are gone are removed at the next launch, while the profile of a live server, or one whose lockfile a browser still holds, is left alone. With `browserSignIn` on, the browser runs on one kept profile per browser, `kept-edge` or `kept-chrome`, with `--restore-last-session` (session cookies stay; with no startup window no tabs reopen, and the session files are removed before each launch so a headless browser reopens none either) and `--hide-crash-restore-bubble`. A browser still running on the kept profile, found through its `DevToolsActivePort`, is used instead of a second launch, which would only hand its window to that browser; `dsh-server-pid` names the server that closes it, and another live server only shares it. A port file whose browser is gone is removed. When the server ends because its input closed, it closes a kept-profile browser with `Browser.close` and waits up to 3 s, so cookies set in the last half minute are written; a browser whose DevTools connection drops gets the same 3 s to exit before it is killed. | Throwaway profile: tabs run in an isolated browser context (`Target.createBrowserContext`): none of the profile's cookies, sign-ins or history. Edge signs a new profile in to the Windows Microsoft account on its own; that sign-in stays outside the isolated context. Kept profile: tabs run in the profile's own context, with the sign-ins the user made in that window and, on Edge, the Windows Microsoft account's sign-in. |
| configured | `WCU_BROWSER_CDP_URL` (a `ws://` DevTools URL, or `http://host:port`). | That browser's own state. |

### Ids

| Id | Meaning |
|---|---|
| `t1a2b` | A tab, from `list_windows` → `browserLane.browsers[].tabs[].id`. Derived from the browser's target id and a salt of the server run: a tab keeps its id while the server runs, and after a server restart every tab gets a new one, so an id kept from before fails with `BROWSER_TAB_NOT_FOUND`. |
| `t1a2b:57` | An element in that tab. The number is handed out by the server run, never reused, and tied to the document it was read from. After the tab navigates, an id from the previous page fails with `BROWSER_ELEMENT_STALE`, even once the new page has been read: a new renderer numbers its DOM nodes from 1 again, so DOM node ids could name an element of the next page. An element removed from the page fails the same way. `web:t1a2b:57` is accepted too. |
| `t1a2b:address` | The tab's address. `set_value` with a web address navigates; text without a scheme that looks like a host gets `https://`. A search needs the site's own search URL. |
| `new-tab`, `b1c2d:new-tab` | `set_value` with a web address opens a background tab: `new-tab` in the agent browser, `b1c2d:new-tab` in that connected browser. |

### Tools

| Tool | With `browserTab` or a page element id |
|---|---|
| `snapshot`, `accessibility_tree` | The page as an accessibility outline: one line per element, `[id] role "name" value="…" (states)`. Unnamed wrappers are dropped, text merges within a line but never across paragraphs or boxes, and a label's text right before its control is dropped; `maxNodes` caps the lines. `snapshot` adds the viewport image unless `includeScreenshot` is false. |
| `find` | Elements whose name or value contains the query (case and whitespace ignored); `controlType` maps UIA names such as `Button`, `Edit` or `Hyperlink` to page roles. A match deep inside a long text shows the words around it. No OCR. |
| `element_info` | Tag, type, link, placeholder, value, checked, text (up to 4,000 characters) and the element's box in page pixels; for a text line, the element around the text. |
| `click`, `double_click`, `invoke` | Mouse events at the element's center inside the page, after scrolling it into view; a text line passes its click to the element around it. If another element would receive the click, the call fails with `BROWSER_ELEMENT_COVERED` and names it; layers with `pointer-events: none` do not count, as for a real pointer. A disabled element fails with `BROWSER_ELEMENT_DISABLED`. An option of a native drop-down (a `<select>` without `multiple` or `size`) has no box in the page, since the browser draws the list in a popup: a left click chooses it, the select fires input and change, and an open list closes; the result reports `chose`. A disabled option fails with `BROWSER_OPTION_DISABLED`. |
| `move` | Hover inside the page. |
| `focus` | DOM focus; an element that cannot take focus fails with `BROWSER_NOT_FOCUSABLE`. |
| `set_value` | Text fields and editable content: select all, then insert the text. Date, time, month, week, color and range inputs take the value whole; a number, date or time value the browser would drop fails with `BROWSER_VALUE_REJECTED`, and the field keeps its value. `<select>`: the option whose value or text matches; a multiple select takes one option per line, and an empty value clears it; a disabled option fails with `BROWSER_OPTION_DISABLED`. Checkbox and radio: `true` / `false`, and other words fail; a selected radio is cleared by selecting another option of its group. File input: absolute paths of existing files, one per line. A disabled or read-only control fails with `BROWSER_NOT_EDITABLE`. A label's text line stands for its control. |
| `type_text` | Insert the text at the page's focused field, found through open shadow roots and same-origin frames. Fails with `BROWSER_NO_FOCUSED_FIELD` when nothing editable has focus and with `BROWSER_NOT_EDITABLE` when the field is disabled or read-only. While a prompt is open, it sets the prompt's answer. |
| `keypress` | Key events inside the page, US layout (Shift+1 gives `!`). Alt+Left / Alt+Right / F5 / Ctrl+R go back, forward and reload. Enter accepts and Escape dismisses an open JavaScript dialog or leave-page prompt. Shortcuts of the browser window (Ctrl+L, Ctrl+T, Ctrl+W, …) fail with `BROWSER_UI_SHORTCUT`. |
| `scroll` | With an element: a wheel event at it; the result also reports the offset of the nearest box that scrolls by itself. With `browserTab` alone: the document scrolls, and a wheel at the viewport center is used only when the document cannot move. The result reports the page offset before and after. |
| `screenshot` | The tab's visual viewport without scroll bars, captured inside the browser. The stated width and height are the image's own; pixels are page pixels, not screen coordinates. A tab that is not painting (a background tab of a visible window, or a minimized window) answers a capture only while another one is pending, so the lane asks again every 0.5 s; it returned in 0.4–6 s on Chrome 155 and Edge 156, without activating or restoring the window. DSH's pointer is hidden for the capture. |
| `wait_for` | `element` and `text` conditions poll the page. |
| `activate_window` | Bring the tab to the front of its window. |
| `close_window` | Close the tab. If the page asks before it closes, the result reports the dialog; `keypress` Enter closes the tab, Escape keeps it. |

`browserTab` cannot be combined with `windowTitle`, `processId`, `nativeWindowHandle` or `x`/`y`.

After an action the server waits only for what the action started. A load it started gets up to 15 s for its document and up to 3 s more for the load event, so a page whose last resources never arrive still answers. Requests the action set off get up to 3 s, then the DOM has to stay quiet for 250 ms (up to 1.5 s). A navigation whose server has not answered within 15 s keeps running, and the result says `stillLoading` with `navigatingTo`. The result then returns what changed: `pageChange` is `diff` (added, changed and removed lines), `full` (after a navigation or a mostly new page) or `unchanged`. Results carry `verification: "sent"`: the page state after the action is evidence to check, not a judgement that the goal was met. They also report what the action set off beyond the page:

- `openedTabs`: a link or a script opened a tab; its id works as `browserTab`.
- `downloads`: file and state. The agent browser saves to `%LOCALAPPDATA%\dsh-computer-use-win\downloads`.
- `fileChooser`: an upload control was clicked. `set_value` on `fileChooser.input` with file paths uploads them; the agent browser never opens a file dialog.
- `stillLoading`, `tabClosed`.

An alert, confirm, prompt or leave-page dialog blocks the page. It is reported as soon as it opens, whichever call raised it: a click, a page load, a change handler run by `set_value`, a navigation away. Until it is answered, every call except `keypress` Enter/Escape, and `type_text` for a prompt, fails fast with `BROWSER_DIALOG_OPEN`. Actions in one tab run one at a time, in order; reads do not wait, and a call cancelled while it waits for its turn never runs. A crashed page fails with `BROWSER_TAB_CRASHED` until its address is loaded again. Only headless agent tabs are activated internally before actions/capture so they paint. Visible agent windows and user tabs are never automatically activated.

The visible agent browser shows what DSH does without covering the page, as Codex's Browser Use does. Its window frame is DSH blue. The tab DSH works in shows a blue arrow badge as its icon from the call's first command until the call ends and 2.5 s more, and in DSH for as long as the host holds the turn; then the page's own icon returns (a link the badge added is turned into a touch icon and removed, so Chrome drops it). A small glowing arrow moves to where DSH clicks, scrolls or types, with a ring on clicks. Both live in an isolated world: the arrow sits in a closed shadow root inside a `pointer-events: none`, `aria-hidden` element, its changes never reach the page's mutation observers, and screenshots hide it. A stopped call takes the badge off at once. A modal dialog holds page scripts, so the icon catches up when the dialog closes.

The outline header reminds the model that page content is untrusted. Content inside iframes is not part of the outline yet; the result reports how many iframes were skipped. Elements that have no accessible structure, such as a canvas, cannot be clicked by page coordinates.

### Environment

| Variable | Effect |
|---|---|
| `WCU_BROWSER_LANE=off` | Turn the lane off; `browserTab` and page ids fail with `BROWSER_LANE_UNAVAILABLE`. |
| `WCU_BROWSER_APP` | `default`, `edge` or `chrome`: the browser the lane runs. DSH setting `browserApp` sets it. |
| `WCU_BROWSER_SIGNIN=1` | The agent browser keeps one profile per browser (`kept-edge`, `kept-chrome` under `WCU_BROWSER_PROFILE`), so sites signed in to there stay signed in. DSH setting `browserSignIn` sets it; off by default. |
| `WCU_BROWSER_EXE` | The browser executable the agent browser runs, overriding `WCU_BROWSER_APP`. |
| `WCU_BROWSER_HEADLESS=1` | Opt in to headless agent browsing. Default is visible (`0`). DSH setting `browserVisible` controls this value. |
| `WCU_BROWSER_PROFILE` | Where agent profiles are created, kept ones included. |
| `WCU_BROWSER_DOWNLOADS` | Where the agent browser saves downloads. |
| `WCU_BROWSER_CDP_URL` | Connect to this DevTools endpoint as well. |

`health` reports the lane: whether it is enabled, the chosen and resolved browser, whether sign-ins are on, the agent browser executable, the endpoints found and the browsers connected.

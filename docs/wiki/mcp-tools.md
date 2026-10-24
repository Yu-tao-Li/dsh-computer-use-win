# MCP tools for DeepSeek Harness

The Node server enforces the same schemas returned by tools/list. Unknown properties, wrong types and out-of-range values fail before backend execution. Tool names are prefixed windows_computer_use_; the DSH bridge typically adds mcp__wincu__.

## Observation and task verification

Prefer scoped UIA observations. find supplements an empty sparse (at most 20 nodes, a heuristic) or incomplete search with OCR, unless ocrFallback:false or controlType is specified. OCR candidates are recognized text and screen coordinates, not UIA ids. Inspect ocr.lines if a literal query misses a placeholder.

screenshot and default OCR do not resolve UIA. An unobstructed foreground window uses a screen crop checked before and after capture; background/covered windows use window-capture fallbacks. OCR resolveControl:true opts into hit-testing; its control may represent the whole page. includeScreenshot:true returns MCP image content. Map image pixels to screen = imageBounds origin + image / imageScale. Screen-region captures report occludedPossible:false only when the foreground, Z-order and geometry checks passed; the last-resort screen fallback reports true.

After a coordinate click, type_text preserves focus. Explicit focusMode:main requests heuristic main-control focus. Input actions only report verification:sent; use wait_for for an expected window, UIA element or literal visible text. A confirmed condition reports verification:observed; truncated UIA absence and occluded OCR are inconclusive. Confirm text that exists only after the desired effect, rather than the same text just typed.

Tree watchdogs allow treeTimeoutMs + 10 seconds. A timeout retires the worker; an independently captured image remains supplemental to the explicit UIA error. Input is never replayed. Queue deadlines begin at actual dispatch. Observed RuntimeIds are cached for five minutes, at most 6000 references, with native owner checks; unknown/stale ids require a scoped re-observation.

No visual model is bundled. A vision-capable caller or external parser can consume screenshot content and send coordinates to the guarded input tools.

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

Capture a screenshot and a UI Automation tree for the active window or desktop.

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

Read the UI Automation tree without taking a screenshot.

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

Click a screen coordinate or the center of a UI Automation element. dispatch:'auto' (default) = element clicks use the UIA Invoke/Toggle pattern in the background (no foreground steal), coordinate clicks use foreground SendInput; dispatch:'background' = PostMessage into the target window's queue (no foreground steal, delivery unverified — Chromium/Electron/UWP may drop it, then retry with foreground); dispatch:'foreground' = always foreground SendInput. Raw-coordinate clicks home-correct if the target window moved since it was observed (reported as 'homed').

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

Scroll at a screen coordinate or element center. Positive deltaY scrolls down.

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

Type text into the focused control. method:'clipboard' (default) uses clipboard paste (reliable for CJK, restores the clipboard) and needs the target in the foreground; method:'sendinput' sends each character as a KEYEVENTF_UNICODE SendInput event (no clipboard, needs the target in the foreground, best for ASCII/short text); method:'background' posts WM_CHAR straight into the target window's message queue — no clipboard, no foreground steal, delivery unverified. With a window target the result includes verifyValue (the text control's value after typing, truncated to 200 chars).

| Argument | Type | Default / bounds |
|---|---|---|
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| text | string | required |
| method | string | clipboard/sendinput/background; default: "clipboard" |
| focusMode | string | preserve/main; default: "preserve" |
| restoreClipboard | boolean | default: true |

### keypress

Press a key or key chord, such as Ctrl+L, Enter, Alt+F4, or Shift+Tab. The Windows key is blocked by design. dispatch:'background' supports only a single printable character (posted as WM_CHAR into the target window, no foreground steal); chords and functional keys must use dispatch:'foreground' (SendKeys).

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

Invoke a UI Automation element through Invoke, Toggle, SelectionItem, or ExpandCollapse patterns, with click fallback.

| Argument | Type | Default / bounds |
|---|---|---|
| elementId | string | required |
| windowTitle | string |  |
| processId | integer | min: 1 |
| nativeWindowHandle | integer | min: 1 |
| activate | boolean | default: false |
| viewMode | string | control/content/raw; default: "control" |
| includeOffscreen | boolean | default: false |
| fallbackClick | boolean | default: true |

### set_value

Set a UI Automation ValuePattern value, or focus and type as fallback.

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
| agent | The first `set_value` on `new-tab` starts Chrome (Edge if Chrome is missing) headless on a fresh profile under `%LOCALAPPDATA%\dsh-computer-use-win\agent-browser`, with `--disable-sync` and `--mute-audio`. The browser is a child of the server process, exits with it, and closes after 10 idle minutes; leftover profiles are removed at the next launch. | Tabs run in an isolated browser context (`Target.createBrowserContext`): none of the profile's cookies, sign-ins or history. Edge signs a new profile in to the Windows Microsoft account on its own; that sign-in stays outside the isolated context. |
| remote-debugging | A `DevToolsActivePort` file in the default user data directory of Chrome, Edge, Brave or Chromium (all channels), present once the user allows remote debugging (Chrome 144+: `chrome://inspect/#remote-debugging`). The connection starts in the background, so a browser waiting for the user's consent never delays `list_windows`; a failed endpoint is retried after a minute. Not yet tested with a real browser. | The user's own state: sign-ins, cookies, open tabs. Browser pages such as settings are not listed or operated. |
| configured | `WCU_BROWSER_CDP_URL` (a `ws://` DevTools URL, or `http://host:port`). | That browser's own state. |

### Ids

| Id | Meaning |
|---|---|
| `t1a2b` | A tab, from `list_windows` → `browserLane.browsers[].tabs[].id`. Derived from the browser's target id, so it stays the same after a server restart. |
| `t1a2b:57` | An element in that tab (its DOM backend node id). Valid until the element leaves the page; a stale id fails with `BROWSER_ELEMENT_STALE`. `web:t1a2b:57` is accepted too. |
| `t1a2b:address` | The tab's address. `set_value` with a web address navigates; text without a scheme that looks like a host gets `https://`. A search needs the site's own search URL. |
| `new-tab`, `b1c2d:new-tab` | `set_value` with a web address opens a background tab in the agent browser, or in that connected browser. |

### Tools

| Tool | With `browserTab` or a page element id |
|---|---|
| `snapshot`, `accessibility_tree` | The page as an accessibility outline: one line per element, `[id] role "name" value="…" (states)`, with unnamed wrappers dropped and adjacent text merged; `maxNodes` caps the lines. `snapshot` adds the viewport image unless `includeScreenshot` is false. |
| `find` | Elements whose name or value contains the query (case and whitespace ignored); `controlType` maps UIA names such as `Button`, `Edit` or `Hyperlink` to page roles. No OCR. |
| `element_info` | Tag, type, link, placeholder, value, checked, text and the element's box in page pixels. |
| `click`, `double_click`, `invoke` | Mouse events at the element's center inside the page, after scrolling it into view. If another element would receive the click, the call fails with `BROWSER_ELEMENT_COVERED` and names it. |
| `move` | Hover inside the page. |
| `focus` | DOM focus. |
| `set_value` | Text fields and editable content: select all, then insert the text. `<select>`: the option whose value or text matches. Checkbox and radio: `true` / `false`. |
| `type_text` | Insert the text at the page's focused field; fails with `BROWSER_NO_FOCUSED_FIELD` when nothing editable has focus. |
| `keypress` | Key events inside the page. Alt+Left / Alt+Right / F5 / Ctrl+R go back, forward and reload. Enter accepts and Escape dismisses an open JavaScript dialog. Shortcuts of the browser window (Ctrl+L, Ctrl+T, Ctrl+W, …) fail with `BROWSER_UI_SHORTCUT`. |
| `scroll` | A wheel event at the element, or at the viewport center for `browserTab` alone; the result reports the page offset before and after. |
| `screenshot` | The tab's viewport, captured inside the browser; pixels are page pixels, not screen coordinates. |
| `wait_for` | `element` and `text` conditions poll the page outline. |
| `activate_window` | Bring the tab to the front of its window. |
| `close_window` | Close the tab; the page's beforeunload handler may still ask. |

`browserTab` cannot be combined with `windowTitle`, `processId`, `nativeWindowHandle` or `x`/`y`. After an action the server waits for a started navigation to load (up to 15 s) and for the DOM to stay quiet for 250 ms (up to 1.5 s), then returns what changed: `pageChange` is `diff` (added, changed and removed lines), `full` (after a navigation or a mostly new page) or `unchanged`. Results carry `verification: "sent"`: the page state after the action is evidence to check, not a judgement that the goal was met. An open alert, confirm or prompt blocks the page, so every call except `keypress` Enter/Escape fails fast with `BROWSER_DIALOG_OPEN`.

The outline header reminds the model that page content is untrusted. Content inside iframes is not part of the outline yet; the result reports how many iframes were skipped.

### Environment

| Variable | Effect |
|---|---|
| `WCU_BROWSER_LANE=off` | Turn the lane off; `browserTab` and page ids fail with `BROWSER_LANE_UNAVAILABLE`. |
| `WCU_BROWSER_EXE` | The browser the agent browser runs, instead of Chrome or Edge. |
| `WCU_BROWSER_HEADLESS=0` | Show the agent browser's window. |
| `WCU_BROWSER_PROFILE` | Where agent profiles are created. |
| `WCU_BROWSER_CDP_URL` | Connect to this DevTools endpoint as well. |

`health` reports the lane: whether it is enabled, the agent browser executable, the endpoints found and the browsers connected.

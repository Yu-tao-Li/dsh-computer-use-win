# MCP Tools

The MCP server is `windows-computer-use`, launched by:

```powershell
node .\mcp\server.mjs
```

The plugin `.mcp.json` uses Codex's plugin-local server map format:

```json
{
  "windows-computer-use": {
    "command": "node",
    "args": ["./mcp/server.mjs"]
  }
}
```

## Observation

### Window Targeting

Most observation and element-action tools accept optional target fields:

- `windowTitle`: case-insensitive substring of a top-level window title
- `processId`: process id of a top-level window
- `nativeWindowHandle`: HWND returned by `windows_computer_use_list_windows`
- `activate`: when true, bring the target window forward before reading or acting

`activate` is honoured wherever it changes the outcome: `drag`, `type_text`, `keypress` (input requires the foreground), element-target resolution in `snapshot` / `accessibility_tree` / `find` / `element_info` / `focus` / `invoke` / `set_value`, the x/y coordinate paths of `click` / `double_click` / `move` / `scroll` and `element_info` (coordinates hit whatever is physically under the point, so the target must come forward first), window capture in `ocr`, and `move_window` (the moved window takes the foreground). `close_window` ignores it (WM_CLOSE works in the background), and `activate_window` always activates regardless of the flag.

Use these fields when focus may move during a tool call. A reliable pattern is:

1. Call `windows_computer_use_list_windows`.
2. Pick the intended top-level window.
3. Pass `nativeWindowHandle` to `snapshot`, `find`, `element_info`, `move`, `click`, `focus`, `invoke`, and `set_value`.

### Tree View Options

Tree-reading tools accept:

- `viewMode`: `control`, `content`, or `raw`; default is `control`.
- `includeOffscreen`: include elements reported by UIA as offscreen; default is `false`.
- `detailLevel`: `compact` or `full` for `snapshot` and `accessibility_tree`; default is `compact`.

Use `control` for normal actions. Use `content` when reading visible text/content. Use `raw` with `includeOffscreen=true` only when a provider hides useful nodes from the control tree or when debugging a sparse/custom app.

These two options apply to scope resolution and tree walking. Legacy element ids (`uia:active.N...`, `uia:root.N...`) are view-relative path ids: if an id came from a non-default tree, pass the same `viewMode` and `includeOffscreen` to `element_info`, `move`, `click`, `double_click`, `scroll`, `focus`, `invoke`, or `set_value`. Ids of the form `uia:rt:*` (the form returned by today's trees) are looked up directly by RuntimeId and bypass view filtering — the values are validated on every path, but they are not applied to a `uia:rt:*` lookup.

`windows_computer_use_health`

Checks PowerShell, UI Automation, screenshot capture, active window metadata, and virtual screen bounds.

`windows_computer_use_snapshot`

Captures a screenshot and a bounded UI Automation tree.

Arguments:

- `scope`: `active_window` or `desktop`
- `viewMode`: `control`, `content`, or `raw`
- `includeOffscreen`: boolean
- `detailLevel`: `compact` or `full`
- `includeScreenshot`: boolean
- `maxDepth`: tree depth
- `maxNodes`: traversal cap

`windows_computer_use_accessibility_tree`

Reads the UI Automation tree without screenshot capture.

Arguments match `snapshot` except `includeScreenshot`.

`windows_computer_use_list_windows`

Lists top-level desktop windows.

`windows_computer_use_find`

Searches name, automation id, class name, control type, localized control type, and value text.

`find` honors `viewMode` and `includeOffscreen`. It internally uses full detail while scanning so ValuePattern text is searchable, but returns result objects without child trees.

`windows_computer_use_element_info`

Reads element details by `elementId`, or by point with `x` and `y`.

`windows_computer_use_activate_window`

Brings a target top-level window to the foreground by `windowTitle`, `processId`, or `nativeWindowHandle`.

## Pointer Actions

`windows_computer_use_move`

Moves the pointer to an element center or coordinate.

`windows_computer_use_click`

Clicks an element center or coordinate.

`windows_computer_use_double_click`

Double-clicks an element center or coordinate.

`windows_computer_use_drag`

Drags through a list of points.

`windows_computer_use_scroll`

Scrolls at an element center or coordinate. Positive `deltaY` scrolls down.

## Keyboard and Text

`windows_computer_use_type_text`

Pastes text into the currently focused control. The backend uses the clipboard for Unicode reliability and restores prior text clipboard content by default.

`windows_computer_use_keypress`

Sends key chords through `SendKeys`. Examples:

- `["Ctrl", "L"]`
- `["Enter"]`
- `["Alt", "F4"]`
- `["Shift", "Tab"]`

## Structured UI Automation Actions

`windows_computer_use_focus`

Sets keyboard focus to an element.

`windows_computer_use_invoke`

Tries UIA patterns in this order: Invoke, Toggle, SelectionItem, ExpandCollapse. It can click the element center as fallback.

`windows_computer_use_set_value`

Uses ValuePattern to set editable control values. If ValuePattern is absent and fallback is enabled, it focuses, selects all, and types.

## OCR

`windows_computer_use_ocr`

Recognizes a window or the desktop with Windows.Media.Ocr. `lines[].words[]` retain the engine's word boxes; `lines[].boundingBox` contains their union, in screen coordinates (or `null` when there are no valid word boxes).

`query` matches within each line's word sequence, ignoring case and whitespace in both the recognized words and the query. This supports CJK characters segmented into individual words, as well as multiword Latin text. Punctuation remains significant. A query containing only whitespace has no matches.

The first match in each line is returned, up to three lines. `matched[].boundingBox` covers the words intersecting the match; a partial-word match includes that word's full box. `matched[].word.text` contains the matched word run, and the existing `word.x/y` fields give its center. UIA is queried at that center; `control` is `null` when the lookup is unavailable, but the OCR match and rectangle remain usable.

## Timing

`windows_computer_use_wait`

Waits for a bounded number of milliseconds. Use after actions that trigger animations, app launches, or slow dialogs.

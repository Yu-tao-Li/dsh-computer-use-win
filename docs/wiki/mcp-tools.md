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

Element ids are view-relative path ids. If an id came from a non-default tree, pass the same `viewMode` and `includeOffscreen` to `element_info`, `move`, `click`, `double_click`, `scroll`, `focus`, `invoke`, or `set_value`.

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

## Timing

`windows_computer_use_wait`

Waits for a bounded number of milliseconds. Use after actions that trigger animations, app launches, or slow dialogs.

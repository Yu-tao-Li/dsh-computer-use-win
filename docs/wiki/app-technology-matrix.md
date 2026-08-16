# App Technology Matrix

Windows desktop apps expose accessibility through different provider stacks. The plugin uses Microsoft UI Automation as the shared observation layer, but the tree shape varies by app technology.

## UIA Views

Microsoft UI Automation defines three practical tree views:

- `control`: UI elements that matter as controls. This is the default because it maps best to buttons, lists, tabs, menus, text boxes, and windows an agent can operate.
- `content`: end-user content. This can be smaller for reading-oriented tasks, but it can hide structural controls that are needed for automation.
- `raw`: provider internals. This is useful for debugging sparse or strange apps, but it often includes hidden menus, inactive tabs, layout panels, and implementation nodes.

The plugin defaults to `viewMode="control"`, `includeOffscreen=false`, and `detailLevel="compact"`. To reproduce the first version's heavier behavior, call tree tools with `viewMode="raw"`, `includeOffscreen=true`, and `detailLevel="full"`.

## Technology Notes

| App technology | Typical UIA shape | Best default | Notes |
| --- | --- | --- | --- |
| Win32 common controls | Stable windows and controls, often shallow | `control` | Good fit for `find`, `invoke`, `set_value`, and coordinate fallback. |
| WinForms | Usually exposes named controls and values | `control` | Control ids/classes can be verbose, but element paths are stable while the form is unchanged. |
| WPF | Usually rich UIA roles and patterns | `control` or `content` | `content` is useful for reading; `control` is better before actions. |
| UWP/WinUI | Rich tree, sometimes wrapped by `ApplicationFrameWindow` | `control` | The launched process can differ from the top-level window process; prefer HWND targeting. |
| Electron/Chromium/Tauri | Browser accessibility tree inside a native host window | `control` | Trees can be deep and can include hidden web views. Prefer `find`; use `raw` only for missing nodes. |
| Mozilla/XUL apps such as Thunderbird | Browser-like tree plus many hidden menus and panels | `control`, `includeOffscreen=false` | Raw traversal is especially noisy because hidden popups and inactive panels are present in the provider tree. |
| Custom canvas/game/PDF views | Sparse or visual-only tree | screenshot plus coordinates | Use UIA for window targeting, then screenshot and coordinate actions. |

## Implementations in Other Tools

Other Windows automation stacks use the same general pattern: accessibility first, then scoped search, then action.

- Microsoft UI Automation documents raw, control, and content views as different projections of the desktop automation tree: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-treeoverview
- OpenAI Codex Computer Use documents the macOS model as Screen Recording for seeing apps and Accessibility for clicking, typing, and navigation: https://developers.openai.com/codex/app/computer-use
- pywinauto's UIA backend wraps Windows UI Automation and encourages locating controls through window specs and identifiers instead of dumping every raw descendant: https://pywinauto.readthedocs.io/en/latest/getting_started.html
- FlaUI wraps Microsoft UIA2/UIA3 for .NET and centers automation around elements, searches, and interactions: https://github.com/FlaUI/FlaUI
- Appium Windows Driver exposes UWP, WinForms, WPF, and Win32 apps through an Appium/WebDriver model backed by Microsoft's WinAppDriver server: https://github.com/appium/appium-windows-driver
- Playwright historically exposed accessibility snapshots with an "interesting nodes" default and its ARIA snapshot workflow treats accessibility output as a filtered test surface: https://playwright.dev/docs/api/class-accessibility and https://playwright.dev/docs/aria-snapshots
- Electron exposes Chromium accessibility support through platform accessibility APIs, so native automation sees web-derived roles inside a host window: https://www.electronjs.org/docs/latest/api/app

## Current Test Coverage

The safe live smoke test covers:

- Notepad: Win32/classic text editor.
- Calculator: UWP/WinUI packaged app.
- Paint: native Windows drawing app.
- File Explorer: Win32 shell window.
- WinForms Fixture: local .NET WinForms fixture.
- WPF Fixture: local .NET WPF fixture.

It intentionally avoids dandanplay, Steam Community, proxy/VPN/network tools, BT/resource download apps, and any app that could change the machine's network path.

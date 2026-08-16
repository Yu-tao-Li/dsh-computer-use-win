# Windows Computer Use Wiki

This wiki documents the Codex Windows Computer Use plugin.

## Pages

- [Architecture](architecture.md): component layout and control flow.
- [Mac Codex Computer Use Notes](mac-codex-computer-use.md): what is known, what is inferred, and how that maps to Windows.
- [App Technology Matrix](app-technology-matrix.md): Electron/Chromium, .NET, Win32, UWP/WinUI, Mozilla, and custom-rendered app behavior.
- [MCP Tools](mcp-tools.md): the tool contract exposed to Codex.
- [Safety](safety.md): permission, approval, and sensitive-action rules.

## Summary

The plugin mirrors the practical shape of Codex Computer Use on Windows: observe the GUI, read a scoped accessibility tree, perform scoped UI actions, and observe again. It uses Windows UI Automation as the structured accessibility layer and falls back to coordinate interaction for visual or canvas-heavy UI.

The default tree is optimized for agent use: `viewMode="control"`, `includeOffscreen=false`, and `detailLevel="compact"`. Use raw/offscreen/full trees only for debugging missing nodes or unusual custom providers.

Public OpenAI documentation states that Codex Computer Use on macOS asks for Screen Recording so Codex can see the target app and Accessibility so it can click, type, and navigate. The public docs do not publish the private implementation internals. This project therefore treats the macOS Accessibility API mapping as a strong engineering inference and implements the Windows equivalent with `System.Windows.Automation`.

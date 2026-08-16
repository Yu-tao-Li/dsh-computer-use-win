# Mac Codex Computer Use Notes

## Publicly Confirmed

OpenAI documentation for Codex Computer Use says:

- Computer Use is available on macOS at launch.
- Users install the Computer Use plugin in Codex settings.
- macOS prompts for Screen Recording and Accessibility permissions.
- Screen Recording lets Codex see the target app.
- Accessibility lets Codex click, type, and navigate.
- Codex asks for app-level approval before it can use an app.
- Computer Use can view screen content, take screenshots, and interact with windows, menus, keyboard input, and clipboard state.

Sources:

- https://developers.openai.com/codex/app/computer-use
- https://openai.com/index/codex-for-almost-everything/
- https://developers.openai.com/api/docs/guides/tools-computer-use

## Not Publicly Confirmed

The public docs do not state the private macOS implementation classes, binaries, or exact framework calls. In particular, they do not explicitly say "Codex uses AXUIElement".

## Engineering Inference

On macOS, Accessibility permission is the operating-system gate that allows assistive apps to inspect and operate other apps. The structured macOS API behind this class of capability is the Accessibility API, commonly used through `AXUIElement` and related APIs. Therefore it is reasonable to infer that Codex Computer Use uses macOS accessibility capabilities, but this repository does not claim private-source confirmation.

## Windows Mapping

The Windows equivalent to macOS Accessibility for app structure and controls is Microsoft UI Automation:

- macOS Screen Recording maps to Windows screenshot capture.
- macOS Accessibility app control maps to Windows UI Automation plus input injection.
- Codex app approvals map to skill-level and tool-use discipline in this local plugin.

This plugin implements the Windows side with `System.Windows.Automation` for structure and `user32.dll` plus `SendKeys` for input.


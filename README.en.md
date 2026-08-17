[中文](README.md)

# dsh-computer-use-win

[![CI](https://github.com/Yu-tao-Li/dsh-computer-use-win/actions/workflows/ci.yml/badge.svg)](https://github.com/Yu-tao-Li/dsh-computer-use-win/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/Yu-tao-Li/dsh-computer-use-win)](LICENSE)
![platform](https://img.shields.io/badge/platform-Windows-0078D6)
[![stars](https://img.shields.io/github/stars/Yu-tao-Li/dsh-computer-use-win?style=social)](https://github.com/Yu-tao-Li/dsh-computer-use-win)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**Windows computer use for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** — an MCP stdio server backed by a PowerShell + UI Automation engine. It lets the agent **see** the desktop (accessibility tree, window-cropped screenshots, OCR with word boxes) and **act** on it (mouse, keyboard, semantic UIA actions, window management) across 22 tools.

Bridges into DSH through the in-box `@deepseek-ai/dsh-mcp-client` — no DSH modifications. Zero runtime dependencies.

| Window-cropped capture + UIA tree (`snapshot`) | OCR fallback (CJK UI, word boxes in screen coordinates) |
|---|---|
| ![screenshot 1](assets/screenshot-1.png) | ![screenshot 2](assets/screenshot-2.png) |

## Features

- **Text-first observation** — UIA accessibility tree in three views (`control` / `content` / `raw`); find controls by name, automation id, class or value instead of guessing pixels. Element ids use UIA RuntimeIds (stable across UI refresh; stale ids report `stale` instead of mis-clicking).
- **Three-level screenshot chain** — `PrintWindow` (works on non-foreground windows) → **WGC** (`Windows.Graphics.Capture`, for DirectComposition/occluded windows) → screen-region fallback with an `occludedPossible` flag. Window crop + downscale + `imageScale`/`origin` coordinate mapping; PNGs auto-GC after 30 min.
- **Three input paths, honestly reported** — semantic (UIA `Invoke`/`Toggle`/`Value` patterns, no mouse), foreground (`SetCursorPos` + SendInput + clipboard paste / `KEYEVENTF_UNICODE`), background (PostMessage into the window queue, no foreground steal; delivery is unverified and reported as `verified:false` — Chromium/Electron/WinUI silently drop synthetic messages, and the tool tells you).
- **OCR fallback for UIA-blind apps** — `Windows.Media.Ocr` via a csc-compiled C# WinRT helper; returns text plus per-word screen-coordinate boxes, and upgrades a `query` match to the control under the matched word (`ControlFromPoint`).
- **Safety built in**
  - *Coordinate homing* — window moves after observation are compensated; the click reports `homed:{dx,dy}`.
  - *Failsafe panic brake* — park the physical mouse in the screen corner for 500 ms and all input is refused (`EMERGENCY STOP`); only a human moving the mouse releases it.
  - *Identity guard* — acting on a `windowTitle` whose HWND/PID changed since last observation is refused (`identity_changed`).
  - *Foreground verification* — typed input is fail-closed: if the target window is not truly foreground, the action errors instead of hitting the wrong app.
  - *Win-key blacklist* — `Win+R/X/L/S` style chords are refused by design.
- **Persistent backend** — one long-lived PowerShell process with a JSON-line protocol; hot latency 6–100 ms (first call ~500 ms cold). C# P/Invoke helpers compile once to hash-named cached DLLs.

## Install

```sh
# from GitHub (choose your profile)
dsh plugin --profile web add github:Yu-tao-Li/dsh-computer-use-win
# or from the dshmarket plugin market: search "dsh-computer-use-win"
```

Restart `dsh web`. The tools appear as `mcp__wincu__windows_computer_use_*`.

> The bundle resolves its own paths at install time (`cordis.patch.yml` uses `!!js` relative to the package dir), so it installs cleanly into any profile / `$DSH_HOME` — no hardcoded paths. Keep only one `serverName: wincu` row per profile.

## Tools (22, prefix `mcp__wincu__`)

| Group | Tools |
|---|---|
| Observe | `health` · `snapshot` (tree + screenshot) · `accessibility_tree` · `list_windows` · `find` · `element_info` · `ocr` |
| Act | `click` · `double_click` · `move` · `drag` · `scroll` · `type_text` (clipboard / sendinput / background) · `keypress` · `focus` · `invoke` · `set_value` |
| Window | `activate_window` · `move_window` · `close_window` (WM_CLOSE; the app may veto with a save dialog) · `wait_for` · `wait` |

Every tool accepts optional window targeting (`windowTitle` substring / `processId` / `nativeWindowHandle`) plus `activate: true`; untargeted calls act on the foreground window.

## Architecture

```
DSH agent
   │  sees mcp__wincu__windows_computer_use_* tools
   ▼
@deepseek-ai/dsh-mcp-client   ← DSH in-box bridge (official MCP SDK, StdioClientTransport)
   │  JSON-RPC 2.0 over stdio (newline-framed)
   ▼
mcp/server.mjs                ← this repo: MCP server (Node ≥ 22, zero deps)
   │  spawns one persistent backend; JSON-line stdio protocol
   ▼
scripts/windows-uia.ps1       ← this repo: desktop engine (PowerShell 5.1)
   ├─ UI Automation assemblies        → accessibility tree
   ├─ user32 P/Invoke (cached C# DLL) → mouse / keys / window ops
   ├─ Windows.Media.Ocr (C# WinRT)    → OCR
   └─ Windows.Graphics.Capture        → WGC window capture
```

## Safety & limitations

- **Actions are real.** Have the agent `snapshot` before sensitive operations; scope important windows with `windowTitle`.
- **WinUI / Chromium / Electron** drop PostMessage synthetic input (`verified:false` is honest reporting, not success). Use the foreground/clipboard paths for them.
- **Elevated windows** (UAC/admin) are not readable or clickable — Windows blocks both UIA and synthetic input.
- Coordinates are **physical pixels** (explicit Per-Monitor V2 DPI).
- OCR word boxes for CJK text are per-character (engine behavior) — fine for clicking.
- Windows only.

## Development

```
mcp/server.mjs        MCP stdio server + persistent backend manager
scripts/windows-uia.ps1  desktop engine (one-shot & -Persistent modes)
test/                 self-test / MCP protocol / Notepad E2E / features / benchmarks
docs/wiki/            upstream architecture docs (see THIRD_PARTY.md)
docs/dev-notes.md     design rationale, pitfalls, benchmarks, test log
```

```sh
node mcp/server.mjs --self-test          # full stack smoke test (Windows only)
node test/mcp-test.mjs                   # initialize → tools/list → tools/call
node test/notepad-e2e.mjs                # real input E2E (opens Notepad)
```

CI (`.github/workflows/ci.yml`) runs the self-test + protocol test on `windows-latest` for every push/PR.

## License

MIT — see [LICENSE](LICENSE). This project is a **derivative of [cgissing/windows-computer-use](https://github.com/cgissing/windows-computer-use)** (MIT); upstream copyright is preserved and detailed in [THIRD_PARTY.md](THIRD_PARTY.md).

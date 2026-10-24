# dsh-computer-use-win

**Let DSH read and operate your Windows desktop.**

[![npm](https://img.shields.io/npm/v/dsh-computer-use-win?label=npm&color=blue)](https://www.npmjs.com/package/dsh-computer-use-win) [![CI](https://github.com/Yu-tao-Li/dsh-computer-use-win/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Yu-tao-Li/dsh-computer-use-win/actions/workflows/ci.yml) ![Windows](https://img.shields.io/badge/platform-Windows-0078D6) [![MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Your [**Star ⭐ ↗**](https://github.com/Yu-tao-Li/dsh-computer-use-win) keeps me motivated to update this project. Please, it means a lot to me! Found a problem or have a wish? [**Open an Issue ↗**](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new) — **you make the wish, I’ll work on it!**

**语言 / Language:** [简体中文](#简体中文) · [English](#english)

[Releases](https://github.com/Yu-tao-Li/dsh-computer-use-win/releases) · [npm](https://www.npmjs.com/package/dsh-computer-use-win) · [Issues](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues)

---

## English

**New in 0.5.0: Lazy startup.** Select Lazy in Settings → Computer Use to start with one management tool and load desktop tools on demand. All tools remain allowed, and All remains the default preset. See [tool loading](docs/tool-context.md).

When the startup set is the management entry alone and at least one desktop tool is allowed — which is what Lazy startup does — the server returns an MCP handshake note that this machine can be read and operated and that tools must be enabled first. With no desktop tool name advertised at startup, the model still learns the capability exists.

Give a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent access to real Windows apps: find controls, inspect screenshots, read visible text, click, type and manage windows.

**23 desktop tools + 1 management entry · Visible control status · Esc stops the current turn · Chinese and English settings**

[Quick start](#quick-start) · [Interface tour](#interface-tour) · [What it can do](#what-it-can-do) · [Make it yours](#make-it-yours) · [Try a task](#try-a-task) · [Tools and options](#tools-and-options) · [FAQ](#faq) · [简体中文](#简体中文)

### Quick start

**Requires:** an interactive Windows desktop and DSH. Windows PowerShell 5.1, included with Windows, is the default backend. DSH Desktop uses its bundled Electron runtime; standalone Node hosts require Node.js ≥ 22.

1. Run this in **DSH Desktop's built-in terminal**:

   ```powershell
   dsh plugin --profile desktop add dsh-computer-use-win
   ```

2. Fully quit and restart DSH Desktop, then open **Settings → Computer Use**. The introduction in the plugin list also opens the complete settings page.
3. All tools are loaded by default. Start a desktop task, or choose Lite, Lazy or Custom in settings to load fewer tools.

Use the same install command to upgrade, then fully restart Desktop. Check which profile your host actually uses: installing into another profile does not update the active host's plugin.

<details>
<summary>Web, GitHub and standalone MCP clients</summary>

For DSH Web:

```powershell
dsh plugin --profile web add dsh-computer-use-win
```

Restart `dsh web` after installation. Replace `web` with your profile name when using another profile. You can also search the plugin marketplace for **dsh-computer-use-win**, or install from GitHub:

```powershell
dsh plugin --profile desktop add github:Yu-tao-Li/dsh-computer-use-win
```

A standalone MCP client can launch the stdio server:

```json
{
  "mcpServers": {
    "wincu": {
      "command": "npx",
      "args": ["-y", "dsh-computer-use-win"]
    }
  }
}
```

Standalone MCP loads all tools by default. Set `WCU_TOOL_MODE=lazy` for management-only startup, `WCU_TOOL_MODE=lite` for the Lite set, or provide a JSON array in `WCU_ENABLED_TOOLS`. The settings page, conversation display and turn-wide indicators require DSH. See [tool loading](docs/tool-context.md) for configuration details.

</details>

### Interface tour

These are real screenshots from **DSH Desktop 2.0.18 with plugin 0.4.3**, using the Chinese interface. In a separate demonstration conversation, the agent opened a new browser window, searched for “晴天” and confirmed “周杰伦” in the results. The images were recaptured as lossless PNGs at native pixel resolution, showing only the relevant conversation content or settings panel. Click an image to view the original.

**Actions in the conversation.** Expand tool calls to see mouse-icon rows for typing, key presses and result checks. Expand an action row for its Steps and screenshots entry.

![Real search demonstration: mouse-icon conversation rows for text input, key presses and result checks, with a steps and screenshots entry](assets/desktop-search-steps-hd.png)

**Tool loading.** Choose Lite, All or Custom first. This image shows only the dark settings panel, with the default All preset and its 24 tools.

![Computer Use settings panel: Star and Issue links, plus Lite, All and Custom tool presets](assets/desktop-settings-overview-hd.png)

<details>
<summary>See the search summary, custom tools, control indicators and stop settings</summary>

**Final conversation summary.** The agent describes the actions it took and the content it confirmed on the results page. The text below was generated by the model used for this task.

![Actual conversation summary after searching for 晴天: a new Edge window, the search query and confirmation that 周杰伦 appeared in the results](assets/desktop-search-result-hd.png)

**Custom tools.** Custom reveals the indented checklist with individual and group selection. The screenshot shows an unsaved demonstration draft, discarded after capture.

![Part of the expanded Custom checklist, with indented groups, select-all, disable-all and group selection](assets/desktop-settings-tools-custom-hd.png)

**Control indicators.** Choose screen and pointer indicators, remote visibility and placement. The blue area is the settings page's built-in illustration.

![Control indicator settings: screen and pointer indicators, remote and recording visibility, top or bottom placement, and the built-in illustration](assets/desktop-settings-indicators-hd.png)

**Stop settings.** Esc stops the current turn. Record an additional shortcut or restore the Esc default.

![Stop settings: Esc for the current turn, custom shortcut recording and restore default Esc](assets/desktop-settings-stop-hd.png)

</details>

### What it can do

| Your task | Available capabilities |
|---|---|
| Find windows, buttons and text fields | Native window discovery, UIA accessibility trees and control queries |
| Read custom interfaces, canvas content or screenshots | Windows OCR, text coordinates and screenshots; sparse UIA searches can fall back to OCR |
| Click, type and fill forms | UIA semantic actions, mouse/keyboard input and text pasting that preserves focus |
| Wait for changes and confirm results | Wait for a window, control or visible text, then read or capture the result |
| See what the agent is doing | Screen indicators, a DSH pointer badge, conversation steps and a final summary |

In DSH conversations, desktop calls use a mouse icon and readable descriptions. Expand them for steps and related screenshots; a summary collects the turn's actions. Sent input, verified effects, incomplete tasks and stopped operations are distinguished, and existing records are restored when reopening a conversation. Browser search summaries use actual input, submission and subsequent observations.

### Make it yours

Open **Settings → Computer Use**, make your choices and click Save changes. The interface supports light and dark themes. Saved values are confirmed and read back from the host; unavailable configuration is shown explicitly.

| Setting | Your choices |
|---|---|
| Tool loading | **All: 24** (default), **Lite: 10**, **Lazy: 1 at startup with all allowed**, or an expandable Custom checklist with individual/group selection, select-all and disable-all |
| Screen indicators | Toggle the screen edges/banner; customize text, top/bottom placement and a 200–3000ms delay before hiding after completion |
| Pointer indicator | Toggle the pointer glow/DSH tag independently of the screen indicator; overlays preserve your Windows cursor theme |
| Visible in remote sessions and recordings | On by default, including UU virtual displays; refreshes as active monitors, layout and DPI change |
| Custom stop shortcut | Click Record shortcut, press a key or combination such as F8 or Ctrl + Alt + K, and save; Restore default (Esc) clears the additional shortcut |
| Preview | Save, then preview the current screen and pointer indicators |

**Press Esc to stop the current turn.** Physical Esc or your custom shortcut stops that turn and its queued desktop actions. It cannot automatically retry in the same turn. A new task or a request to continue can use the desktop again without visiting settings. Ordinary mouse movement and other keys do not stop control. Hiding the indicators keeps the stop listener active.

**Indicators span a series of operations and clear when idle.** They appear with the first desktop call and stay through screenshots, reads and short reasoning gaps. They hide after the configured delay when the turn finishes, is cancelled or fails. After **30 idle seconds** following the last completed desktop call, they also hide and release ownership; the next call shows them again. Running tools do not count as idle. Standalone stdio clients use per-call indicators because they provide no DSH turn boundary.

Supported control actions prefer UIA, and pasting text does not reposition the mouse. Coordinate clicks and foreground input still share the Windows desktop. Another conversation receives a busy result while it is owned. Delivered actions cannot be undone, and a blocking application call must return before cancellation can finish.

Switching presets preserves your custom checklist. Saving applies changes after the current action finishes and persists them across restart. Agents cannot enable tools you disabled. See [settings and stopping](docs/computer-use-settings.md) for the complete behavior.

### Try a task

After installation, ask the agent to do something like:

> Type “Meeting notes” into Notepad, then read the text back to confirm it was entered.

> Calculate 25 × 4 in the open Calculator window and read the result.

> Open a browser, search for “Windows UI Automation”, confirm that results appeared, and summarize what you did.

> Open NetEase Cloud Music, search for “晴天”, and confirm that “周杰伦” appears in the results. If UIA cannot find the search box, use OCR to locate visible text.

A reliable sequence is **observe → locate → act → confirm**. `verification: "sent"` means input was dispatched; `wait_for` returning `verification: "observed"` means the specified condition was observed. Check the actual effect required by the task. Results depend on the target app, model and current page state.

<details>
<summary>Historical real-world demo: searching NetEase Cloud Music (0.3.1)</summary>

Two cold-start runs in an isolated Windows 11 VM completed **open app → locate with OCR → enter “晴天” → confirm “单曲” and “周杰伦”**. The app in the screenshot is signed out.

![Historical test: signed-out NetEase Cloud Music showing search results for 晴天 and artist 周杰伦](assets/netease-qingtian-search.png)

This was a programmatic 0.3.1 test through the official Cordis / ToolRuntime / MCP bridge. No model participated and playback was not tested. The environment was Windows 11 22621.4112, PowerShell 5.1, 2560×1600 at 150% DPI, and NetEase Cloud Music 3.1.41.205529. See the [0.3.1 release](https://github.com/Yu-tao-Li/dsh-computer-use-win/releases/tag/v0.3.1) and [test notes](docs/dev-notes.md).

</details>

### Tools and options

There are **23 desktop tools + 1 management entry**. Short names appear below; complete names use `windows_computer_use_<name>`, usually prefixed with `mcp__wincu__` in DSH.

<details>
<summary>Full tool list and usage tips</summary>

| Purpose | Tools |
|---|---|
| Connection and window discovery | `health` · `list_windows` |
| UIA observation | `snapshot` · `accessibility_tree` · `find` · `element_info` |
| Visible content | `screenshot` · `ocr` |
| Mouse | `click` · `double_click` · `move` · `drag` · `scroll` |
| Text and controls | `type_text` · `keypress` · `focus` · `invoke` · `set_value` |
| Window management | `activate_window` · `move_window` · `close_window` |
| Waiting and verification | `wait_for` · `wait` |
| Tool management | `tools` |

Lite includes `list_windows`, `find`, `click`, `scroll`, `type_text`, `keypress`, `ocr`, `screenshot`, `wait_for` and `tools`. With management enabled, agents can inspect tool descriptions and temporarily unload or reload tools you have allowed. `reset` restores your saved startup set. Unloading does not erase definitions or results already in conversation history.

Prefer UIA and `invoke` / `set_value` when controls are accessible. Use OCR when the tree is sparse or finds no match, and let a vision-capable caller inspect screenshots for icons or layout. OCR candidates contain text and physical screen coordinates, not fabricated UIA IDs. Observe again after windows move or controls become stale.

[Parameters and results](docs/wiki/mcp-tools.md) · [On-demand loading and client compatibility](docs/tool-context.md) · [App technology differences](docs/wiki/app-technology-matrix.md)

</details>

### FAQ

<details>
<summary>Installed, but no tools/settings or still running an old version?</summary>

Check the active profile, tool preset and install location, then fully restart the host. Verify the version through MCP `initialize.serverInfo.version`; with All selected, `health` can also check the connection. Keep one `serverName: wincu` service per profile. Back up any temporary duplicate overrides from older versions before following the [upgrade notes](docs/computer-use-settings.md).

Version 0.4.3 fixes settings reads, saves and previews on mixed-version Desktop hosts. An unavailable form shows its state. For an issue report, include the Desktop, dsh core and plugin versions, plus sanitized error text.

</details>

<details>
<summary>Why did a click or input have no effect?</summary>

Check that the intended target is in the foreground, unobstructed and responsive. Chromium, Electron and some WinUI controls may ignore background input. Prefer UIA or foreground input with an explicit target, then observe the result. Windows privilege isolation can block elevated windows or the UAC secure desktop. An accessible interactive desktop is required.

</details>

<details>
<summary>What about PowerShell 7, other operating systems or bundled vision models?</summary>

Windows only. PowerShell 5.1 is the default and verified path for real WinRT OCR. CI covers PowerShell 5.1 / 7; real PowerShell 7 tests cover UIA and screenshots, while OCR uses deterministic protocol tests. That does not establish real WinRT OCR support under PowerShell 7.

The plugin supplies desktop tools, without a model, API key, OmniParser or UI-TARS. A vision-capable model or separate parser can consume screenshots and pass locations to the tools.

</details>

### Data and privacy

UIA, OCR, capture and input execute locally. Results are passed to DSH or the MCP caller; whether desktop content is then sent to a remote model depends on the host, model and service configuration. Screenshots and visible text may include sensitive window contents. Redact accounts, paths, credentials and private conversations before sharing logs or issues.

### Documentation and development

[Settings and stopping](docs/computer-use-settings.md) · [Tool loading](docs/tool-context.md) · [Tool reference](docs/wiki/mcp-tools.md) · [Architecture](docs/wiki/architecture.md) · [Test notes](docs/dev-notes.md) · [Changelog](CHANGELOG.md)

<details>
<summary>Development and validation</summary>

```text
DSH agent → official MCP bridge → Node MCP server → persistent PowerShell backend
                                                  ├ UI Automation
                                                  ├ mouse / keyboard / windows
                                                  └ capture / Windows OCR
```

```powershell
npm ci
npm test
```

The standalone MCP server has no third-party runtime dependencies. The DSH adapter uses the host's Schemastery and official MCP bridge; development dependencies are for testing. **25 isolated regression suites** cover settings compatibility, control lifecycle, cancellation, UIA, capture, OCR protocols and input boundaries. `npm test` sends no physical input and does not change installed DSH profiles. Live UIA tests operate only on dedicated fixture windows; logs go to the temporary directory printed by the command.

`node test/notepad-e2e.mjs` is a separate real-input test that opens Notepad. Run it on a dedicated test desktop. See the compatibility note above for what each PowerShell version validates.

</details>

MIT licensed. Derived from [cgissing/windows-computer-use](https://github.com/cgissing/windows-computer-use); see [THIRD_PARTY.md](THIRD_PARTY.md) for attribution and copyright.

[Plugin marketplace](https://awesome-dsh-plugin.com) · [Releases](https://github.com/Yu-tao-Li/dsh-computer-use-win/releases) · [Report an issue](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues) · [Back to English ↑](#english)

---

## 简体中文

**0.5.0 新增懒启动**：在“设置 → Computer Use”选择“懒启动”，启动只加载 1 项管理工具，桌面工具按需加载，仍允许全部工具。现有默认方案保持“全部”。详见[工具加载](docs/tool-context.md)。

启动集合只剩管理入口、且至少允许一项桌面工具时（懒启动即属此类），服务随 MCP 握手返回一段说明：这台电脑可被读取和操作，使用前需先 `enable`。启动时一个桌面工具名都没有，模型也能据此知道该能力存在。

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 agent 读取并操作真实 Windows 应用：找控件、看截图、识别文字、点击、输入和管理窗口。

**23 项桌面能力 + 1 个工具管理入口 · 明确的控制提示 · 按 Esc 停止当前轮 · 中英文设置**

[快速开始](#快速开始) · [界面预览](#界面预览) · [能做什么](#能做什么) · [按你的习惯设置](#按你的习惯设置) · [使用示例](#使用示例) · [工具与进阶](#工具与进阶) · [常见问题](#常见问题) · [English](#english)

### 快速开始

**需要：** Windows 交互桌面和已安装的 DSH。默认使用系统自带的 Windows PowerShell 5.1；DSH Desktop 使用自带的 Electron 运行时，独立 Node 宿主需要 Node.js ≥ 22。

1. 在 **DSH Desktop 自带终端**中执行：

   ```powershell
   dsh plugin --profile desktop add dsh-computer-use-win
   ```

2. 完整退出并重新启动 DSH Desktop，打开 **设置 → Computer Use**。也可点击插件列表中的简介进入具体设置。
3. 默认全部加载，直接开始一个桌面任务；需要减少工具时，在设置里选择“精简”或“自定义”。

升级已有安装也使用同一条安装命令，随后完整重启 Desktop。安装与升级请核对宿主实际使用的 profile；安装到另一个 profile 不会改变当前宿主的插件。

<details>
<summary>Web、GitHub 与独立 MCP 客户端</summary>

DSH Web：

```powershell
dsh plugin --profile web add dsh-computer-use-win
```

安装后重启 `dsh web`。使用其他 profile 时，将 `web` 替换为对应名称。也可在插件市场搜索 **dsh-computer-use-win**，或使用 GitHub 源：

```powershell
dsh plugin --profile desktop add github:Yu-tao-Li/dsh-computer-use-win
```

独立 MCP 客户端可配置 stdio 服务：

```json
{
  "mcpServers": {
    "wincu": {
      "command": "npx",
      "args": ["-y", "dsh-computer-use-win"]
    }
  }
}
```

独立服务默认全部加载；`WCU_TOOL_MODE=lite` 使用精简集合，`WCU_ENABLED_TOOLS` 可指定 JSON 数组。DSH 专属的设置页、对话展示和整轮提示需要 DSH 宿主。更多配置见[工具加载说明](docs/tool-context.md)。

</details>

### 界面预览

以下为 **DSH Desktop 2.0.18 + 插件 0.4.3** 的真实界面。演示在独立会话中完成：新开浏览器窗口，搜索“晴天”，并确认结果中出现“周杰伦”。配图重新截取为原始像素的无损 PNG，仅保留相关对话内容或设置面板；点击图片可查看原图。

**对话中的操作记录。** 展开工具调用后，可看到带鼠标图标的“输入了文本”“发送了按键”“检查了操作结果”等记录，点击操作行可进入“查看步骤和截图”。

![真实搜索演示：DSH对话中带鼠标图标的输入、按键、结果检查记录，以及查看步骤和截图入口](assets/desktop-search-steps-hd.png)

**工具加载。** 外层先选精简、全部或自定义。下图仅截取暗色设置面板，展示默认加载全部 24 项工具的方案。

![Computer Use设置面板：Star和Issue入口，以及精简、全部、自定义三种工具加载方案](assets/desktop-settings-overview-hd.png)

<details>
<summary>查看搜索总结、自定义工具、接管提示与停止设置</summary>

**对话中的最终总结。** agent 说明实际执行过程和在结果页中确认的内容。下图的文字由本次任务使用的模型生成。

![浏览器搜索晴天后的真实对话总结：新建Edge窗口、输入搜索词，并确认周杰伦出现在结果中](assets/desktop-search-result-hd.png)

**自定义工具。** 选择“自定义”才展开缩进清单，可以逐项或按组选择。图中为尚未保存的演示草稿，拍摄后已放弃更改。

![自定义工具方案展开后的部分缩进清单，支持全选、全部关闭和分组选择](assets/desktop-settings-tools-custom-hd.png)

**接管提示。** 分别选择屏幕提示、鼠标标识和远程可见，也可调整提示位置。图中蓝色区域是设置页自带的示意预览。

![接管提示设置：屏幕与鼠标提示、远程和录屏可见、顶部或底部位置，以及内置示意预览](assets/desktop-settings-indicators-hd.png)

**停止设置。** Esc 停止当前轮；可录制额外快捷键，也可恢复默认 Esc。

![停止操作设置：Esc只停止当前轮、录制自定义快捷键，以及恢复默认Esc](assets/desktop-settings-stop-hd.png)

</details>

### 能做什么

| 你想完成的事 | 插件提供的能力 |
|---|---|
| 找到窗口、按钮和输入框 | 原生窗口枚举、UIA 无障碍树、控件查询 |
| 读取自绘界面、canvas 或截图中的文字 | Windows OCR、文字坐标、截图；稀疏 UIA 查询可自动补 OCR |
| 点击、输入和填写表单 | UIA 语义动作、鼠标键盘输入、保留焦点的文本粘贴 |
| 等待页面变化、确认操作效果 | 等待窗口、控件或可见文字，再读取或截图确认 |
| 看清 agent 正在做什么 | 屏幕提示、鼠标旁 DSH 标签、对话步骤与结束摘要 |

在 DSH 对话中，桌面工具使用鼠标图标和简洁描述，点击可展开步骤及相关截图，结束后汇总这一轮的操作。已发送、已验证、未完成和已停止会区分展示；重开对话可恢复已有记录。浏览器搜索摘要根据实际输入、提交和后续观察生成。

### 按你的习惯设置

在 **设置 → Computer Use** 中调整，点击“保存更改”后生效。界面适配明暗主题，保存结果会向宿主确认并回读；无法读取配置时会明确提示。

| 设置 | 你可以选择什么 |
|---|---|
| 工具加载 | **全部 24 项**（默认）、**精简 10 项**、**懒启动初始 1 项（允许全部）**，或展开“自定义”逐项／分组选取；支持全选和全部关闭 |
| 屏幕提示 | 开关屏幕边缘与提示条，设置文字、顶部／底部位置及结束后 200–3000 毫秒的隐藏延时 |
| 鼠标提示 | 相对屏幕提示独立开关，显示鼠标光斑和 DSH 标签；通过叠加层显示，保留系统光标主题 |
| 远程与录屏可见 | 默认开启，支持 UU 虚拟屏幕；随活动显示器、布局和 DPI 变化刷新 |
| 自定义停止方式 | 点击“录制快捷键”，按 F8、Ctrl + Alt + K 等按键或组合键并保存；“恢复默认（Esc）”清除额外快捷键 |
| 预览 | 保存后点击“预览接管提示”，检查当前屏幕和鼠标提示的效果 |

**按 Esc 停止当前轮。** 物理 Esc 和自定义快捷键会停止这一轮及排队的桌面操作，同一轮不会自动重试。下一次发起任务或发送“继续”即可再次操作，无需去设置里恢复。普通鼠标移动和其他按键不会触发停止；关闭提示仍保留停止监听。

**提示覆盖连续操作，也会及时收起。** 从首次桌面工具调用开始，提示覆盖截图、读取和短暂思考间隔；轮次完成、取消或失败后按隐藏延时收起。最后一次桌面调用完成后若空闲 **30 秒**，也会收起提示并释放占用，下一次调用重新显示；正在执行的工具不计为空闲。独立 stdio 客户端按单次调用显示，因为它没有 DSH 的轮次边界。

支持的控件动作优先使用 UIA，文本粘贴不额外移动鼠标。坐标点击和前台输入仍共享当前 Windows 桌面；另一段对话占用桌面时会返回忙碌状态。已送达应用的动作无法撤回，阻塞的应用调用需要先返回。

自定义清单在切换方案时保留，保存后在当前动作结束时应用，并在重启后保留。agent 无法启用用户关闭的工具。完整行为见[设置与停止说明](docs/computer-use-settings.md)。

### 使用示例

装好后，可以把这样的任务交给 agent：

> 在记事本中输入“会议纪要”，再读取文本确认写入成功。

> 在已打开的计算器中计算 25 × 4，并读取结果。

> 打开浏览器，搜索“Windows UI Automation”，确认出现搜索结果，并总结你做了什么。

> 打开网易云音乐，搜索“晴天”，确认结果页出现“周杰伦”。如果无障碍树看不到搜索框，用 OCR 定位可见文字。

一次可靠的操作是 **观察 → 定位 → 执行 → 确认结果**。`verification: "sent"` 表示输入已发送；`wait_for` 返回 `verification: "observed"` 表示观察到了指定条件。确认应针对任务真正产生的效果。目标应用、模型能力和当前页面都会影响结果。

<details>
<summary>历史实际演示：网易云音乐搜索《晴天》（0.3.1）</summary>

在独立 Windows 11 虚拟机中，两次冷启动完成 **打开应用 → OCR 定位 → 输入“晴天” → 确认“单曲”和“周杰伦”**。截图中的应用未登录。

![历史实测：未登录的网易云音乐中显示晴天搜索结果与歌手周杰伦](assets/netease-qingtian-search.png)

这是 0.3.1 通过官方 Cordis / ToolRuntime / MCP bridge 程序化执行的历史验证，没有模型参与，未验证播放。测试环境为 Windows 11 22621.4112、PowerShell 5.1、2560×1600、150% DPI 和网易云 3.1.41.205529。详情见 [0.3.1 发布说明](https://github.com/Yu-tao-Li/dsh-computer-use-win/releases/tag/v0.3.1) 与[测试记录](docs/dev-notes.md)。

</details>

### 工具与进阶

共 **23 项桌面工具 + 1 个管理入口**。下表使用短名，完整名称为 `windows_computer_use_<短名>`，在 DSH 中通常再加 `mcp__wincu__` 前缀。

<details>
<summary>查看完整工具清单与使用建议</summary>

| 用途 | 工具 |
|---|---|
| 连接与窗口定位 | `health` · `list_windows` |
| UIA 观察 | `snapshot` · `accessibility_tree` · `find` · `element_info` |
| 可见画面与文字 | `screenshot` · `ocr` |
| 鼠标 | `click` · `double_click` · `move` · `drag` · `scroll` |
| 文本与控件 | `type_text` · `keypress` · `focus` · `invoke` · `set_value` |
| 窗口管理 | `activate_window` · `move_window` · `close_window` |
| 等待与验证 | `wait_for` · `wait` |
| 工具管理 | `tools` |

精简方案为 `list_windows`、`find`、`click`、`scroll`、`type_text`、`keypress`、`ocr`、`screenshot`、`wait_for` 和 `tools`。保留管理入口时，agent 可查询工具说明、临时卸载或重新加载用户已允许的工具；`reset` 恢复用户保存的启动集合。卸载工具不会消除已有对话中的说明或结果。

优先使用 UIA 定位控件并执行 `invoke` / `set_value`。树稀疏或没有匹配时查看 OCR；图标或布局交给具备视觉能力的调用方读取截图。OCR 候选是文字和物理屏幕坐标，不会伪造 UIA 控件 ID。窗口移动、控件失效后应重新观察。

[完整参数与返回值](docs/wiki/mcp-tools.md) · [按需加载与客户端兼容性](docs/tool-context.md) · [不同应用的技术差异](docs/wiki/app-technology-matrix.md)

</details>

### 常见问题

<details>
<summary>装了却没有工具、设置页，或还在运行旧版本？</summary>

核对当前 profile、工具方案和安装位置，完整退出并重启宿主。版本可从 MCP `initialize.serverInfo.version` 核对；全部方案下也可调用 `health` 检查连接。同一 profile 应保留一个 `serverName: wincu` 服务；旧版临时添加的重复覆盖请先备份，再按[升级说明](docs/computer-use-settings.md)处理。

0.4.3 修复了混合版本 Desktop 的设置读取、保存和预览通道。读取失败时界面会说明状态。反馈问题请提供 Desktop、dsh 内核、插件版本和脱敏后的错误文字。

</details>

<details>
<summary>为什么点击或输入没有效果？</summary>

检查目标是否为前台、是否被遮挡，以及应用是否已无响应。Chromium、Electron 和部分 WinUI 控件可能忽略后台输入；优先使用 UIA 或明确目标的前台输入，再观察实际效果。Windows 权限隔离可能阻止操作提权窗口或 UAC 安全桌面。插件需要可访问的交互桌面。

</details>

<details>
<summary>支持 PowerShell 7、其他系统或内置视觉模型吗？</summary>

仅支持 Windows。PowerShell 5.1 是默认并已验证的真实 WinRT OCR 路径。CI 覆盖 PowerShell 5.1 / 7；PowerShell 7 的真实测试覆盖 UIA 和截图，OCR 使用确定性协议测试，不代表已验证其真实 WinRT OCR。

插件提供桌面工具，不附带模型、API key、OmniParser 或 UI-TARS。具备视觉能力的模型或独立解析服务可消费截图，再将定位结果交给工具。

</details>

### 数据与隐私

UIA、OCR、截图和输入在本机执行，结果交给 DSH 或其他 MCP 调用方。桌面内容是否进一步发送给远端模型，取决于宿主、模型和服务配置。截图及可见文字可能包含当前窗口里的敏感内容，请在分享日志或 Issue 前遮盖账号、路径、凭证和私人对话。

### 文档与开发

[设置与停止](docs/computer-use-settings.md) · [工具加载](docs/tool-context.md) · [工具参数](docs/wiki/mcp-tools.md) · [架构](docs/wiki/architecture.md) · [测试记录](docs/dev-notes.md) · [更新日志](CHANGELOG.md)

<details>
<summary>开发环境与验证</summary>

```text
DSH agent → 官方 MCP bridge → Node MCP server → 常驻 PowerShell 后端
                                             ├ UI Automation
                                             ├ 鼠标 / 键盘 / 窗口
                                             └ 截图 / Windows OCR
```

```powershell
npm ci
npm test
```

独立 MCP 服务无第三方运行时依赖；DSH 适配器使用宿主的 Schemastery 和官方 MCP 桥。开发依赖仅用于测试。**25 套隔离回归**覆盖设置兼容、控制生命周期、取消、UIA、截图、OCR 协议和输入边界。`npm test` 不发送物理输入，不修改已安装的 DSH profile；真实 UIA 测试仅操作专属夹具窗口，日志保存在命令输出的临时目录。

`node test/notepad-e2e.mjs` 是单独的真实输入测试，会打开记事本，应在专属测试桌面运行。两种 PowerShell 的验证范围见上方兼容性说明。

</details>

MIT 许可。基于 [cgissing/windows-computer-use](https://github.com/cgissing/windows-computer-use) 的衍生作品，来源与版权见 [THIRD_PARTY.md](THIRD_PARTY.md)。

[插件市场](https://awesome-dsh-plugin.com) · [发布记录](https://github.com/Yu-tao-Li/dsh-computer-use-win/releases) · [反馈问题](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues) · [返回中文顶部 ↑](#简体中文)

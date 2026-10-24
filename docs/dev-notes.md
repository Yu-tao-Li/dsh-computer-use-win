# 开发笔记（Development Notes）

本文件保留项目的开发过程记录：设计原理、踩坑、社区调研对比、性能数据与测试记录。
产品说明见 [README.md](../README.md)（中文）/ [README.en.md](../README.en.md)（English）。

## 原理（为什么这样做）

### 1. 为什么走 MCP 桥接，而不是原生 DSH 插件
- DSH 一切皆插件，但"注册新工具"需要写 Cordis 插件（注册进 `ctx.tools`、
  处理审批与权限钩子、打包成 `dsh.bundle`）。MCP 是更薄的边界：
  官方 `dsh-mcp-client` 会把任意 MCP server 的工具**原样注册**成
  `mcp__<serverName>__<工具名>`（serverName 我们在 patch 里取 `wincu`）。
- 好处：后端独立进程、独立语言、可单独测试（`--self-test`），坏了不影响 DSH 启动
  （`failOnStartupError: false`）。
- 代价：MCP 工具没有 DSH 原生的审批/风险分级钩子，所以安全机制做在 server 内部
  （scope 限定、窗口定位、动作前观察）。

### 2. 感知：UIA 无障碍树（text-first）
Windows 上比"截图像素"更可靠的是 **UI Automation** 树：每个控件带
`controlType`（Button/Edit/Window…）、`name`、`automationId`、`boundingBox`、
`value`、`patterns`（支持哪些语义操作）。agent 可以**按语义找控件**而不是猜坐标：

- 三种视图：`control`（默认，应用控件级，最常用）/ `content`（最终用户内容）/ `raw`（含内部节点）
- 元素 id 是 **UIA RuntimeId**：`uia:rt:42-251076304`（进程存活期内稳定，
  抗 UI 重排；过期报 `stale` 而非点错地方）。
- `find` 工具在树里按 name/automationId/class/值 做大小写不敏感子串搜索，
  返回完整节点信息，适合"找到保存按钮"这类任务。
- 截图（`snapshot`）给出 PNG **文件路径**（+ `imageScale`/`origin` 坐标映射）——
  DSH 的 dsh-mcp-client 会丢弃 MCP 的 image 内容块（只留占位符），所以视觉信息
  要么让模型用 `read_image` 读该 PNG，要么依赖 UIA 文本（推荐，纯文本模型也能干活）。

### 3. 动作：三条路径
| 路径 | 用什么 | 何时用 |
|---|---|---|
| 语义 | UIA patterns：`Invoke`/`Toggle`/`SelectionItem`/`ExpandCollapse`/`Value` | 优先！不碰鼠标、更稳；`click` 的坐标路径在 `dispatch:'auto'` 下也先解析点下元素，能取到模式就走这一层 |
| 前台 | `SetCursorPos` + SendInput 状态事件；剪贴板写入 + `Ctrl+V`；`SendKeys` 键组合 | 常规操作 |
| 后台 | PostMessage（鼠标消息 / WM_CHAR）直进目标窗口消息队列 | 不抢前台；投递未验证（诚实 `verified:false`） |

`type_text` 三种 `method`：`clipboard`（CJK 最可靠，自动还原剪贴板）/
`sendinput`（KEYEVENTF_UNICODE 逐字符，不碰剪贴板）/ `background`（WM_CHAR，不碰前台）。
`keypress` 支持 `["ctrl","shift","s"]` 这类键组合（Win 键黑名单拦截，SendKeys 限制）。

### 4. 窗口定位
所有工具都接受可选 `windowTitle`（子串）/ `processId` / `nativeWindowHandle`
指定目标顶层窗口，`activate: true` 可先置前台。不指定 = 当前前台窗口
（`scope: active_window`；`scope: desktop` = 整个桌面树）。

### 5. 踩过的坑（安全加固的来源）
computer use 在 Windows 上最阴险的失败都是**静默的**——返回 ok 但实际打错了地方：

1. **前台锁（foreground lock）**：后台进程调 `SetForegroundWindow` 会被 Windows
   前台锁**静默拒绝**——函数不报错，但窗口根本没切过去，后续按键就全打进了
   用户当前的前台窗口（可能是微信、浏览器）。
   修复：`AttachThreadInput` 把前台窗口输入线程挂到自己线程 + 模拟按下/抬起
   Alt 键解锁（AutoHotkey 经典技巧）+ `ShowWindow`/`SetForegroundWindow`。
   切完**校验前台是否真的变成目标窗口**，结果以 `activated: true/false` 返回。
2. **fail-closed 输入守卫**：`type_text`/`keypress` 一旦指定了目标窗口，
   发送前校验"前台 == 目标"，不匹配直接抛错，**绝不**把按键打进别的窗口。
3. **激活 ≠ 聚焦**：窗口置前台后，内部编辑框往往**没有键盘焦点**，
   `Ctrl+V` 会被无声吞掉。修复：`type_text` 在目标窗口内用 UIA 找**最大的启用状态
   Edit/Document 控件**并 `SetFocus()`，结果里回报 `focusedControl`。
4. **DPI 感知顺序**：Per-Monitor V2 必须在 GDI+/WinForms 程序集加载前设置，
   否则进程锁死在虚拟化坐标空间（本机 3414x960 vs 物理 5120x1440）。
5. **SendInput ABSOLUTE 多显示器陷阱**：ABSOLUTE 归一化在本机多显示器下会把
   X 恰好减半（ratio 0.495-0.500）。修复：移动改用 `SetCursorPos`（原始屏幕
   坐标），按钮/滚轮用 SendInput 状态事件，校准到落点 ratio 1.000。
6. **WinUI 应用丢弃 PostMessage 合成消息**：新记事本（WinUI 3）会静默丢
   WM_CHAR（消息入队成功但应用不处理）；`close_window` 对 WinUI 记事本实测是
   **直接干净关闭、不弹"是否保存"对话框**（经典 Win32 应用才会弹）。
   这类目标用 `foreground`/`clipboard` 路径。
7. **PrintWindow 对 DirectComposition 表面渲染纯黑**（UWP/WinUI/游戏）：
   捕获链检测纯黑帧后切 WGC（Windows.Graphics.Capture）读 DWM 合成帧，
   再不行降级屏幕区域裁剪（带 `occludedPossible` 标记）。
8. **PS 5.1 编码**：无 BOM 的 UTF-8 .ps1 在非 UTF-8 系统代码页（如 CI runner）
   上按 ANSI 解析 → 行尾 CJK 字节吞 LF、脚本崩。后端与所有 .ps1 均带 UTF-8 BOM。

## 社区项目对比与借鉴（2026-07 调研）

| 项目 | 语言 | 值得借鉴的设计 | 本项目吸收情况 |
|---|---|---|---|
| [trycua/cua](https://github.com/trycua/cua)（Cua Driver，ex-MS 团队） | Rust | 分层输入分发（UIA pattern→PostMessage 后台→SendInput 前台，显式报 `background_unavailable`）；PrintWindow→WGC→BitBlt 截图链 + 黑帧检测；DWM extended frame bounds 去阴影边 | ✅ 截图链、extended frame bounds、诚实报错、后台 dispatch |
| [Harusame64/desktop-touch-mcp](https://github.com/Harusame64/desktop-touch-mcp) | TS+Rust | **常驻 COM 线程**消除 PowerShell 进程启动（366ms→2.2ms）；坐标 homing（窗口移动补偿）；鼠标贴左上角 500ms 急停；Win+R/X/L 组合键黑名单；窗口身份校验 | ✅ **persistent 后端**、homing、急停 failsafe、Win 键黑名单（全部实测通过） |
| [SSCanine/iris-mcp](https://github.com/SSCanine/iris-mcp) | Python | 三后端路由（Win32/UIA/OCR）覆盖 UIA 盲区应用（Tk/自绘 Qt/游戏）；**SendInput 替代废弃的 mouse_event**；Per-Monitor V2 DPI；像素级 miss distance 实测 bench | ✅ SendInput、显式 Per-Monitor V2 DPI、bench 方法论、OCR 回退 |
| [wangneal/PeekabooWin](https://github.com/wangneal/PeekabooWin) | Python | UIA 稀疏时 `find_element` **自动降级 OCR**（结果带 `source: ocr_fallback` 标记）；`wait_for_window`/`wait_for_element` 服务端轮询；`move_window`/`close_window`（WM_CLOSE）；环境变量配置体系 | ✅ find 稀疏提示、OCR 回退、wait_for、move_window/close_window、WCU_* 环境变量 |
| [doucej/uia-x](https://github.com/doucej/uia-x) | Python | 跨平台统一工具面（Win UIA/Linux AT-SPI/macOS AX）；语义动作优先（`uia_invoke`/`uia_set_value` 先于 `mouse_click`） | ✅ 语义优先的 dispatch:auto（元素点击先走 UIA pattern）；跨平台未做 |
| [cgissing/windows-computer-use](https://github.com/cgissing/windows-computer-use) | PS+MJS | 本项目**直接上游**（MIT）：引擎核心、MCP server 骨架、docs/wiki | ✅ 衍生基础，详见 [THIRD_PARTY.md](../THIRD_PARTY.md) |

## 性能数据（本机实测，persistent 后端）

| 动作 | 优化前（每次新起 powershell） | 优化后 hot | 提升 |
|---|---|---|---|
| health | ~540ms | **6ms** | ~90× |
| list_windows | ~600ms | **44ms** | ~14× |
| tree (depth 2) | ~585ms | **103ms** | ~6× |

手段：
1. **persistent 后端**：MCP server 保活一个 `powershell -Persistent` 进程，
   JSON 行协议；超时/崩溃 → kill + 下次调用懒重建（隔离性不丢）。
   首个调用 cold ~500ms（进程+程序集+首次编译），之后稳定 6~100ms。
2. **C# P/Invoke 预编译 DLL 缓存**：按源码 hash 命名存 `%TEMP%`，
   重启进程免现场编译（~300-500ms/次 → 0）。OCR/WGC 助手同机制。
3. **截图减重**：`captureWindow`（PrintWindow 窗口裁剪，非前台窗口也能抓）+
   `maxWidth` 降采样（默认 1600px）+ `imageScale/origin` 供模型换算坐标 +
   30 分钟自动 GC。全屏 3.8MB → 窗口裁剪 91KB。

## 测试记录（2026-07~08，Windows 11 25H2 26100）

- `--self-test` ✅（persistent 模式、UIA 树、截图，22 工具）
- MCP 协议三件套 ✅（initialize → tools/list → tools/call）
- **端到端输入 ✅**：记事本激活 `activated:true`、聚焦 `focusedControl:Document`、
  文本写入（clipboard/sendinput）并 `find` 读回命中
- **窗口裁剪截图 ✅**：`captureWindow:true` 走 `method:printwindow`，
  1962×1265 → 降采样 **91KB**，带坐标映射
- **坐标校准 ✅**：`move` 到 (200,200)/(1000,500)/(3000,800) 实际落点 ratio=1.000
- **后台 dispatch ✅**：PostMessage 点击真实打开记事本菜单（UIA 验证）；
  WinUI 丢 WM_CHAR 的场景如实 `verified:false`
- **homing ✅**：窗口移动 (+186,+86) 后旧坐标点击补偿 `homed:{dx:186,dy:86}`
- **failsafe ✅**：鼠标贴角 500ms 后输入被拒（EMERGENCY STOP），物理移开恢复
- **identity guard ✅**：同名窗口被替换后拒绝动作
  （`identity_changed: HWND ... -> ..., PID ... -> ...`）
- **OCR ✅**：中文界面识别 + 屏幕坐标词框 + query→控件回查
- **set_value ✅**：UIA ValuePattern 直接替换 30 行文档
- **wait_for/close_window ✅**（close 对 WinUI 应用不弹保存框，见上）
- **环境干扰记录**：本机网易 UU 远程/GameViewer 会把窗口拖到屏幕外
  （-31991,-31888）甚至静默关闭——UIA 对屏外窗口仍可操作，工具链不受影响

## 环境/平台事实

- 开发/测试机：Windows 11 build 26100（25H2），PowerShell 5.1.26100.8655
  （ANSI 代码页 936，无 BOM 的 UTF-8 脚本会被按 GBK 解析——所有 .ps1 带 BOM）
- 虚拟屏 5120×1440 @ (0,0)，主屏 2560×1440，中文 UI
- WinMetadata：`C:\Windows\System32\WinMetadata`（每命名空间一个 .winmd，
  无统一 Windows.winmd；24H2+ 的 Graphics 系合并进 Windows.Graphics.winmd）
- WGC 助手编译需 .NET Core 参考程序集（`Microsoft.NETCore.App.Ref` pack）——
  缺失时 WGC 捕获优雅降级，不报错


## 2026-10-13：Issue #18 缓存观察与响应诊断

逐节点缓存配合惰性 TreeWalker 保留节点/深度上限；RuntimeId 用 GetCachedPropertyValue(RuntimeIdProperty)，full 的 value/patterns 同样缓存。新增时间预算、部分树诊断、WM_NULL 响应探测、激活失败 warning 和 element_info 详细度参数。回归覆盖确定性 Provider、实际 WinForms/Chromium 及人为阻塞后的恢复。新评论脚本的异步 stdout/stderr 读取修复有效，但 A/B 每节点耗时分母不同，不能直接引用 7.7 倍加速；API 调用计数也不等同于直接测得的 COM 往返次数。原报告的网易云特定版本尚待复测。

可运行 npm test；独立实机夹具命令为 node test/uia-chromium-smoke.mjs <结果目录> 与 node test/uia-native-smoke.mjs <结果目录>。Chromium 基线比较可指定 WCU_BASELINE_ROOT 为旧版本 checkout，使用相同 raw/full 或 raw/compact、节点与深度参数，并交换运行顺序。

## 2026-10-14：0.3.0 观察与动作验证

新增原生 screenshot，默认 OCR、坐标输入、窗口管理和激活使用 Win32 元数据。空的稀疏/截断 find 自动补 OCR，候选明确带来源；文字缺失时保留识别行。type_text 默认保留前一步点击建立的焦点。wait_for 可等待窗口、UIA 控件或实际 OCR 文字；发送动作与观察到条件分别报告 sent/observed，拒绝激活为 unconfirmed。输入参数由 tools/list 的同一份 schema 校验及应用默认值。树结果使用紧凑 JSON，排队请求从发送时开始计时，树 watchdog 为遍历预算加 10 秒；超时错误可附新 worker 获取的独立截图。

RuntimeId 使用最多 6000 条、5 分钟的观察注册表，校验 HWND/PID 和显式目标。剪贴板格式在覆盖前读取、finally 恢复；drag 保证 release，drag/scroll 检查输入返回值，SendKeys 字面特殊字符转义。

本机 PowerShell 5.1 与 7 各通过 17 项隔离回归，包括真实 WinForms、强制无障碍 Chromium 和不暴露文字控件的 canvas。WinRT OCR 的真实验证在 5.1 路径；7 路径覆盖截图、UIA 与确定性 OCR 协议，不宣称其 WinRT OCR 支持。

专属 Windows 11 Home China 22621.4112 虚拟机，PS 5.1.22621.4111、2560×1600、DPI 144，默认启动网易云 3.1.41.205529。最终候选通过官方 Cordis/ToolRuntime/MCP bridge 完成 OCR 定位搜索框、点击、输入“晴天”、回车，并在同一次结果截图的 OCR 中读到“单曲”和“周杰伦”；点查询返回的 RuntimeId 可再次解析。文本、16×16 Bitmap 和 FileDrop 在真实剪贴板输入后均恢复。每次工具调用前后原生响应探测通过。

占位文字会轮换，页面和建议项异步加载；验收使用同一观察中的坐标及结果页文字，不能仅把建议项出现视为搜索完成。此测试无模型参与、未验证播放，原帖所述应用卡死仍未复现。新版本保留零运行时 npm 依赖和 PS 5.1；未捆绑视觉解析模型。

## 0.3.1 完整截图复测（2026-10-14）

同一专属 VM 和官方 Cordis/ToolRuntime/MCP bridge 中，0.3.0 的网易云搜索结果截图复现了 PrintWindow 成功返回但下半部分纯白，延后的第二次 OCR 截图甚至只保留顶部。独立屏幕采集显示歌曲列表、左侧菜单和歌单均已完整绘制；独立 PowerShell 进程的 PrintWindow 也能取得完整图。因此只确认长驻调用链中的 PrintWindow 结果与真实桌面不一致，不把该现象归因于未加载完成，也不宣称已定位 CEF/GDI 内部原因。

0.3.1 在窗口完全位于虚拟桌面范围内、确为前台且上方无相交可见窗口时，优先采集真实屏幕像素；采集后再次检查前台、层级和窗口位置。发生竞态则舍弃该图并走原窗口采集链。后台、遮挡、最小化或离屏目标不进入此优先路径。已检查的屏幕裁剪返回 method:screen-region、occludedPossible:false；最终屏幕回退仍标记 true。此策略无需安装额外 SDK 或模型。

两次 0.3.1 冷启动搜索均通过，包括真实文本/Bitmap/FileDrop 剪贴板恢复、所有工具调用前后的原生响应探测。每次最终和延后 OCR 图片均完整显示下半部分，真实 OCR 可读到“本地音乐”“歌单”和歌曲条目。原环境的 WGC 编译不可用也已记录；PrintWindow 失败和 WGC 不可用后的屏幕回退、焦点/位置竞态、缩放和图片下半部分保留由合成像素契约覆盖。该契约没有操作用户桌面。


## 0.4.0 工具上下文与按需加载（2026-10-14）

Issue #24 原版 tools/list 序列化为 43,495 字符。保留全部执行定义与约束，只压缩公开说明；精简模式 9 个常用工具加发现入口为 9,046 字符，全能模式 23 项桌面工具加发现入口为 20,259 字符。分别减少 79.2% 和 53.4%，不等同于模型无关的 token 比例。

发现入口可列出能力、单独读取原始完整契约、加载/卸载及恢复默认列表，标准 MCP list_changed 通知同步客户端。DSH 配置适配器提供 lite/full 选择，并保留官方桥的连接生命周期和取消机制。MCP server 仍无第三方运行时依赖；适配器消费宿主现有的 optional peer 包。

本机 PowerShell 5.1 与 7 各通过 19 项隔离回归，包含发现不启动后端、未知名称原子拒绝、完整 schema 约束一致、幂等加载、通知、调用及 reset。Node/Electron 配置解析与子进程启动通过。在 DSH Desktop 自带的 Cordis 4.0.4、ToolRuntime 0.2.0-rc.2、MCP bridge 0.2.0-rc.2 中验证了发现、加载注册、真实 wait 调用及卸载移除。配置 schema 的双语模式选项和默认值经过真实 Schemastery 校验；未把配置 schema 检查当作设置页面截图验证，也没有模型参与。

加载状态仅属于 MCP worker，不覆盖用户保存的 mode；卸载不会清除对话历史。其他客户端若不刷新工具列表需手动刷新、重连或使用 full。参数错误依然在执行前拒绝。


## 0.4.2 Desktop 设置与接管提示（2026-10-18）

修复 #29 的包入口发现、客户端依赖和现代 Config/volatile 表单路径，使用官方 bridge；真实 Desktop 已验证独立入口、保存和重启持久化。实现 #28 的可见接管反馈，停止采用物理 Esc／录制快捷键和显式恢复，普通输入不自动退出。原生透明层保留系统光标，默认允许远程捕获，并按活动显示器变化重建。实际三块 2560×1440 屏幕的窗口边界和采集通过，用户在 UU 虚拟屏幕中确认提示条与鼠标标识均可见。

Windows 回归由专用输入夹具和测试事件验证停止、取消与收尾，不向用户桌面发送测试点击或按键。动态显示器新增、分辨率变化、移除和重连通过测试入口驱动真实重建逻辑；实际远程验证覆盖现有三屏布局。完整发布验证与 CI 结果见 v0.4.2 Release。

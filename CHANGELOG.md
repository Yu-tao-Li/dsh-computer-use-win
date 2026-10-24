# Changelog

## 0.5.2 — 未发布 / Unreleased

- 修复 Electron 等 Chromium 窗口读不到网页控件的问题（#50）。Chromium 要等 UIA 客户端读取页面根节点的属性，才会构建网页的无障碍树；页面根节点是 `Chrome_RenderWidgetHostHWND` 子窗口下的第一个节点。control 视图会跳过这个空的根节点，所以单靠遍历常常只看到窗口外框。现在对窗口执行 `snapshot`、`accessibility_tree`、`find` 和等待控件的 `wait_for` 之前，会先读取每个可见渲染子窗口的页面根节点，再等网页树出来。每次调用最多等 1.5 秒，并且不超过 `treeTimeoutMs` 的一半。一直没有内容的渲染窗口，在之后 30 秒内的观察中继续尝试，过了 30 秒就不再等待。结果里的 `webContent` 说明网页树的状态（`ready`、`partial`、`starting`、`unavailable`）；网页树还在构建时，提示稍后再观察一次，而不是直接改用 OCR。按坐标调用 `element_info` 和 OCR 的 `resolveControl` 在命中测试前也会这样预热。 / Fix Electron and other Chromium windows that exposed no page controls (#50). Chromium builds a page's accessibility tree only after a UIA client reads a property of the page root, the first child of the `Chrome_RenderWidgetHostHWND` child window. The control view skips that empty root, so a tree walk alone usually returned only the window frame. Window-scoped `snapshot`, `accessibility_tree`, `find` and element `wait_for` now read that root for each visible renderer window and wait for the page tree, at most 1.5 seconds and half of `treeTimeoutMs` per call. A renderer that stays empty is tried again by observations over the next 30 seconds and is no longer waited for after that. `webContent` reports the page state (`ready`, `partial`, `starting` or `unavailable`); a page that is still starting gets a hint to observe again instead of falling back to OCR. `element_info` by point and OCR `resolveControl` warm the window the same way before hit-testing.
- Chromium 把网页放在六层以上没有名字的布局 Pane（NonClientView、ClientView、View 等）下面，默认深度（snapshot 5、tree 6、find 8）到不了网页，即使强制打开无障碍也一样。在窗口范围的树里，这些 Pane 现在不计入 `maxDepth`；返回的 `depth` 仍是实际层级，额外层数最多 16 层。桌面范围的树不变，仍是所有窗口的概览。 / Chromium nests a page under six or more unnamed layout panes (NonClientView, ClientView, View and so on), so the default depths (snapshot 5, tree 6, find 8) never reached it, even with forced accessibility. In window-scoped trees those panes no longer count toward `maxDepth`. Reported `depth` values stay structural, with at most 16 extra levels. Desktop-scoped trees are unchanged and stay an overview of every window.
- 新增 `uia-chromium-lazy-smoke`：Electron 夹具不强制打开无障碍，只用默认参数，第一次观察就必须读到网页控件，冷窗口的坐标查询必须返回网页元素而不是布局 Pane。强制无障碍的夹具增加默认深度断言。契约测试覆盖布局深度规则（包括桌面范围不变），以及预热的就绪、单次等待上限、30 秒后停止等待、渲染窗口无响应、拒绝读取和已关闭等分支。 / Add `uia-chromium-lazy-smoke`: an Electron fixture without forced accessibility must expose page controls on the first default-argument observation, and a point query on a cold window must return page content rather than a layout pane. The forced fixture asserts default-depth reach. The contract covers the layout depth rule, including unchanged desktop trees, and the warm-up's ready, per-call wait bound, 30-second expiry, unresponsive, refusing and closed-renderer branches.

## 0.5.1 — 2026-10-24

- 启动集合只剩管理入口且至少允许一项桌面工具时（即懒启动），`initialize` 返回 `instructions`，说明该服务能读取并操作真实 Windows 应用，并须先 `enable` 再使用；该条目的说明也改为先讲能力。此前这一状态下没有任何桌面工具名可据以推断能力，模型容易把管理入口当成普通的工具开关。其他启动集合不返回该字段；不允许任何桌面工具的自定义清单同样不返回，那里启用会被拒绝，声明该能力与用户设置相反。 / Return MCP `initialize` `instructions` when the startup set is the management entry alone with at least one desktop tool allowed (which is what Lazy startup does), stating that this server reads and operates real Windows applications and requires enabling tools first; the entry's own description now leads with the capability. Previously no desktop tool name remained in that state from which a model could infer capability. Other startup sets omit the field, including a Custom checklist that allows no desktop tool, where enabling one is refused and claiming the capability would contradict the user's setting.
- 回归覆盖懒启动与不允许桌面工具的自定义清单两条路径，并断言其他方案不返回该字段。 / Cover both Lazy startup and a Custom checklist that allows no desktop tool, asserting that other presets omit the field.
- 设置页顶部的 Star 与 Issue 说明新增三角“折叠”：点一下收为一个带 GitHub 标志的 `dsh-computer-use-win` 外链，点“展开”恢复。选择立即保存（`communityNote`），重启和升级后保持不变，不会保存或放弃其他未保存的更改；默认仍显示完整说明。 / Add a triangle Collapse control to the Star and Issue note at the top of the settings page: one click folds it into a single `dsh-computer-use-win` link with the GitHub mark, and Expand restores it. The choice saves at once (`communityNote`), persists across restarts and upgrades, and neither saves nor discards other pending changes; the full note remains the default.
- 设置页按 DSH 原生设置的样式重新设计：卡片、开关行、分段的提示位置选择和浮动保存栏沿用 DSH 的颜色、圆角与描边变量，深浅色主题一致。 / Redesign the settings page after DSH's native settings: cards, switch rows, a segmented position control and a floating save bar use DSH's color, radius and stroke tokens in both themes.
- 接管提示重新设计：屏幕边缘改为亮线加 DeepSeek 蓝渐隐光晕，深浅壁纸上都看得清；提示条改为深色胶囊（状态圆点、提示文字、Esc 键帽），文字改用适合透明叠加层的灰度抗锯齿；鼠标旁的硬边光圈改为柔和光斑加实色“DSH”名牌，名牌按用户的指针大小（含辅助功能放大）放在指针外侧，指针设置变化后才重新测量。设置页预览同步。 / Redesign the takeover indicator: a bright edge line with a soft DeepSeek-blue falloff that reads on dark and light wallpapers, a dark status pill with a live dot, the indicator text and an Esc keycap, grayscale anti-aliased text suited to layered windows, and a soft spotlight with a solid DSH name tag in place of the hard pointer ring. The tag sits past the pointer at the user's pointer size, including the accessibility size, and is measured again only after a pointer setting change. The settings preview matches.
- 原子写入 JSON 时，若 Windows 上目标文件正被其他进程短暂占用（EPERM/EACCES/EBUSY），先重试约 1 秒再报错；修复 activity-series 的偶发失败，新增 atomic-json 回归复现这种占用。 / Retry atomic JSON replacement for up to about a second when Windows briefly refuses it (EPERM/EACCES/EBUSY) because another process holds the file. This fixes the intermittent activity-series failure; a new atomic-json suite reproduces the hold.
- 中文界面的设置选项卡从“Computer Use”改名为“电脑操控”，前面的齿轮换成和对话记录一致的鼠标图标。DSH 目前只给内置分区配图标，插件给自己的导航按钮加一个标记，再用样式替换图标；导航结构不同时保留宿主的齿轮。英文界面仍叫 Computer Use。工具被设置关掉时的报错同时给出中文入口。 / In the Chinese interface the settings tab is renamed from “Computer Use” to “电脑操控”, and its gear becomes the mouse icon used in conversation records. DSH assigns nav icons only to built-in sections, so the plugin marks its own nav button and swaps the icon with a stylesheet; a nav with different markup keeps the host's gear. The English tab is still Computer Use. Errors for tools disabled in settings now name the Chinese entry too.

## 0.5.0 — 2026-10-20

- 新增懒启动方案：允许全部工具，启动只加载管理入口，按任务启用桌面工具；reset 恢复为管理入口。默认仍为全部，自定义清单保留。 / Add Lazy startup: allow all tools but initially advertise only management; load tools on demand and reset to management only. All remains the default and custom selections are preserved.
- enable / disable 支持 `names: ["*"]`，一次处理全部已允许的桌面工具，保留管理入口；已有多名称批量调用继续支持，非法混合通配符不产生部分修改。 / Support wildcard batches over allowed desktop tools while preserving management, multi-name batches and atomic validation.
- 设置重载同时区分启动状态和允许范围，修复全部与懒启动切换时工具范围相同而不刷新的问题；增加中英文设置、宿主持久化与真实 MCP 列表刷新回归。 / Compare both startup state and permissions when reconnecting, with bilingual UI, persisted settings and official MCP bridge refresh coverage.
- 同口径 `JSON.stringify({tools: list})`：全部 20,243、精简 9,030、懒启动 510 字符；懒启动比全部减少 97.5%。这是工具定义字符数，不是 token 或整段会话用量。 / Serialized tool definitions measure 20,243 / 9,030 / 510 characters for All / Lite / Lazy; Lazy saves 97.5% versus All. These are characters, not tokens or total conversation usage.

## 0.4.3 — 2026-10-19

- Esc／自定义快捷键仅停止当前轮与排队动作，下一次用户任务自动可用，移除设置中的恢复按钮；桌面调用完成后空闲 30 秒收起提示并释放占用，执行中的动作不计为空闲。 / Scope stops to the current turn, resume automatically on a new user task, remove the settings resume button, and release indicators after 30 idle seconds following a completed desktop call.

- 修复部分 Desktop 安装的设置读取、保存与预览：保留实时字段元数据并兼容共享引用协议，确认宿主保存结果；缺失表单不再显示成可编辑的默认值。 / Fix settings reads, saves and preview on mixed-version Desktop installations; keep live metadata and references, and disable unavailable forms.
- 接管提示覆盖整轮桌面操作，包括观察和思考间隔；完成、取消或异常退出后释放，租约过期避免常驻。不同对话不能交错接管桌面。 / Keep indicators through the complete operation series, release on turn completion/cancellation or stale leases, and prevent overlapping conversations from controlling the desktop.
- 对话中增加鼠标图标操作行、可展开截图及整轮操作摘要，从已有会话事件恢复；区分发送输入和确认结果。 / Add mouse-icon action rows, expandable screenshots and durable series summaries, distinguishing sent input from verified effects.
- 插件列表使用简介和设置引导，完整表单及 Star／Issue 链接保留在详情页。 / Use a compact plugin-list introduction and keep the complete settings and community links on the detail page.
- 文字粘贴不再将鼠标移回较早的位置；保留 UIA 优先、物理 Esc／自定义快捷键停止，以及远程和虚拟显示器提示。 / Remove pointer repositioning during paste while retaining UIA-first actions, explicit stop shortcuts and remote/virtual-display indicators.

## 0.4.2 — 2026-10-18

- 修复 DSH Desktop 设置入口：通过包入口发现客户端，并在“设置 → Computer Use”及插件页面注册界面，支持现代 Config/volatile 字段与旧设置接口。提供中英界面、深浅主题、草稿、原子保存、失败反馈和重启持久化。 / Fix Desktop client discovery and mount Settings → Computer Use, supporting modern Config/volatile fields and legacy settings, bilingual themes and persisted saves.
- 工具加载提供“精简 / 全部 / 自定义”，默认全部 24 项；内部自选清单支持按组选择、全选和全部关闭，切换方案保留勾选。用户关闭的工具不能由 agent 重新开启。 / Add Lite / All / Custom presets (All by default), a nested checklist and enforced user-selected availability.
- 接管时显示点击穿透、不抢焦点的屏幕边缘、可配置提示条及鼠标光环／DSH 标识；操作结束后隐藏，支持独立开关和预览。 / Show non-activating, click-through screen and pointer indicators during desktop input.
- 使用物理 Esc 或录制的自定义按键／组合键停止；暂停保持到用户明确恢复，取消排队输入并清理按住的输入。普通鼠标移动、其他按键和程序注入的按键不会触发停止。 / Stop with physical Esc or a recorded shortcut, retain a manual-resume pause, cancel queued input and release held input during cleanup.
- 提示默认在远程与录屏中可见；按活动显示器、显示／会话事件和 500ms 拓扑复核更新，适配虚拟屏幕、坐标、分辨率和 DPI 变化。 / Make indicators visible to remote capture by default and refresh them when active virtual-display layouts change.
- 沿用官方 MCP 桥；显示设置更新不替换当前输入 worker，工具方案变化等待动作结束。独立 MCP 保留原命名与 lite/full 环境变量。 / Keep official MCP transport and standalone compatibility, applying tool changes after active input finishes.
- 在等待原生接管提示启动期间保留后端请求的到达顺序，避免后续读取越过输入，并验证取消仍等待输入收尾。 / Preserve backend request order while preparing the indicator, including cancellation cleanup.
- 验证涵盖 Windows 回归、双代设置与实际 Desktop 保存／重启；实际三屏捕获及 UU 虚拟屏幕的提示条、鼠标标识均确认可见。动态显示器变化通过测试入口驱动真实渲染逻辑验证。 / Validation includes regression suites, actual Desktop persistence, three-monitor capture and user-confirmed UU virtual-screen visibility; topology changes use the real renderer through a test seam.

## 0.4.1 — 2026-10-15

- Complete the promised DSH settings entry with a bilingual browser card under Configurable plugins. Stage edits until Save, persist the mode through the host settings service, reload the official MCP bridge, and restore the saved preference after restart. Preserve manual entry configuration when no settings provider is mounted.
- Add a real Chromium rendering/event regression for the shipped card and verify durable settings with the official file-backed provider. React remains test-only; the browser consumes DSH's shared React runtime.

- Make health independent of the foreground application's UIA provider. Return native HWND/PID/window metadata and a bounded native responsiveness probe instead of UIA element properties.
- Report `uiAutomationProviderChecked:false` explicitly. A hung target or missing foreground window no longer turns backend availability into a provider query. UIA capability flags and existing action parameters remain unchanged.
- Add a regression with UIA functions that deliberately fail, plus hung/missing/disappeared window cases. The historical CI health timeout's exact cause remains unestablished; this fixes a reproduced coupling risk rather than claiming that old timing was reconstructed.
- Resolve built-in JSON and Add-Type commands from the running PowerShell installation instead of inherited module search paths. Add opt-in stderr startup-stage timings (`WCU_BACKEND_TRACE=1`), enabled in CI, to distinguish assembly/provider initialization, request parsing and native health work when a cold-start watchdog expires. Keep production deadlines unchanged.

## 0.4.0 — 2026-10-14

- Add a DSH plugin configuration with Lite/Full modes. Lite starts with nine common desktop tools plus discovery; Full exposes all 23 desktop tools plus discovery. Standalone MCP defaults to Full for compatibility.
- Compress model-facing prose while preserving execution schemas, types, bounds, defaults and existing tool names. `tools.describe` returns the full original contract on demand; `enable`, `disable` and `reset` update the MCP list with change notifications.
- Measure tools/list at 9,046 characters in Lite and 20,259 in Full, compared with 43,495 in 0.3.1. These are character counts, not model-independent token claims.
- Keep the official DSH MCP bridge responsible for lifecycle, cancellation and tool registration; its host packages are optional peers, not newly bundled runtime dependencies.
- Add discovery/schema/load/reset regressions and verify official bridge refresh. Upgrade the test-only MCP client to 2.3.1.


## 0.3.1 — 2026-10-14

- 前台窗口完全在虚拟桌面范围内且无遮挡时，截图/OCR 优先采集真实屏幕像素，避免网易云 CEF 的 PrintWindow 返回成功但图片缺失下半部分。采集前后检查前台 HWND、窗口层级和位置；不主动激活窗口。
- 后台或有遮挡的窗口仍使用 PrintWindow/WGC 和带遮挡标记的屏幕回退。失败的 PrintWindow 位图及时释放。
- 中英文 README 使用同页语言导航，替换网易云搜索《晴天》的完整实测截图；安装、工具列表、观察方式和真实任务验证默认展开。
- Prefer a checked screen crop for fully visible, unobstructed foreground windows. Verify focus, Z order and geometry around capture; preserve background capture fallbacks and explicit occlusion metadata. Add screen-crop eligibility regressions.

## 0.3.0 — 2026-10-14

- Add native `screenshot` and UIA-independent OCR capture; make OCR hit-testing opt-in and support MCP image output.
- Automatically attach OCR text/coordinates after empty sparse or incomplete `find`; retain recognized text when the literal query misses. Keep source and geometry distinct from UIA controls.
- Preserve focused controls during `type_text` by default; provide explicit `focusMode:main` compatibility behavior.
- Extend `wait_for` with native window, bounded UIA element, and literal OCR text conditions. Distinguish dispatched actions from observed effects and inconclusive absence.
- Validate parameters and apply defaults from the advertised MCP schemas; use compact JSON tool output.
- Start request deadlines at dispatch; bound tree watchdogs relative to traversal budgets and preserve explicit UIA errors during screenshot fallback.
- Cache observed RuntimeId references with native owner checks; fail stale ids without whole-desktop searches. Preserve clipboard formats in finally, escape literal SendKeys characters, check drag/scroll input returns, release drag buttons on failure, and report scroll homing.
- Add deterministic schema/queue/OCR/input contracts and a real sparse canvas fixture. Existing Node/Electron and PowerShell 5.1/7 regressions remain in the release gate.


## 0.2.6 — 2026-10-13

- UIA 树遍历改用逐节点 CacheRequest 与惰性 TreeWalker，属性、RuntimeId、full 模式的 value/patterns 均从缓存读取；不再预先枚举整棵子树或所有兄弟节点，保留 maxNodes/maxDepth 限制。
- snapshot/accessibility_tree/find 新增 treeTimeoutMs（默认 5000 ms）和部分结果诊断；原生 WM_NULL 探测发现目标无响应时，在进入 UIA 前停止。单次同步 Provider 调用仍可能超过时间预算；MCP worker 超时提示调用方检查目标，避免立即重复遍历。
- activate_window 激活失败附 warning 与 targetResponsive，返回可用的 Win32 窗口元数据；目标无响应时跳过激活。element_info 支持 detailLevel，默认 compact，可显式选择 full。snapshot 补齐遮挡警告。
- Added PowerShell 5.1/7 regressions for cached metadata, bounded lazy traversal, partial deadlines, provider failures, native activation diagnostics and element_info detail levels. CI also verifies real disposable WinForms and Electron/Chromium providers, without physical input.
- Cached observations reduce per-node live property/pattern reads. The budget is cooperative between provider calls, not a guarantee that an individual CEF provider cannot block. NetEase Cloud Music 3.1.41 on the reporter's Windows build has not been reproduced here.
- 感谢 / Thanks to [@ERlzero](https://github.com/ERlzero) for the report and follow-up script in [#18](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/18).

## 0.2.5 — 2026-10-09

- 修复 OCR `query` 无法匹配按字符分词的 CJK 文本：忽略大小写和空白，在实际 OCR 词序列中定位命中范围，并在这些词框的联合矩形中心回查 UIA 控件。
- 新增 `matched[].boundingBox` 和 `lines[].boundingBox` 屏幕坐标矩形；保留 `matched[].word.x/y` 点击坐标、每行首个命中和最多 3 行的限制。
- 新增 PowerShell 5.1/7 回归，覆盖中日韩文字、英文、跨词与部分词匹配、空白、前缀偏移、DPI 缩放和 UIA 查询失败后的 OCR 结果保留。
- Fixed OCR query matching for character-segmented CJK text. Matching ignores case and whitespace, maps the matched range to actual OCR words, and looks up UIA at their union-box center. Added screen-coordinate line/match bounding boxes and PowerShell 5.1/7 regressions.
- 感谢 / Thanks to [@oahnimuy](https://github.com/oahnimuy) for the report and real-run evidence in [#16](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/16).

## 0.2.4 — 2026-10-03

- 修复 DSH Desktop/Electron 中 MCP 启动时的 `Connection closed`：bundle 为 MCP 子进程显式设置 `ELECTRON_RUN_AS_NODE=1`，同时兼容普通 Node 宿主。
- 新增实际 bundle 的 Node/Electron 启动回归，使用官方 MCP SDK 和确定性 PowerShell 协议 fixture 验证 initialize、22 个工具、health、wait 和 6 项资源，并接入 PowerShell 5.1/7 CI。原有自检/只读窗口测试继续验证真实后端。Electron、MCP SDK 和 YAML 解析器仅用于测试，运行时继续保持零依赖。
- Fixed MCP startup in DSH Desktop/Electron by explicitly setting `ELECTRON_RUN_AS_NODE=1` for the server child. Added actual-bundle startup regressions in Node and Electron with the official MCP SDK, included in both PowerShell CI jobs.
- 感谢 / Thanks to [@KazeLiu](https://github.com/KazeLiu) for the report and launch comparison in [#13](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/13).

## 0.2.3 — 2026-09-28

- 修复 MCP 取消后 worker 继续阻塞及旧 worker 退出影响替代进程的问题；带激活行为的读取和已发出的输入完成当前动作后再回收，仍受现有超时限制。
- 顶层窗口发现改用 EnumWindows；目标解析保留此前观察的坐标缓存，HWND/PID 元素 ID 校验窗口身份和 viewMode。
- 检查光标定位和点击输入返回值，成功按下后在异常路径中尝试释放；新增 PowerShell 5.1/7 隔离回归测试。
- 保留后端脚本的 UTF-8 BOM，避免 Windows PowerShell 5.1 在非 UTF-8 系统编码下解析失败，并增加编码回归检查。
- Fixed worker cancellation and replacement isolation, native window discovery with preserved coordinate observations, and checked click input cleanup. Activation-aware cancellation remains bounded by the existing timeout. Added isolated PowerShell 5.1/7 regressions.
- 感谢 / Thanks to [@xut1021](https://github.com/xut1021) for the report, patches and tests in [#8](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/8), [#9](https://github.com/Yu-tao-Li/dsh-computer-use-win/pull/9), [#10](https://github.com/Yu-tao-Li/dsh-computer-use-win/pull/10) and [#11](https://github.com/Yu-tao-Li/dsh-computer-use-win/pull/11).

## 0.2.2 — 2026-09-26

- **修复 `ocr` 的 `query` 参数被 schema 禁止**([#6](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/6)):handler 一直支持并处理 `query`(返回 `query`/`matched`),README 也已宣传,但 `additionalProperties: false` 的 schema 未声明该参数,规范客户端永远无法发送。现已加入 `ocr` 的 inputSchema。感谢 [@TomJerry234](https://github.com/TomJerry234) 的自动化审计。
- **统一 `viewMode`/`includeOffscreen` 的行为与文档**([#4](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/4)):这两个参数作用于 scope 解析与树遍历;`uia:rt:*` 形式的元素 id 由 RuntimeId 直接定位、按设计绕过视图过滤。现在所有路径都会校验 `viewMode` 合法性(此前非法值在 `uia:rt:*` 路径被静默吞掉、在 legacy 路径报错,行为不一致),schema 描述与 `docs/wiki/mcp-tools.md` 已写明该语义。
- **`activate` 参数在所有声明它的路径上生效或如实文档化**([#5](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/5)):此前 `activate` 只在 drag/type_text/keypress 与元素解析路径被读取。现在 `click`/`double_click`/`move`/`scroll` 的 x/y 坐标路径也会先激活目标窗口(坐标输入命中的是物理位置的像素,目标被遮挡时输入会静默落到遮挡窗口上);`ocr` 在 `activate: true` 时先置前再截屏(被遮挡窗口截到的是遮挡者像素;激活被前台锁拒绝时在结果里加 `warning` 而不失败);`move_window` 尊重 `activate: true`(去掉硬编码的 `SWP_NOACTIVATE`,并通过 `Set-WindowForeground` 助手强制置前——`SetWindowPos` 的隐式激活会被 Windows 前台锁静默拒绝;结果新增 `activated` 字段,被拒时附 `warning`),默认仍不抢焦点;`element_info` 的 FromPoint 路径同样先激活。`close_window`(WM_CLOSE 后台即可)与 `activate_window`(工具本身就是激活)按文档写明语义。感谢 [@TomJerry234](https://github.com/TomJerry234) 的自动化审计。
- 修复 `mcp/server.mjs` 硬编码 `SERVER_VERSION` 与 `package.json` 版本漂移的问题:现在从 `package.json` 读取版本号。
- **Fixed the `ocr` `query` parameter being forbidden by its own schema** ([#6](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/6)): the handler always supported and processed `query` (returning `query`/`matched`) and the README advertised it, but the `additionalProperties: false` inputSchema never declared it, so schema-respecting clients could not send it. `query` is now part of the `ocr` schema. Thanks to [@TomJerry234](https://github.com/TomJerry234) for the automated schema-vs-implementation audit.
- **Made `viewMode`/`includeOffscreen` behaviour consistent and documented** ([#4](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/4)): the two parameters apply to scope resolution and tree walking; `uia:rt:*` element ids are looked up directly by RuntimeId and bypass view filtering by design. `viewMode` is now validated on every path (an illegal value used to be silently swallowed on the `uia:rt:*` path while the legacy path threw), and the schema descriptions plus `docs/wiki/mcp-tools.md` document the semantics.
- **`activate` now works or is honestly documented on every path that declares it** ([#5](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/5)): `activate` was only read by drag/type_text/keypress and element-target resolution. Now the x/y coordinate paths of `click`/`double_click`/`move`/`scroll` activate the target window first (coordinate input hits whatever is physically under the point — with the target occluded, input silently landed on the overlapping window); `ocr` brings the window forward before capturing when `activate: true` (an occluded window captured the occluder's pixels; if the foreground lock refuses activation the result carries a `warning` instead of failing); `move_window` honours `activate: true` (the hardcoded `SWP_NOACTIVATE` is now conditional, and the switch is enforced via the `Set-WindowForeground` helper — `SetWindowPos`'s implicit activation is silently refused by the Windows foreground lock; the result gains an `activated` field plus a `warning` when refused, default unchanged); `element_info`'s FromPoint path activates too. `close_window` (WM_CLOSE works in the background) and `activate_window` (the tool is the activation) now document their semantics. Thanks to [@TomJerry234](https://github.com/TomJerry234) for the automated audit.
- Fixed `mcp/server.mjs` reporting a hardcoded `SERVER_VERSION` that drifted from `package.json`: the version is now read from `package.json`.

## 0.2.1 — 2026-09-26

- 修复窗口激活无条件调用 `SW_RESTORE` 的问题：对最大化/贴靠窗口执行带 `activate: true` 的工具时会取消其最大化并重置位置大小（含用户自己的宿主窗口，并连带导致坐标点击偏移）。现在仅当窗口确实最小化（`IsIconic`）时才还原，其余情况不动窗口状态。感谢 [@snmtg1008](https://github.com/snmtg1008) 在 [#2](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/2) 中定位并给出修法。
- Fixed window activation unconditionally calling `SW_RESTORE`: any tool run with `activate: true` un-maximized maximized/snapped windows and reset their position and size (including the user's own host window, and cascading into misaligned coordinate clicks). `SW_RESTORE` is now issued only when the window is actually minimized (`IsIconic`); otherwise the window state is left untouched. Thanks to [@snmtg1008](https://github.com/snmtg1008) for diagnosing the issue and proposing the fix in [#2](https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/2).

## 0.2.0 — 2026-09-10

- 修复 DSH profile 安装后的 `mcp/server.mjs` 路径解析：通过 profile 的 `package.json` 解析已安装的 npm 包，兼容 pnpm 布局。
- Fixed DSH profile startup path resolution by resolving the installed npm package through the host profile's `package.json`, including pnpm layouts.
- 新增 profile 路径回归测试并接入 `npm test` 和 GitHub Actions CI。
- Added a profile-resolution regression test and wired it into `npm test` and GitHub Actions CI.
- README 增加 npm 安装方式，并同步更新中英文路径说明。
- Documented the npm installation route and refreshed the bilingual path-resolution guidance.
- 感谢 [@CnsMaple](https://github.com/CnsMaple) 在 [#1](https://github.com/Yu-tao-Li/dsh-computer-use-win/pull/1) 中定位并修复该问题。

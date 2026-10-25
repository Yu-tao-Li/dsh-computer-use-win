# 电脑操控设置 / Computer Use settings

## 简体中文

升级插件并完整退出、重新启动 DSH Desktop，打开 **设置 → 电脑操控**（鼠标图标；英文界面叫 Computer Use）。新版插件页面也有入口；旧宿主保留可配置插件卡片。DSH 0.2 使用插件条目 ID `mcp-dsh-computer-use-win` 的 Config 表单；旧接口使用 `windows-computer-use`。

若曾为 #29 手动添加独立的 `windows-computer-use` 或 `wincu` 覆盖条目，请先备份 profile 配置，再移除该临时重复条目，使用插件 bundle 提供的入口。避免同时启动两个桌面操作服务。

插件列表显示功能简介和“点击进行具体设置”，点击打开完整设置页；Star 和 Issue 链接位于完整设置页顶部；点“折叠”可将这段说明收为一个带 GitHub 标志的 dsh-computer-use-win 链接，点“展开”恢复。该选择立即保存，重启和升级后保持不变，也不会保存或放弃其他未保存的更改。无法读取宿主配置时会暂停编辑并明确提示，不再将内置默认值当作已经读取的设置。0.4.3 补齐混合版本验证器的实时字段与共享引用协议，使用宿主确认的值回读保存结果。

### 浏览器操控（Browser Use）

默认打开“网页优先用浏览器操控”和“显示浏览器窗口”。DSH 专用浏览器单独启动，用哪个浏览器由“使用的浏览器”决定：默认跟随 Windows 的默认浏览器，默认浏览器不是 Edge 或 Chrome 时用已安装的 Chrome 或 Edge。默认使用临时的空白配置，不加载扩展，不带你的登录、Cookie 和浏览记录（打开“记住登录”后改用保留的配置，见下段）；退出 DSH 或空闲 10 分钟后自动关闭。窗口请求在后台创建，普通网页操作不移动系统鼠标；Chrome 的 JavaScript 模态弹窗实测可能短暂来到前台，不能保证可见浏览器始终不影响焦点；你可以自己切换标签页观看。提示参照 Codex 的浏览器操控，不遮挡网页内容：专用浏览器的窗口框是 DSH 蓝，和你自己的浏览器一眼能分开；DSH 正在操作的标签页，图标换成蓝色箭头，这一轮结束后换回网页自己的图标；网页上一个带光晕的小箭头停在 DSH 点的位置，鼠标点击会穿过它，截图里也没有它。关掉“显示浏览器窗口”后，浏览器在后台运行，没有窗口。JavaScript 模态弹窗会暂停页面脚本，标签页图标在弹窗关闭后同步。

多个 DSH 会话使用同一个保留配置时共用浏览器。结束最早启动它的会话不会关闭其他会话正在用的标签页；最后一个会话退出后正常关闭并保存 Cookie。所有服务意外结束时，独立清理进程会在确认没有活跃会话后关闭浏览器。不同会话的“显示浏览器窗口”设置不一致时会明确报冲突，先结束旧会话或统一设置再重试。

“记住登录（cookies）”默认关闭。打开后，DSH 专用浏览器给每个浏览器保留一个配置（`%LOCALAPPDATA%\dsh-computer-use-win\agent-browser` 下的 `kept-edge`、`kept-chrome`），不再每次用临时配置：你在它的窗口里登录过的网站，之后的任务里还是登录状态，会话 Cookie 也保留。第一次用到要登录的网站时，agent 会请你在这个窗口里登录一次，密码和验证码由你自己输入；“显示浏览器窗口”关着时要先打开它。你自己的浏览器始终不碰，不用开远程调试，也不弹允许提示。用 Edge 时，Edge 会自动用 Windows 上的微软账户登录这个配置，微软自家的网站直接是登录状态（实测 Edge 156 没有开关能关掉）；不想这样就选 Chrome。关掉开关后登录仍然保留，要全部清除，退出 DSH 后删除这个文件夹。打开这个开关时，设置页会说明这些，并列出风险：DSH 会以你的身份操作你在这里登录过的网站；网页上的文字可能诱导 agent；DSH 浏览器开着时，本机其他程序也能通过它的调试端口连上它。更改这两项会在当前动作结束后重连插件服务，并关闭已打开的 DSH 浏览器。

浏览器操控、读取界面（截图、控件树、文字识别、等待）和在后台完成的控件操作，都不显示屏幕边缘、提示条和鼠标标签，也不挂全局 Esc：这样的一轮操作里，你在其他程序按 Esc 不会被拦下；要停止，用 DSH 里的停止按钮。同一轮里一旦用到真实的鼠标或键盘，接管提示和 Esc 从这一步开始照常生效；按 Esc 停下的一轮，后续的浏览器操控也不再执行。

网页能完成的步骤优先使用浏览器通道；原生应用、浏览器工具栏、无可用 CDP 连接、iframe 内容和 canvas 坐标动作，转为同一目标窗口的 UIA，再用截图/OCR/坐标兜底。必须重新读取桌面状态，不把网页坐标当屏幕坐标。不确定是否成功的动作先观察再决定，不能盲目重放。停止、取消、权限拒绝、禁用或只读控件，不允许通过桌面输入绕过。临时浏览器没有用户登录状态，不能代替已登录工作流。精简/自定义禁用 set_value 时不能新开标签页。设置修改在当前动作完成后重连，会关闭临时浏览器。

### 工具加载

在 **全部 / 精简 / 懒启动 / 自定义** 一排选项里选择，默认全部 24 项（23 项桌面工具加管理入口），下方一行说明当前方案。每项设置左边是一张随设置变化的小示意图，右边是名称和开关，两项一行。详细说明收在 ⓘ 图标里，鼠标停上去、点一下或用键盘聚焦时在图标上方弹出，不会被鼠标指针挡住；鼠标可以移到说明上，点一下后移开也不消失，按 Esc 或点别处关闭。精简固定加载 10 项；自定义才展开内部缩进清单，支持逐项、分组、全选和全部关闭。切换方案会保留自定义勾选，保存后在当前动作结束时生效，重启保留选择。agent 不能重新启用用户关闭的工具。

懒启动仅注册管理入口，允许全部工具按需加载；启动显示“1 项，允许全部 24 项”。切换回自定义会恢复原清单。使用桌面工具前需要加载，`reset` 恢复为管理入口。

### 接管提示

屏幕边缘光晕与提示条、鼠标光斑／DSH 标签独立开关。提示位置、远程与录屏可见、提示文字和结束后的隐藏延时（200–3000 毫秒）收在“更多选项”里；示意图跟着开关和提示位置变化；保存后点标题旁的“预览”查看屏幕上的实际效果。提示层不抢焦点、鼠标可穿透，不修改系统光标主题。

“远程与录屏可见”默认开启，让 UU、屏幕共享及录屏可以捕获提示。关闭后请求 Windows 在支持的捕获路径中排除提示。组件通过原生活动显示器枚举、显示／会话事件及接管期间 500 毫秒复核刷新，处理虚拟屏幕新增、移除、重连和布局／DPI 变化。

DSH 从一轮操作第一次用到鼠标或键盘开始持续显示提示，包括之后的截图、读取和短暂思考。轮次完成、取消或异常退出后按延时收起；最后一次桌面调用完成后空闲 30 秒，也会收起提示并释放占用，下一次调用重新显示。仍在执行的动作不会被当作空闲。普通文件读写或 shell 命令不单独触发提示。其他对话正在接管桌面时返回忙碌状态，避免两个任务交错操作鼠标。宿主活动租约过期后会释放提示。独立 stdio 客户端没有 DSH 的轮次边界，保持单次调用显示。

### 对话中的操作记录

工具调用使用鼠标图标和简洁操作描述，点击展开相关截图与检查入口。轮次结束后汇总步骤；重开对话时从已有会话事件恢复。输入已发送与效果已验证分开表达，未完成和已停止会明确显示。浏览器搜索摘要以实际输入、提交和后续观察为依据。

控件操作优先在后台完成：Win32 按钮用 BM_CLICK，输入框用 EM_REPLACESEL，带滚动条的控件用 WM_VSCROLL，其他控件用 UIA，不动鼠标、不抢前台；有的程序在 UIA 调用里会自己切到前台或移动鼠标，插件随即还回去。坐标点击、粘贴和按键仍用当前 Windows 桌面的真实鼠标键盘：目标窗口只在这一步来到前面，点击前检查落点没有被别的窗口挡住；做完后，鼠标若还停在 DSH 放的位置就移回你原来的位置，前台还给你原来的窗口。动作打开了菜单、下拉列表或对话框，或者你中途换了窗口、移了鼠标，就保持现状。前台还给你之后，不指定窗口的后续操作仍对准 DSH 刚操作的窗口。粘贴的文字不进剪贴板历史（Win+V），粘贴后恢复原来的剪贴板。

### 停止与恢复

按物理 **Esc** 停止。也可在“自定义停止方式”点击“录制快捷键”，按 F8 或 Ctrl + Alt + K 等按键／组合键并保存；标题旁的“恢复默认（Esc）”清除额外快捷键。录制时 Esc 用于取消；失焦或 15 秒未录入会退出录制。

Esc 只停止当前这一轮及其排队操作，同一轮不会自动重试。下次发起任务或发送“继续”时自动可用，无需进入设置恢复。普通鼠标移动与其他按键不会停止；程序发送的按键不视为物理停止输入。关闭提示仍保留停止监听。浏览器操控、读取界面和后台控件操作不占用 Esc；一轮操作用到鼠标键盘之前，要停止请用 DSH 里的停止按钮。

取消会在可分段输入与 UIA 解析后的执行边界检查，并在收尾时释放按住的输入。已送达应用的操作无法撤回，阻塞的应用 Provider 调用需要先返回。按 Esc 不会请求重启或退出 DSH，也不能据此判断应用崩溃。

## English

Upgrade and fully restart DSH Desktop, then open **Settings → Computer Use** (mouse icon; 电脑操控 in the Chinese interface). A plugin-page entry and the legacy configurable card are also available. Modern DSH uses the `mcp-dsh-computer-use-win` Config namespace; the older API uses `windows-computer-use`. Back up and remove any temporary duplicate adapter/MCP override added for #29 before using the bundled entry.

The plugin list shows a short introduction that opens the complete settings page. Star and Issue links stay at the top of that page; Collapse folds that note into one dsh-computer-use-win link with the GitHub mark and Expand restores it. The choice saves at once, persists across restarts and upgrades, and neither saves nor discards other pending changes. An unavailable host form shows an explicit state and cannot be edited. Version 0.4.3 supplies live-field metadata and the shared reference protocol for mixed-version validators, and confirms saved values against the host response.

Prefer Browser Use for web pages and Show the browser window are on by default. The DSH browser starts separately, in the browser chosen under Browser (by default the Windows default browser, and an installed Chrome or Edge when that is neither), with no extensions and, by default, a temporary empty profile: none of your sign-ins, cookies or history (with Keep sign-ins on it keeps one profile instead; see below). It closes when DSH exits or after 10 idle minutes. Its window is requested in the background and page actions never move the desktop pointer. Chrome JavaScript modal dialogs may briefly activate the window, so visible operation is not an unconditional focus guarantee. As in Codex's Browser Use, nothing covers the page: the window frame is DSH blue, so it is never taken for your own browser; the tab DSH works in shows a blue arrow as its icon until the turn ends, then its own icon again; and a small glowing arrow rests where DSH clicks. Clicks pass through the arrow, and screenshots leave it out. With Show the browser window off, the browser runs in the background with no window. Browser Use, reads (screenshots, control trees, OCR, waits) and control actions done in the background show no screen edges, banner or pointer tag and arm no global Esc, so Esc keeps working in your other apps; stop such a turn with the stop button in DSH. Once a turn uses the real mouse or keyboard, the indicator and Esc apply from that call on, and a series stopped with Esc refuses its later Browser Use calls too.

DSH sessions using the same kept profile share one browser. Ending its first client preserves other clients’ tabs; the last client closes it gracefully to save cookies. A detached cleanup watcher closes it after all clients unexpectedly exit. Conflicting Show browser window settings produce an explicit error; end the older session or align the settings before retrying.

Keep sign-ins (cookies) is off by default. When on, the DSH browser keeps one profile per browser (`kept-edge`, `kept-chrome` under `%LOCALAPPDATA%\dsh-computer-use-win\agent-browser`) instead of a temporary one: sites you sign in to in its window stay signed in for later tasks, session cookies included. The first time a task needs a site that asks you to sign in, the agent asks you to sign in once in that window; you type passwords and codes yourself, and Show the browser window must be on. Your own browser is never touched: no remote debugging to turn on and no prompts to allow. With Edge, Edge signs this profile in with the Microsoft account of your Windows, so Microsoft’s own sites are signed in already (Edge 156 has no switch for this); choose Chrome to avoid it. Sign-ins stay when you turn the switch off; to remove them all, exit DSH and delete the folder. With the switch on, the settings page explains this and lists the risks: DSH acts as you on the sites you signed in to there; page text can try to steer the agent; and while the DSH browser runs, other programs on this computer can connect to it through its debugging port. Changing Browser or Keep sign-ins reconnects the plugin’s server after the current action and closes open DSH browsers.

Choose **All / Lite / Lazy / Custom** in one row; a line below describes the selected preset, and each setting shows a small picture of its effect beside its name and switch, two to a row. Details open above the ⓘ icon on hover, click or keyboard focus, so the pointer never covers them; the pointer can move onto the text, a click keeps it open, and Esc or a click elsewhere closes it. All is the default (24 entries); Lite loads 10. Custom reveals the indented checklist with individual/group selection, select-all and disable-all. Preset changes preserve your custom selection. Save applies after the current action finishes and survives restart. Management cannot re-enable user-disabled tools.

Lazy starts with one management entry while allowing all tools to be loaded on demand. Switching back to Custom restores its saved list; reset returns Lazy to management only.

The screen edge glow/status pill and the pointer glow/DSH tag have independent controls. Their pictures follow the switches and the top/bottom placement. Customize text, placement and the 200–3000ms hide delay under More options, save and preview. The layers let clicks pass through, keep focus and leave Windows cursor themes intact. **Visible in remote sessions and recordings** is on by default, including virtual displays. Turning it off requests capture exclusion on supported Windows capture paths. Active monitor enumeration, display/session events and a 500ms topology check refresh the layers after display, layout or DPI changes. The indicators cover this plugin's complete desktop operation series, or a requested preview.

Physical **Esc**, or a recorded key/combination, stops the current operation series and queued input. It cannot retry in the same turn. A new user task or request to continue can use the desktop automatically, without visiting settings. Record a shortcut and save; Restore default (Esc), next to the section title, clears the additional key. Esc cancels recording, and blur or 15 seconds of inactivity exits it. Ordinary mouse movement, other keys and injected keys do not trigger a physical stop. Hiding the indicator keeps the listener active. Browser Use, reads and background control actions do not take Esc; until a turn first uses the mouse or keyboard, stop it with the stop button in DSH.

In DSH, indicators appear with the first call that uses the real mouse or keyboard and stay visible through later observations and short reasoning gaps. They release on turn completion/cancellation, or after 30 idle seconds following the last completed desktop call; the next call shows them again. Running tools do not count as idle. A host lease releases stale state; another conversation receives a busy result while the desktop is owned. Standalone stdio clients retain per-call indicators because they provide no DSH turn boundary. Regular mouse movement does not stop a series.

Conversation rows use a mouse icon and readable action descriptions, expandable screenshots and an end-of-turn summary reconstructed from session events. Sent input is distinguished from verified effects. Element operations run in the background where they can: BM_CLICK for Win32 buttons, EM_REPLACESEL for edits, WM_VSCROLL for controls with their own scroll bars, else UIA, with no pointer or foreground change; when an app brings itself forward or moves the pointer during a UIA call, the plugin gives both back. Coordinate clicks, pastes and key presses still use the shared Windows pointer and keyboard: the target comes forward for that step only, a click point covered by another window is refused, and afterwards the pointer returns to where you left it (if it is still where DSH put it) and the foreground to the window you had in front. A menu, drop-down or dialog the action opened, or a window or pointer you changed meanwhile, is left as it is. After the foreground goes back, later actions without a window target still aim at DSH's window. Pasted text stays out of clipboard history (Win+V), and the previous clipboard is restored.

Cancellation is cooperative at segmented-input and post-resolution execution boundaries, with held-input cleanup. Delivered actions cannot be undone, and a blocking application Provider call must return first. Esc does not request an application exit or restart and is not evidence of an application crash.

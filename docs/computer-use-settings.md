# 电脑操控设置 / Computer Use settings

> 当前插件版本 `0.6.3`：设置标题显示包版本，悬停说明使用统一中英文词典，预览与已停止状态互不覆盖。

## 简体中文

升级插件并完整退出、重新启动 DSH Desktop，打开 **设置 → 电脑操控**（鼠标图标；英文界面叫 Computer Use）。新版插件页面也有入口；旧宿主保留可配置插件卡片。DSH 0.2 使用插件条目 ID `mcp-dsh-computer-use-win` 的 Config 表单；旧接口使用 `windows-computer-use`。

若曾为 #29 手动添加独立的 `windows-computer-use` 或 `wincu` 覆盖条目，请先备份 profile 配置，再移除该临时重复条目，使用插件 bundle 提供的入口。避免同时启动两个桌面操作服务。

插件列表显示功能简介和“点击进行具体设置”，点击打开完整设置页；Star 和 Issue 链接位于完整设置页顶部；点“折叠”可将这段说明收为一个带 GitHub 标志的 dsh-computer-use-win 链接，点“展开”恢复。该选择立即保存，重启和升级后保持不变，也不会保存或放弃其他未保存的更改。无法读取宿主配置时会暂停编辑并明确提示，不再将内置默认值当作已经读取的设置。0.4.3 补齐混合版本验证器的实时字段与共享引用协议，使用宿主确认的值回读保存结果。

### 更新

DSH 启动时自动查询 npm 的 `latest`。打开设置页时，上次查询失败或结果超过 6 小时会重查。GitHub 左侧只有一个按钮：已安装版本等于或高于 `latest` 时是“检查更新”，点击后跳过市场缓存重查，并短暂显示“已是最新版本”或“暂时无法检查更新”；确认有新版时变成“更新”。导航不显示标记。点击“更新”后重核 npm 与 DSH 市场目标，由市场下载安装并核对实际版本。市场的镜像还没同步到新版本时，页面每 15 秒重查一次，最多等 10 分钟，期间说明在等同步；新版本还在市场的等待期内时，这次点击会以强制方式再提交一次（市场在此之前已做完宿主兼容检查）。市场一次只做一件安装，正忙时页面每 5 秒再问一次，最多等 3 分钟；有 agent 正在运行时市场不更新，页面提示等它结束后重试。版本先查 npm 官方源，连不上再查腾讯云和 npmmirror 镜像；下载安装由 DSH 插件市场完成，线路跟随它的“下载区域”设置（“全球”直接从 npm 下载，“中国大陆”走镜像）。标题下方显示进度条和当前步骤：等插件市场同步、正在准备、正在查找安装包、正在下载安装包（显示已下载和总大小）、正在安装。旁边的 **停止更新** 在插件市场开始替换插件文件之前都能用；替换文件这一步不能中断（中途打断会让旧版本残缺，市场随后会把插件移除），按钮变灰并说明原因。停下后页面核对插件仍是原来的版本，并写明“已停止更新”。提交更新之前，插件先确认自己的文件夹没有被别的程序占用（把文件夹改名再改回来，这正是市场替换文件时要做的操作）；被占用时不开始更新，说明怎么办（退出 DSH 再重新打开，关掉打开着这个文件夹的资源管理器或终端窗口），已装好的插件不受影响。按钮更新不成功时，页面还会提示可以到插件市场里更新（市场收录新版本比 npm 晚一些），并能直接打开插件市场的“已安装”选项卡、搜好本插件。装好后弹出对话框，写明已更新到的版本，以及还差哪一步：需要重启时提醒“重启会中断正在进行的任务”，并给出 **立即重启** 和 **稍后**。dsh web 由插件市场重启；DSH Desktop 由插件自己重启：先像安装程序那样让 DSH Desktop 正常退出，退出后再自动打开。点 **稍后** 后，标题旁会一直显示 **重启以完成更新**，点它重新打开这个对话框。一分钟后页面仍在、说明没重启成功时，对话框改为手动步骤（从托盘退出后重新打开）。只需刷新页面或已直接生效时，对话框也照实说明。无市场或本地安装时，“更新”打开升级说明。

重新加载设置页时，页面会查询同一次更新并恢复确认弹窗。点 **稍后** 或按 Esc 可关掉弹窗。只要还需要重启，就能用标题旁的 **重启以完成更新** 再打开。

### 反馈问题

标题右侧的“反馈问题”每次导出一份 TXT。下载文件夹写入失败时，Windows 会弹出“另存诊断文件”，可选择其他位置。保存后，插件在资源管理器中选中文件，并请求默认浏览器打开 GitHub 新建问题页。对话框显示文件名、完整路径，以及反馈页是否已打开。TXT 包含运行环境、相关设置、自检、最近 30 次工具调用和最多 200 行插件日志。工具输入文字只保留长度，无法可靠脱敏的日志条目会被省略，截图可由用户另行附上。

### 工作方式

按你这时还用不用电脑来选，随时可以切换，切换立即生效，不用重启：

- **少打扰**（默认）：你可以照常用电脑。读窗口、按按钮、填输入框都用 UI 自动化在后台完成，网页在后台标签页里操作。DSH 自己用 `launch_app` 打开的程序放在当前 Windows 会话里一个看不见的后台桌面上，沿用你的账号、文件权限、已安装软件和 DSH 启动环境，不会弹到你面前；`list_windows` 把这些窗口标成 `desktop:"background"`。后台做不了的步骤（快捷键、拖拽、画图、只认真实鼠标键盘的程序）马上借用你的鼠标键盘，不等你停手：DSH 操作的窗口闪到前面，做完把窗口和鼠标放回原处。这一下里你按的键、点的鼠标先存起来，窗口还给你之后原样补上，不会丢，也不会打进 DSH 的窗口；Esc 照常停止 DSH。只在打断会坏事时等一下：你正按着键或鼠标（比如在拖东西）、拼音还没上屏，或在用全屏程序（全屏游戏、放幻灯片）。DSH 打开的菜单或对话框留在前面时，你接着打字，窗口先还给你，字打进你的窗口。少打扰从不把窗口一直顶在最前面。设置页里，这几条细节收在默认折叠的“更多说明”里。
- **前台操作**：适合你暂时不用电脑时。DSH 把工作窗口一直留在最前面，直接用鼠标键盘，不等你，也不在每步之后还原，所以最快、最稳，菜单也不会被打断。屏幕顶部提示“DSH 正在前台操作，请别动鼠标键盘”，按 Esc 随时停止。
- **虚拟机**：在 Hyper-V 虚拟机里操作，完全不碰你的电脑；用的是虚拟机里的文件和软件，第一次要先配置（见下一节）。

后台桌面上的程序只接受 UI 自动化和窗口消息，按坐标点击、拖拽、系统组合键和整屏截图到不了那里；需要这些时，agent 会关掉它，用 `desktop:"current"` 在你的桌面上重新打开。快捷方式、商店应用和已安装应用的名称只能在你的桌面上打开。已在你的桌面上运行的单实例程序会把窗口开在你的桌面上。普通设置保存和 MCP 重连会保留后台桌面上的程序；选 **虚拟机** 或退出 DSH 会关闭它们，没保存的内容会丢失。

### 虚拟机（Hyper-V）

在 **工作方式** 选 **虚拟机**，设置页会列出下面的配置步骤，只需做一次：

1. 打开 Hyper-V：在“启用或关闭 Windows 功能”里勾选 Hyper-V 并重启。Windows 家庭版没有 Hyper-V。
2. 允许你的账户管理 Hyper-V：以管理员身份打开 PowerShell，运行 `Add-LocalGroupMember -SID S-1-5-32-578 -Member (whoami)`，再注销后重新登录。DSH 没有以管理员身份运行时，Windows 只让“Hyper-V Administrators”组的成员查询和连接虚拟机；这个组用 SID 指定，任何语言的 Windows 都一样。
3. 在 Hyper-V 管理器里新建一台 Windows 10 或 11 虚拟机，并在里面安装 Node.js 22 或更新版本。
4. 在虚拟机里用你的 Windows 账户登录桌面，保持登录。Hyper-V 的预览窗口可以关掉。
5. 在设置页填写虚拟机名称（与 Hyper-V 管理器里显示的一致），点 **保存更改**。
6. 点 **配置连接**，在弹出的窗口里输入第 4 步那个账户的用户名和密码（不是 PIN）。Windows 会将凭据加密保存给当前主机账户使用。

**配置连接** 先用这组凭据登录虚拟机，再检查虚拟机里是否已有这个账户登录的桌面、是否装了 Node.js 22 或更新版本。结果会指出该做哪一步：Hyper-V 没打开指向第 1 步，账户没有权限指向第 2 步，找不到虚拟机指向第 5 步，登录失败指向第 4、6 步；凭据可用但虚拟机里还差桌面登录或 Node.js 时，凭据已保存，补上那一步后再点一次 **配置连接** 检查。Windows 的原始提示放在结果的提示框里。

之后浏览器、截图、鼠标和键盘操作都在选定的虚拟机内执行。截图会复制回主机。应用读写虚拟机里的文件，并使用虚拟机安装的软件和运行环境。需要处理主机文件时，先把文件复制或共享到虚拟机。Hyper-V 管理器里的预览窗口可以关闭。要取消操作，用主机 DSH 的停止按钮。连接、登录或启动失败时，本轮操作会暂停。要回到本机操作，选回 **少打扰** 或 **全速**。

### Agent 看不到电脑操控工具

先在诊断 TXT 中找“宿主 MCP 注册”。`configuredToolCount` 是设置允许的工具数，`registeredToolCount` 是宿主全局注册表里的工具数，`liveAdapterCount` 是同一宿主进程中运行的 Wincu 实例数。`firstBridgeStartupMs` 记录首次等待 MCP 桥接启动和工具注册的总耗时。桥接版本提供状态接口时，还会显示连接状态、桥接注册数和连接错误。懒启动最初只注册管理工具。这些信息来自正在运行的 DSH，独立自检只检查插件后端。

宿主注册了工具、当前 Agent 仍看不到时，查看该 Agent 的工具列表。该会话如果有 Cordis 检查工具，先通过 `cordis_inspect_list` 确认 `Tool` provider，再用 `cordis_inspect_query` 查询 `{"platform":"host","provider":"Tool","method":"listTools","input":{}}`。DSH 按 Agent 作用域决定全局工具是否可见，自定义 preset 的筛选也可能影响结果。0.2.2-rc.3 自带 preset 使用 `@deepseek-ai/dsh-agent-preset` 的 `config.plugins` 条目列表，例如 `@deepseek-ai/dsh-web-app/presets/minimal.patch.yml`。插件的 `mcp-dsh-computer-use-win` 是宿主 Loader 条目的 ID，标准安装已挂载该条目。

如果报告里的 `peerMismatches` 列出了不同版本，用该 DSH 安装随附的桥接包复测。工具注册已在 0.2.2-rc.3 和 rc.5 同版本组合，以及 rc.3 宿主搭配 rc.5 桥接的组合中验证。

### 浏览器操控（Browser Use）

DSH 浏览器按需启动。首次用 `set_value` 时只传 `elementId: "new-tab"` 和网址 `value`，之后用返回的 `opened.id` 读取网页。启动失败时，`list_windows` 和 `health` 的 `browserLane.agent` 会显示 Chromium 启动状态和可用的退出原因。要读取原本已打开的可见窗口，使用 `list_windows` 返回的 `nativeWindowHandle`，再调用 `snapshot`。此时省略 `browserTab` 或传 `"desktop"`，后续操作使用新快照里的桌面控件和坐标。

默认打开“优先使用网页控件”和“显示 DSH 浏览器窗口”。DSH 专用浏览器单独启动，用哪个浏览器由“浏览器类型”决定：默认跟随 Windows 的默认浏览器，默认浏览器不是 Edge 或 Chrome 时用已安装的 Chrome 或 Edge。默认使用临时的空白配置，不加载扩展，不带你的登录、Cookie 和浏览记录（打开“保留网站登录”后改用保留的配置，见下段）；退出 DSH 后关闭；无头模式空闲 10 分钟、可见窗口空闲 2 小时后自动关闭，页面活动也延长计时。窗口请求在后台创建，普通网页操作不移动系统鼠标；Chrome 的 JavaScript 模态弹窗实测可能短暂来到前台，不能保证可见浏览器始终不影响焦点；你可以自己切换标签页观看。提示参照 Codex 的浏览器操控，不遮挡网页内容：专用浏览器的窗口框是 DSH 蓝，和你自己的浏览器一眼能分开；DSH 正在操作的标签页，图标换成蓝色箭头，这一轮结束后换回网页自己的图标；网页上一个带光晕的小箭头停在 DSH 点的位置，鼠标点击会穿过它，截图里也没有它。关掉“显示 DSH 浏览器窗口”后，浏览器在后台运行，没有窗口。JavaScript 模态弹窗会暂停页面脚本，标签页图标在弹窗关闭后同步。

多个 DSH 会话使用同一个保留配置时，通过 Windows 私有命名管道共用浏览器。各任务应使用自己打开的标签页 ID。插件按配置目录协调启动、退出和崩溃恢复。结束最早启动它的会话不会关闭其他会话正在用的标签页；最后一个会话退出后正常关闭并保存 Cookie。所有服务意外结束时，独立清理进程会在确认没有活跃会话后关闭浏览器。不同会话的“显示 DSH 浏览器窗口”设置不一致时会明确报冲突，先结束旧会话或统一设置再重试。

“保留网站登录”默认关闭。打开后，DSH 专用浏览器给每个浏览器保留一个配置（`%LOCALAPPDATA%\dsh-computer-use-win\agent-browser` 下的 `kept-edge`、`kept-chrome`），不再每次用临时配置：你在它的窗口里登录过的网站，之后的任务里还是登录状态，会话 Cookie 也保留。第一次用到要登录的网站时，agent 会请你在这个窗口里登录一次，密码和验证码由你自己输入；“显示 DSH 浏览器窗口”关着时要先打开它。使用 DSH 专用浏览器时不用设置你自己的浏览器，也不弹允许提示。另选“连接现有浏览器”时按下面的实验选项说明操作。用 Edge 时，Edge 会自动用 Windows 上的微软账户登录这个配置，微软自家的网站直接是登录状态（实测 Edge 156 没有开关能关掉）；不想这样就选 Chrome。关掉开关后登录仍然保留，要全部清除，退出 DSH 后删除这个文件夹。打开这个开关时，设置页会说明这些，并列出风险：DSH 会以你的身份操作你在这里登录过的网站；网页上的文字可能诱导 agent；不使用本地调试端口，但登录保存在本地配置文件夹中，同账户下的本机其他程序也能读取使用。更改这两项会在当前动作结束后重连插件服务，并关闭已打开的 DSH 浏览器。

浏览器操控、读取界面（截图、控件树、文字识别、等待）和在后台完成的控件操作，都不显示屏幕边缘、提示条和鼠标标签，也不挂全局 Esc：这样的一轮操作里，你在其他程序按 Esc 不会被拦下；要停止，用 DSH 里的停止按钮。同一轮里一旦用到真实的鼠标或键盘，接管提示和 Esc 从这一步开始照常生效；按 Esc 停下的一轮，后续的浏览器操控也不再执行。

网页能完成的步骤优先使用浏览器通道；原生应用、浏览器工具栏、无可用 CDP 连接、浏览器通道无法处理的内容，转为同一目标窗口的 UIA，再用截图/OCR/坐标兜底。必须重新读取桌面状态，不把网页坐标当屏幕坐标。不确定是否成功的动作先观察再决定，不能盲目重放。停止、取消、权限拒绝、禁用或只读控件，不允许通过桌面输入绕过。临时浏览器没有用户登录状态，不能代替已登录工作流。精简/自定义禁用 set_value 时不能新开标签页。设置修改在当前动作完成后重连，会关闭临时浏览器。

Firefox 系网页通道为实验功能：选择“Firefox 系（实验性）”后，自动启动需关闭“显示 DSH 浏览器窗口”；也可以通过显式 BiDi 端点连接单独启动的浏览器。默认浏览器选项仍按上述 Chrome/Edge 规则回退。Firefox 不具备上述蓝色状态提示、可见登录和多会话共享流程；具体范围见 [BiDi 说明](browser-bidi.md)。桌面通道读取现有 Gecko 窗口无需启用实验选项。

### 工具加载

在 **全部 / 精简 / 懒启动 / 自定义** 一排选项里选择，默认全部 26 项（25 项操作工具加管理入口），下方一行说明当前方案。每项设置左边是一张随设置变化的小示意图，右边是名称和开关，两项一行。详细说明收在 ⓘ 图标里，鼠标停上去、点一下或用键盘聚焦时在图标上方弹出，不会被鼠标指针挡住；鼠标可以移到说明上，点一下后移开也不消失，按 Esc 或点别处关闭。精简固定加载 12 项；自定义才展开内部缩进清单，支持逐项、分组、全选和全部关闭。切换方案会保留自定义勾选，保存后在当前动作结束时生效，重启保留选择。agent 不能重新启用用户关闭的工具。

懒启动仅注册管理入口，允许全部工具按需加载；启动显示“1 项，允许全部 26 项”。从别的方案切到自定义时，清单默认全部勾选，取消勾选后保存才生效；已经保存为自定义的清单照常显示。使用桌面工具前需要加载，`reset` 恢复为管理入口。

### 接管提示

屏幕边缘光晕与提示条、鼠标光斑／DSH 标签独立开关。提示位置、远程与录屏可见、提示文字和结束后的隐藏延时（200–3000 毫秒）收在“更多选项”里；示意图跟着开关和提示位置变化；保存后点标题旁的“预览”查看屏幕上的实际效果；若设置了自定义停止快捷键，提示条会一并显示。提示层不抢焦点、鼠标可穿透，不修改系统光标主题。提示文字保持默认时跟随 DSH 的界面语言，浮窗文字和 AI 总结也一样。

“远程与录屏可见”默认开启，让 UU、屏幕共享及录屏可以捕获提示和思考与操作浮窗，包括浮窗里模型的思考和回复。关闭后请求 Windows 在支持的捕获路径中排除这些内容。组件通过原生活动显示器枚举、显示／会话事件及接管期间 500 毫秒复核刷新，处理虚拟屏幕新增、移除、重连和布局／DPI 变化。

DSH 从一轮操作第一次用到鼠标或键盘开始持续显示提示，包括之后的截图、读取和短暂思考。轮次完成、取消或异常退出后按延时收起；最后一次工具活动或模型输出后空闲 30 秒，也会收起提示并释放占用，下一次调用重新显示。仍在执行的动作不会被当作空闲。普通文件读写或 shell 命令不单独触发提示。其他对话正在接管桌面时返回忙碌状态，避免两个任务交错操作鼠标。宿主活动租约过期后会释放提示。独立 stdio 客户端没有 DSH 的轮次边界，保持单次调用显示。

### 对话中的操作记录

工具调用使用鼠标图标和简洁操作描述，点击展开相关截图与检查入口。轮次结束后汇总步骤；重开对话时从已有会话事件恢复。输入已发送与效果已验证分开表达，未完成和已停止会明确显示。浏览器搜索摘要以实际输入、提交和后续观察为依据。

控件操作优先在后台完成：Win32 按钮用 BM_CLICK，输入框用 EM_REPLACESEL，带滚动条的控件用 WM_VSCROLL，其他控件用 UIA，不动鼠标、不抢前台；有的程序在 UIA 调用里会自己切到前台或移动鼠标，插件随即还回去。坐标点击、粘贴和按键仍用当前 Windows 桌面的真实鼠标键盘：目标窗口只在这一步来到前面，点击前检查落点没有被别的窗口挡住；做完后，鼠标若还停在 DSH 放的位置就移回你原来的位置，前台还给你原来的窗口。动作打开了菜单、下拉列表或对话框，或者你中途换了窗口、移了鼠标，就保持现状。前台还给你之后，不指定窗口的后续操作仍对准 DSH 刚操作的窗口。粘贴的文字不进剪贴板历史（Win+V），粘贴后恢复原来的剪贴板。

### 停止与恢复

按 **Esc** 停止。也可在“自定义停止方式”点击“录制快捷键”，按 F8 或 Ctrl + Alt + K 等按键／组合键并保存（提示条会显示 `Esc / 自定义键`）；标题旁的“恢复默认（Esc）”清除额外快捷键。录制时 Esc 用于取消；失焦或 15 秒未录入会退出录制。

Esc 只停止当前这一轮及其排队操作，同一轮不会自动重试。下次发起任务或发送“继续”时自动可用，无需进入设置恢复。普通鼠标移动与其他按键不会停止；仅忽略携带插件标记的自身按键，未带该标记的远程 Esc 也可停止。关闭装饰提示仍保留停止监听。同一 Windows 用户会话内，一处停止会通知其他正在控制桌面的插件后端。浏览器操控、读取界面和后台控件操作不占用 Esc；一轮操作用到鼠标键盘之前，要停止请用 DSH 里的停止按钮。

取消会在可分段输入与 UIA 解析后的执行边界检查，并在收尾时释放按住的输入。已送达应用的操作无法撤回，阻塞的应用 Provider 调用需要先返回。按 Esc 不会请求重启或退出 DSH，也不能据此判断应用崩溃。

## English

Upgrade and fully restart DSH Desktop, then open **Settings → Computer Use** (mouse icon; 电脑操控 in the Chinese interface). A plugin-page entry and the legacy configurable card are also available. Modern DSH uses the `mcp-dsh-computer-use-win` Config namespace; the older API uses `windows-computer-use`. Back up and remove any temporary duplicate adapter/MCP override added for #29 before using the bundled entry.

The plugin list shows a short introduction that opens the complete settings page. Star and Issue links stay at the top of that page; Collapse folds that note into one dsh-computer-use-win link with the GitHub mark and Expand restores it. The choice saves at once, persists across restarts and upgrades, and neither saves nor discards other pending changes. An unavailable host form shows an explicit state and cannot be edited. Version 0.4.3 supplies live-field metadata and the shared reference protocol for mixed-version validators, and confirms saved values against the host response.

DSH checks npm’s `latest` automatically at startup and repeats an old or failed check when settings open. One button sits left of GitHub: Check for updates while the installed version is current, which checks again past the market cache and briefly shows Up to date or Could not check for updates; Update when a newer npm release exists. The navigation shows no badge. Clicking Update rechecks the npm and market targets before the market installs and verifies the package. While the market’s mirror has not picked up the release, the page checks again every 15 seconds for up to 10 minutes and says it is waiting; a release still inside the market’s waiting period is sent once more with force, after the market has checked host compatibility. The market runs one install at a time: while it is busy, the page asks again every 5 seconds for up to 3 minutes; while an agent is running the market does not update, and the page says to retry after it finishes. The version check asks npm’s registry first and the Tencent Cloud and npmmirror mirrors only when npm cannot be reached; the DSH plugin market downloads and installs over the route its Download region setting names (Global downloads straight from npm, China mainland uses a mirror). Below the title a bar and the current step show the progress: waiting for the plugin market to pick up the release, preparing, finding the package, downloading the package (with the bytes so far and the total), installing. **Stop update** beside it works until the plugin market starts replacing the plugin's files; that step cannot be interrupted (stopping it midway leaves the old version incomplete, and the market then removes the plugin), so the button is disabled and says why. After a stop the page checks that the plugin is still the version it was and says the update stopped. Before it asks for the update, the plugin checks that no other program holds its folder (by renaming the folder away and back, the same operation the market needs to replace it); when something does, the update is not started and the page says what to do (quit and reopen DSH, close any File Explorer or terminal window open in that folder), and the installed plugin is left as it was. When the button cannot update, the page also suggests updating in the plugin market, which lists new versions some time after npm, and opens the market's Installed tab with this plugin searched. When the install finishes, a dialog names the new version and the step left: a restart says that it stops any task in progress and offers **Restart now** and **Later**. On dsh web the plugin market restarts DSH; on DSH Desktop the plugin does, quitting DSH Desktop the way its installer does and opening it again. After **Later**, **Restart to finish** stays by the title and opens the dialog again. If the page is still open a minute later, DSH did not restart, and the dialog gives the manual steps (quit from the tray and reopen). A reload or a change already in use is stated the same way. Without a market or for a local install, Update opens the upgrade instructions.

Reloading settings in the same window recovers the confirmation for an update started there. **Later** or Escape dismisses the dialog. **Restart to finish** stays by the title while a restart is required and can reopen the dialog.

Report a problem exports one TXT at a time. If writing to Windows Downloads fails, Save As lets you choose another location. After saving, the plugin selects the file in File Explorer and asks the default browser to open GitHub’s new-issue page. The dialog shows the file name, full path and whether the issue page opened. The TXT contains environment details, relevant settings, a self-test, the last 30 tool calls and up to 200 plugin log lines. Tool input text is kept as its length. Log entries that cannot be reliably redacted are omitted. You can attach screenshots separately.

### Work mode

Choose by whether you are using the PC right now. You can switch at any time; the change applies at once, without a restart:

- **Low disruption** (the default): keep using your PC. Reading windows, pressing buttons and filling in fields go through UI Automation in the background, and web pages are worked in background tabs. Apps DSH opens with `launch_app` run on a hidden desktop in your current Windows session that keeps your account, file permissions, installed apps and the environment DSH started with, and never pop up in front of you; `list_windows` marks their windows `desktop:"background"`. Steps the background cannot do (shortcuts, drags, drawing, apps that accept only real input) borrow your mouse and keyboard at once, without waiting for you to stop: the window DSH works in comes forward, and the window and pointer go back afterwards. What you type or click in that moment is held and replayed once your window is back, so nothing is lost or typed into DSH's window; Esc still stops DSH. DSH waits only where interrupting would break what you are doing: while you hold a key or button (dragging something), have input-method text not yet committed, or use a full-screen app (a game, a slideshow). If a menu or dialog DSH opened stays in front, your next keystroke first gives the foreground back to your window and goes there. Low disruption never keeps a window in front. On the settings page these details sit under More details, folded by default.
- **Foreground**: for when you step away. DSH keeps its window in front and uses the mouse and keyboard directly, does not wait for you and does not restore anything between steps, which is fastest and keeps menus open. The banner at the top says DSH is working in the foreground; press Esc to stop at any time.
- **Virtual machine**: works inside a Hyper-V virtual machine and never touches your PC; it uses the VM’s own files and apps. Set it up once first (next section).

Apps on the hidden desktop take UI Automation and window messages only: clicks at screen positions, drags, system key combinations and full-screen screenshots cannot reach them. For those the agent closes the app and opens it again on your desktop with `desktop:"current"`. Shortcuts, Store apps and installed-app names open on your desktop only. A single-instance app already running on your desktop opens its window there. Ordinary settings changes and MCP reconnects keep the apps on the hidden desktop; choosing **Virtual machine** or quitting DSH closes them, and anything unsaved there is lost.

### Virtual machine (Hyper-V)

Select **Virtual machine** under **Work mode**. The settings page lists these setup steps; they are needed once:

1. Turn on Hyper-V: in “Turn Windows features on or off”, select Hyper-V and restart. Windows Home does not have Hyper-V.
2. Let your account manage Hyper-V: open PowerShell as administrator, run `Add-LocalGroupMember -SID S-1-5-32-578 -Member (whoami)`, then sign out and back in. When DSH does not run as administrator, Windows lets only members of the Hyper-V Administrators group query and connect to virtual machines; the SID names that group in every Windows language.
3. In Hyper-V Manager, create a Windows 10 or 11 virtual machine and install Node.js 22 or later in it.
4. Sign in to the VM’s desktop with your Windows account and stay signed in. You can close the Hyper-V preview window.
5. Enter the VM’s name on the settings page, exactly as Hyper-V Manager shows it, and choose **Save changes**.
6. Choose **Configure connection** and enter that account’s user name and password (not a PIN) in the window that opens. Windows encrypts the saved credential for your current host account.

**Configure connection** signs in to the VM with that credential, then checks that the account has a signed-in desktop there and that Node.js 22 or later is installed. The result names the step to look at: step 1 when Hyper-V is off, step 2 when your account lacks permission, step 5 when no VM has that name, steps 4 and 6 when signing in fails. When the credential works but the VM still lacks the signed-in desktop or Node.js, the credential is saved; finish that step and choose **Configure connection** again to check. Windows’ own message is in the result’s tooltip.

Browser work, screenshots, mouse and keyboard actions run in the selected VM. Wincu copies screenshots back to the host, and other application files stay in the VM. You can close the Hyper-V preview window. Use DSH’s Stop button on the host to cancel a task. If the VM is unavailable, the task stops. Select **Low disruption** or **Full speed** to work on the host again.

### Computer Use tools are missing from an Agent

Find “Host MCP registration” in the diagnostics TXT. `configuredToolCount` is the number of tools the settings allow. `registeredToolCount` counts Computer Use tools in the Host's global registry. The report also shows connection state, bridge tool count and connection errors when the bridge exposes them. Lazy startup begins with one management tool. The separate self-test checks the plugin backend.

If the global registry has tools but the current Agent cannot see them, check the Agent's own tool list. If Cordis inspection is available in that session, confirm the `Tool` provider with `cordis_inspect_list`, then pass `{"platform":"host","provider":"Tool","method":"listTools","input":{}}` to `cordis_inspect_query`. DSH applies the Agent's scope when exposing global tools, so a custom preset can affect visibility. The shipped 0.2.2-rc.3 presets use the `@deepseek-ai/dsh-agent-preset` declaration's `config.plugins` entry list. See `@deepseek-ai/dsh-web-app/presets/minimal.patch.yml` for an example. A standard install mounts the plugin's Host Loader entry, `mcp-dsh-computer-use-win`.

If `peerMismatches` lists different DSH package versions, retest with the bridge shipped with that DSH installation. Tool registration was verified with matched 0.2.2-rc.3 and rc.5 packages and with a rc.3 host paired with a rc.5 bridge.

The DSH browser starts on demand. To open its first tab, call `set_value` with only `elementId: "new-tab"` and the URL as `value`. Use `opened.id` to read the tab. The `browserLane.agent` field in `list_windows` and `health` reports Chromium's startup state and any available exit reason. To read the intended visible Windows window after a failed launch, call `snapshot` with its `nativeWindowHandle` from `list_windows`. Omit `browserTab` or set it to `"desktop"`. Use desktop IDs and coordinates from the new observation.

Prefer web page controls and Show the DSH browser window are on by default. The DSH browser starts separately, in the browser chosen under Browser type (by default the Windows default browser, and an installed Chrome or Edge when that is neither), with no extensions and, by default, a temporary empty profile: none of your sign-ins, cookies or history (with Keep website sign-ins on it keeps one profile instead; see below). It closes when DSH exits, after 10 idle minutes when headless, or after two idle hours with a visible window. Its window is requested in the background and page actions never move the desktop pointer. Chrome JavaScript modal dialogs may briefly activate the window, so visible operation is not an unconditional focus guarantee. As in Codex's Browser Use, nothing covers the page: the window frame is DSH blue, so it is never taken for your own browser; the tab DSH works in shows a blue arrow as its icon until the turn ends, then its own icon again; and a small glowing arrow rests where DSH clicks. Clicks pass through the arrow, and screenshots leave it out. With Show the DSH browser window off, the browser runs in the background with no window. Browser Use, reads (screenshots, control trees, OCR, waits) and control actions done in the background show no screen edges, banner or pointer tag and arm no global Esc, so Esc keeps working in your other apps; stop such a turn with the stop button in DSH. Once a turn uses the real mouse or keyboard, the indicator and Esc apply from that call on, and a series stopped with Esc refuses its later Browser Use calls too.

DSH sessions using the same kept profile share one browser through a private Windows named pipe. The plugin coordinates startup, shutdown and crash recovery per profile directory. Ending its first client preserves other clients’ tabs. The last client closes it gracefully to save cookies. A detached cleanup watcher closes it after all clients unexpectedly exit. Conflicting Show the DSH browser window settings produce an explicit error. End the older session or align the settings before retrying.

Keep website sign-ins is off by default. When on, the DSH browser keeps one profile per browser (`kept-edge`, `kept-chrome` under `%LOCALAPPDATA%\dsh-computer-use-win\agent-browser`) instead of a temporary one: sites you sign in to in its window stay signed in for later tasks, session cookies included. The first time a task needs a site that asks you to sign in, the agent asks you to sign in once in that window; you type passwords and codes yourself, and Show the DSH browser window must be on. Your own browser is never touched: no remote debugging to turn on and no prompts to allow. With Edge, Edge signs this profile in with the Microsoft account of your Windows, so Microsoft’s own sites are signed in already (Edge 156 has no switch for this); choose Chrome to avoid it. Sign-ins stay when you turn the switch off; to remove them all, exit DSH and delete the folder. With the switch on, the settings page explains this and lists the risks: DSH acts as you on the sites you signed in to there; page text can try to steer the agent; no local debugging port is opened, though other programs under your Windows account can still read sign-ins stored in that profile folder. Changing Browser type or Keep website sign-ins reconnects the plugin’s server after the current action and closes open DSH browsers.

Firefox-family Browser Use is experimental: select Firefox family, or configure a separately started BiDi endpoint. The Firefox that the plugin starts runs headless, so choosing Firefox family turns Show the DSH browser window off and locks it until another browser is chosen, which restores its earlier state. Discovery starts with the Windows default browser when it is a Firefox-family one. The default selection retains its Chrome/Edge fallback. The blue status UI, automatic visible sign-in and cross-client sharing described above do not apply to BiDi; see [its scope](browser-bidi.md). Gecko desktop accessibility does not require this option.

Choose **All / Lite / Lazy / Custom** in one row; a line below describes the selected preset, and each setting shows a small picture of its effect beside its name and switch, two to a row. Details open above the ⓘ icon on hover, click or keyboard focus, so the pointer never covers them; the pointer can move onto the text, a click keeps it open, and Esc or a click elsewhere closes it. All is the default (26 entries); Lite loads 12. Custom reveals the indented checklist with individual/group selection, select-all and disable-all. Preset changes preserve your custom selection. Save applies after the current action finishes and survives restart. Management cannot re-enable user-disabled tools.

Lazy starts with one management entry while allowing all tools to be loaded on demand. Choosing Custom from another preset starts with every tool checked and takes effect when saved; a saved Custom selection is shown as saved; reset returns Lazy to management only.

The screen edge glow/status pill and the pointer glow/DSH tag have independent controls. Their pictures follow the switches and the top/bottom placement. Customize text, placement and the 200–3000ms hide delay under More options, save and preview. The layers let clicks pass through, keep focus and leave Windows cursor themes intact. **Visible in remote sessions and recordings** is on by default, including virtual displays, and also covers the progress overlay, so screen sharing and recordings see its text, including the model's reasoning and replies. Turning it off requests capture exclusion for the indicators and the overlay on supported Windows capture paths. Active monitor enumeration, display/session events and a 500ms topology check refresh the layers after display, layout or DPI changes. The indicators cover this plugin's complete desktop operation series, or a requested preview.

**Esc** or a recorded key/combination stops the current operation series and queued input. It cannot retry in the same turn. A new user task or request to continue can use the desktop automatically, without visiting settings. Record a shortcut and save (the screen banner shows it alongside `Esc`); Restore default (Esc), next to the section title, clears the additional key. Esc cancels recording, and blur or 15 seconds of inactivity exits it. Ordinary mouse movement and other keys do not trigger a stop. Only the plugin's own tagged keys are ignored; unmarked remote Esc can stop. Hiding decorative indicators keeps the listener available. Stopping also signals other armed helpers in the same Windows user session. Browser Use, reads and background control actions do not take Esc; until a turn first uses the mouse or keyboard, stop it with the stop button in DSH.

In DSH, indicators appear with the first call that uses the real mouse or keyboard and stay visible through later observations and short reasoning gaps. They release on turn completion/cancellation, or after 30 idle seconds following the last completed desktop call; the next call shows them again. Running tools do not count as idle. A host lease releases stale state; another conversation receives a busy result while the desktop is owned. Standalone stdio clients retain per-call indicators because they provide no DSH turn boundary. Regular mouse movement does not stop a series.

Conversation rows use a mouse icon and readable action descriptions, expandable screenshots and an end-of-turn summary reconstructed from session events. Sent input is distinguished from verified effects. Element operations run in the background where they can: BM_CLICK for Win32 buttons, EM_REPLACESEL for edits, WM_VSCROLL for controls with their own scroll bars, else UIA, with no pointer or foreground change; when an app brings itself forward or moves the pointer during a UIA call, the plugin gives both back. Coordinate clicks, pastes and key presses still use the shared Windows pointer and keyboard: the target comes forward for that step only, a click point covered by another window is refused, and afterwards the pointer returns to where you left it (if it is still where DSH put it) and the foreground to the window you had in front. A menu, drop-down or dialog the action opened, or a window or pointer you changed meanwhile, is left as it is. After the foreground goes back, later actions without a window target still aim at DSH's window. Pasted text stays out of clipboard history (Win+V), and the previous clipboard is restored.

Cancellation is cooperative at segmented-input and post-resolution execution boundaries, with held-input cleanup. Delivered actions cannot be undone, and a blocking application Provider call must return first. Esc does not request an application exit or restart and is not evidence of an application crash.

## 思考与操作浮窗

默认打开，可在 **设置 → 电脑操控 → 思考与操作浮窗** 随时关闭，选择会保存。开始一轮电脑操控后，按步骤显示 DSH 在做什么：每一步一个小标题，例如“第 3 步 · 连续执行 7 个操作：滚动页面”，下面是这一步模型已输出的思考和回复。动作名只来自工具名和调用结构（新开标签页、批量里有几个操作等），不显示输入的文字、网址或坐标。较早的步骤只保留末尾几行，最近 24 步可以往回滚。模型没有提供思考文本时只显示状态，不生成额外的思考内容。只显示当前占用电脑操控的会话。

任务结束后，标题改为“已完成 · N 步 · 用时”（停止时为“已停止”，出错时为“出错”），浮窗再保留 20 秒；回复比窗口长时从回复开头显示（超过 1200 字的回复显示前 1200 字，以“…”结尾），之后收起。租约过期时直接收起。

详细设置默认收起在 **更多选项** 中，展开后可调整不透明度、大小、位置和锁定快捷键。标题栏标明“即时生效”的显示开关、锁定开关与 **打开浮窗并调整** 按钮始终可见，拨动开关立即应用。

**浮窗内容** 提供两种模式，默认选择 **原文**：按步骤转发现有输出，不额外调用模型、不增加模型 token。选择 **AI 总结** 后，使用当前对话所选的模型（不开推理），把已完成的步骤和正在做的操作写成一两句易懂的话，会额外消耗输入和输出 token：开始约 1.5 秒后请求第一条，之后最多每 10 秒一次，内容不变时不重复请求；任务结束时再请求一次结果总结。新的一步不会打断正在生成的总结，上一条总结一直显示到下一条出来，标题注明是第几步时的总结。输入只有动作名和已经显示的文字，限 2400 字符；输出最多 192 token，8 秒超时。总结不会加入对话上下文，也不会执行工具；暂不可用时显示操作步骤，结束后显示回复原文。关闭浮窗、切回原文或换到下一轮会取消在途总结，已消耗的 token 不能撤回。约 40 秒的任务大约请求 4–5 次。

不透明度可设 20–100%，宽度 240–1600 像素，高度 160–1600 像素；位置可选四角或自定义 X/Y（支持负坐标）。锁定时不抢焦点、鼠标穿透，不会挡住你或 DSH 的点击。右上角的锁形图标就是锁定按钮：把光标移上去停约 0.4 秒（按钮上转一圈进度环），浮窗临时解锁，可以拖标题移动、拖边缘缩放、滚动正文；光标离开浮窗约 1.5 秒后自动锁回，点开锁图标则立即锁回。临时解锁不改锁定设置，期间的移动和缩放照常保存；锁回后光标要先离开按钮，再停上去才会再次解锁。悬停解锁只认物理鼠标（低级鼠标钩子里没有注入标记的移动），DSH 用 SendInput 发出的输入和用 SetCursorPos 移过去的光标都不会触发；远程控制软件注入的鼠标同样不会触发，这时请用锁定开关或快捷键。解锁时（设置里关闭锁定、预览或悬停解锁）右上角是开锁图标和 ×：点开锁图标锁定（设置里本来是解锁的，会把锁定写回设置），点 × 仅关闭当前预览或收起本轮浮窗，不会关掉设置里的浮窗开关（下轮任务仍照常显示）。正在悬停解锁或拖动时，任务结束、保留期满或预览到时都会等调整完再收起。锁定快捷键可自定义，例如 `Ctrl+Alt+P`，再次按下切换锁定；不能使用 Esc 或与停止键重复。留空时仍可从设置页切换锁定。

正文使用连续的只读滚动区，段落之间不空行，Markdown 记号去掉、只留文字；只显示整行，上下边缘不会切掉半行。文字带细微阴影，背后是亮色网页时也能看清。解锁后可用滚轮和右侧半透明滚动条阅读（没有更多内容时不显示滚动条），拖动标题栏移动窗口，边缘仍可缩放。向上滚动时保留阅读位置；回到底部后再跟随新增输出。锁定时鼠标穿透，右上角显示锁形按钮，不显示底部提示行，正文多出一行；需要滚动回看时把光标停在锁形按钮上解锁。仅切换锁定不会把四角定位改成自定义坐标。宽高还受 Windows 当前显示器的窗口跟踪上限约束。

点 **打开浮窗并调整** 会直接应用浮窗设置并显示 60 秒的调整预览，不必先保存，表单里其他未保存的更改保留；预览期间临时解锁，方便拖动和缩放，调好后点 × 关闭预览（不会关闭浮窗开关），或等到期后恢复原来的锁定状态（预览中按锁定快捷键或改锁定开关才会保存）；内容是两步示例，普通浮窗开关关闭时也能预览。此页与浮窗共用宿主配置：菜单修改实时应用，拖动、缩放和锁定通过 DSH 官方设置服务写回，重启后保留。过时的浮窗位置事件不会覆盖更新的菜单设置；连续两次快速拖动或缩放时，第一次写回设置后的回传也不会把浮窗拉回原处。浮窗只展示进度，不会单独启用桌面 Esc 接管；浏览器后台任务仍使用 DSH 的停止按钮。

## 连接自己的浏览器（实验性）

`browserAttachUser` 默认关闭。开启前在 `chrome://inspect/#remote-debugging` 或 `edge://inspect/#remote-debugging` 允许远程调试。只连接设置中选定的浏览器；默认选项跟随 Windows 默认浏览器，不扫描所有浏览器。Firefox 系不支持此选项。

`list_windows` 只显示可连接项和 `"<browser id>:connect"`，不握手。agent 先告知用户去浏览器点“允许”，再调用 `set_value`，`elementId` 为该连接入口，`value` 为 `"connect"`。`set_value` 与 `list_windows` 必须在用户允许的工具中。等待、拒绝、超时、取消都有状态；只有下一次显式连接才重试，重试前关闭旧提示。每次从 `DevToolsActivePort` 重读端点，应对重启后的端口或路径变化。

授权后可访问该浏览器已登录的网站和页面，连接期间浏览器显示自动测试软件控制提示。agent 只操作用户提到或 DSH 打开的标签页；发送、购买、删除或账户修改前按已有规则询问。网页文字可能诱导 agent，本机其他程序也能请求控制，浏览器同样会询问。结束插件只断开，不关闭自己的浏览器。

## Progress overlay and user-browser attachment

The progress overlay is **on by default** and can be disabled under Settings → Computer Use. It shows the work step by step: one heading per model step with plain-language action names taken from tool names and the shape of the call only (never typed text, URLs or coordinates), followed by the reasoning and reply DSH already emitted for that step; older steps keep their last lines and the last 24 steps can be scrolled back. When the turn ends the header reads done, stopped or error with the step count and time taken, and the overlay stays 20 seconds, showing a long reply from its start (the first 1,200 characters, ending in “…”, for a longer one). Summary mode asks the conversation's model (reasoning off) for a sentence or two about 1.5 s after work starts, then at most every 10 s, and once more for the result when the turn ends; a new step does not cancel a running summary. Configure opacity (20–100%), width/height, a corner or custom X/Y, locked state and a lock shortcut. Locked passes mouse input through, and the padlock in the top-right corner is the lock button: resting the user's own pointer on it for about 0.4 s (a ring fills) unlocks the overlay until the pointer has been away for about 1.5 s, so it can be dragged by the title, resized at the edges and scrolled; clicking the open padlock locks it at once. This temporary unlock never changes the saved lock setting, while moves and resizes are saved as usual. Only physical mouse movement counts (low-level hook events without the injected flag), so neither DSH's SendInput input nor a cursor it placed with SetCursorPos can unlock it; mouse input injected by remote-control software cannot either, so use the switch or the shortcut there. Unlocked, the overlay shows the open padlock (click to lock; this saves the lock when the setting was unlocked) and × to close (closing the adjustment preview or dismissing only the current turn without turning off the overlay setting), without activation. An overlay being adjusted stays until the user is done, and a quick second move or resize is not pulled back by the settings echo of the first. **Open overlay to adjust** saves and applies overlay tuning right away without saving the rest of the form (while the display and lock switches above apply immediately, marked **Saves instantly** in the header) and shows a 60-second preview that is unlocked only while it lasts; clicking × finishes the preview cleanly without turning off the overlay feature, and otherwise the saved lock state is restored afterwards unless the user toggles it during the preview. Menu edits and native move/resize/lock events use the same DSH settings service and persist together. Stale native events cannot overwrite newer menu values. Only the current computer-use session's emitted reasoning/reply text is displayed; models with no reasoning output show status only. The overlay alone never arms the desktop Esc stop key.

Connect browser (experimental) is off by default. Enable remote debugging in the selected browser's inspect page. Listing reads its port file without a handshake. Ask the user to allow the connection, then `set_value` the offered `<browser id>:connect` handle to `connect`. The selected browser alone is offered; Firefox family is unsupported. There is no automatic retry after refusal/timeout/cancellation. Close any old prompt before explicitly retrying. Connection grants access to signed-in pages; only use requested or DSH-opened tabs and keep the existing confirmation rules for consequential actions. Disconnecting never closes this browser.

# Computer Use 设置 / Settings

## 简体中文

升级插件并完整退出、重新启动 DSH Desktop，打开 **设置 → Computer Use**。新版插件页面也有入口；旧宿主保留可配置插件卡片。DSH 0.2 使用插件条目 ID `mcp-dsh-computer-use-win` 的 Config 表单；旧接口使用 `windows-computer-use`。

若曾为 #29 手动添加独立的 `windows-computer-use` 或 `wincu` 覆盖条目，请先备份 profile 配置，再移除该临时重复条目，使用插件 bundle 提供的入口。避免同时启动两个桌面操作服务。

插件列表显示功能简介和“点击进行具体设置”，点击打开完整设置页；Star 和 Issue 链接位于完整设置页顶部；点“精简显示”可将这段说明收为一个带 GitHub 标志的 dsh-computer-use-win 链接，点“完整显示”恢复。该选择立即保存，重启和升级后保持不变，也不会保存或放弃其他未保存的更改。无法读取宿主配置时会暂停编辑并明确提示，不再将内置默认值当作已经读取的设置。0.4.3 补齐混合版本验证器的实时字段与共享引用协议，使用宿主确认的值回读保存结果。

### 工具加载

外层选择 **精简 / 全部 / 懒启动 / 自定义**，默认全部 24 项（23 项桌面工具加管理入口）。精简固定加载 10 项；自定义才展开内部缩进清单，支持逐项、分组、全选和全部关闭。切换方案会保留自定义勾选，保存后在当前动作结束时生效，重启保留选择。agent 不能重新启用用户关闭的工具。

懒启动仅注册管理入口，允许全部工具按需加载；启动显示“1 项，允许全部 24 项”。切换回自定义会恢复原清单。使用桌面工具前需要加载，`reset` 恢复为管理入口。

### 接管提示

屏幕边缘与提示条、鼠标光环／DSH 标识独立开关。可设置提示文字、顶部／底部、结束后的隐藏延时（200–3000 毫秒），保存后可预览。提示层不抢焦点、鼠标可穿透，不修改系统光标主题。

“远程与录屏可见”默认开启，让 UU、屏幕共享及录屏可以捕获提示。关闭后请求 Windows 在支持的捕获路径中排除提示。组件通过原生活动显示器枚举、显示／会话事件及接管期间 500 毫秒复核刷新，处理虚拟屏幕新增、移除、重连和布局／DPI 变化。

DSH 从首次 Computer Use 工具实际执行开始持续显示提示，包括截图、读取和短暂思考。轮次完成、取消或异常退出后按延时收起；最后一次桌面调用完成后空闲 30 秒，也会收起提示并释放占用，下一次调用重新显示。仍在执行的动作不会被当作空闲。普通文件读写或 shell 命令不单独触发提示。其他对话正在接管桌面时返回忙碌状态，避免两个任务交错操作鼠标。宿主活动租约过期后会释放提示。独立 stdio 客户端没有 DSH 的轮次边界，保持单次调用显示。

### 对话中的操作记录

工具调用使用鼠标图标和简洁操作描述，点击展开相关截图与检查入口。轮次结束后汇总步骤；重开对话时从已有会话事件恢复。输入已发送与效果已验证分开表达，未完成和已停止会明确显示。浏览器搜索摘要以实际输入、提交和后续观察为依据。

支持的控件操作优先使用 UIA；文字粘贴不再额外移动鼠标。坐标点击仍使用当前 Windows 桌面的真实鼠标，不在事后恢复可能过时的位置。

### 停止与恢复

按物理 **Esc** 停止。也可在“自定义停止方式”点击“录制快捷键”，按 F8 或 Ctrl + Alt + K 等按键／组合键并保存；“恢复默认（Esc）”清除额外快捷键。录制时 Esc 用于取消；失焦或 15 秒未录入会退出录制。

Esc 只停止当前这一轮及其排队操作，同一轮不会自动重试。下次发起任务或发送“继续”时自动可用，无需进入设置恢复。普通鼠标移动与其他按键不会停止；程序发送的按键不视为物理停止输入。关闭提示仍保留停止监听。

取消会在可分段输入与 UIA 解析后的执行边界检查，并在收尾时释放按住的输入。已送达应用的操作无法撤回，阻塞的应用 Provider 调用需要先返回。按 Esc 不会请求重启或退出 DSH，也不能据此判断应用崩溃。

## English

Upgrade and fully restart DSH Desktop, then open **Settings → Computer Use**. A plugin-page entry and the legacy configurable card are also available. Modern DSH uses the `mcp-dsh-computer-use-win` Config namespace; the older API uses `windows-computer-use`. Back up and remove any temporary duplicate adapter/MCP override added for #29 before using the bundled entry.

The plugin list shows a short introduction that opens the complete settings page. Star and Issue links stay at the top of that page; Compact collapses that note to one dsh-computer-use-win link with the GitHub mark and Show full note restores it. The choice saves at once, persists across restarts and upgrades, and neither saves nor discards other pending changes. An unavailable host form shows an explicit state and cannot be edited. Version 0.4.3 supplies live-field metadata and the shared reference protocol for mixed-version validators, and confirms saved values against the host response.

Choose **Lite / All / Lazy / Custom** in the outer selector. All is the default (24 entries); Lite loads 10. Custom reveals the indented checklist with individual/group selection, select-all and disable-all. Preset changes preserve your custom selection. Save applies after the current action finishes and survives restart. Management cannot re-enable user-disabled tools.

Lazy starts with one management entry while allowing all tools to be loaded on demand. Switching back to Custom restores its saved list; reset returns Lazy to management only.

Screen edges/banner and the pointer halo/DSH badge have independent controls. Customize text, top/bottom placement and the 200–3000ms hide delay, save and preview. The layers let clicks pass through, keep focus and leave Windows cursor themes intact. **Visible in remote sessions and recordings** is on by default, including virtual displays. Turning it off requests capture exclusion on supported Windows capture paths. Active monitor enumeration, display/session events and a 500ms topology check refresh the layers after display, layout or DPI changes. The indicators cover this plugin's complete desktop operation series, or a requested preview.

Physical **Esc**, or a recorded key/combination, stops the current operation series and queued input. It cannot retry in the same turn. A new user task or request to continue can use the desktop automatically, without visiting settings. Record a shortcut and save; Restore default (Esc) clears the additional key. Esc cancels recording, and blur or 15 seconds of inactivity exits it. Ordinary mouse movement, other keys and injected keys do not trigger a physical stop. Hiding the indicator keeps the listener active.

In DSH, indicators stay visible from the first desktop call through observations and short reasoning gaps. They release on turn completion/cancellation, or after 30 idle seconds following the last completed desktop call; the next call shows them again. Running tools do not count as idle. A host lease releases stale state; another conversation receives a busy result while the desktop is owned. Standalone stdio clients retain per-call indicators because they provide no DSH turn boundary. Regular mouse movement does not stop a series.

Conversation rows use a mouse icon and readable action descriptions, expandable screenshots and an end-of-turn summary reconstructed from session events. Sent input is distinguished from verified effects. Supported element operations prefer UIA; pasting text no longer repositions the pointer. Coordinate actions still use the shared Windows pointer.

Cancellation is cooperative at segmented-input and post-resolution execution boundaries, with held-input cleanup. Delivered actions cannot be undone, and a blocking application Provider call must return first. Esc does not request an application exit or restart and is not evidence of an application crash.

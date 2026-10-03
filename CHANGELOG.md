# Changelog

## 0.2.4 — 2026-10-03

- 修复 DSH Desktop/Electron 中 MCP 启动时的 `Connection closed`：bundle 为 MCP 子进程显式设置 `ELECTRON_RUN_AS_NODE=1`，同时兼容普通 Node 宿主。
- 新增实际 bundle 的 Node/Electron 启动回归，使用官方 MCP SDK 验证 initialize、22 个工具、health、wait 和 6 项资源，并接入 PowerShell 5.1/7 CI。Electron、MCP SDK 和 YAML 解析器仅用于测试，运行时继续保持零依赖。
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

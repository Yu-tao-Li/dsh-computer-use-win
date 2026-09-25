# Changelog

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

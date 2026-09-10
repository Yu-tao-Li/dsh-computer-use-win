# Changelog

## 0.2.0 — 2026-09-10

- 修复 DSH profile 安装后的 `mcp/server.mjs` 路径解析：通过 profile 的 `package.json` 解析已安装的 npm 包，兼容 pnpm 布局。
- Fixed DSH profile startup path resolution by resolving the installed npm package through the host profile's `package.json`, including pnpm layouts.
- 新增 profile 路径回归测试并接入 `npm test` 和 GitHub Actions CI。
- Added a profile-resolution regression test and wired it into `npm test` and GitHub Actions CI.
- README 增加 npm 安装方式，并同步更新中英文路径说明。
- Documented the npm installation route and refreshed the bilingual path-resolution guidance.
- 感谢 [@CnsMaple](https://github.com/CnsMaple) 在 [#1](https://github.com/Yu-tao-Li/dsh-computer-use-win/pull/1) 中定位并修复该问题。

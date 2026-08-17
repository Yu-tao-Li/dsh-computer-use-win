# 发布流程：GitHub + 插件商城（dshmarket）

调研自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
（插件商城 [dshmarket](https://github.com/dsh-market/dsh-market) 的数据源）及其
`contributing.md`，对照已上架插件（如 STARDUSTLC666/dsh-email、
01Virex/dsh-status-rotator）的仓库结构仿建。

## 别人是怎么做的（调研结论）

1. **仓库要求**（CI 自动检查）：
   - `package.json` 声明 `dsh.bundle` manifest（只有 `dsh.client` 不可安装，会被拒）；
   - 仓库**创建满 1 天**且**提交数 ≥ 10**；
   - 仓库带 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic；
   - 真实可用代码，非占位仓库。
2. **上架 = 一个 PR**：往 `awesome-dsh-plugin` 仓库的
   `data/plugins/<owner>__<repo>.yml` 加一个文件（一插件一文件，永不冲突），
   再跑 `node scripts/generate-readme.mjs` 重新生成 README，一起提交。
3. **合并后网站/商城自动重建**，插件出现在 dshmarket 里，
   安装命令形如 `dsh plugin --profile web add github:<owner>/<repo>`。
4. **推荐**：发布 npm 包（预构建安装免 `allowBuilds` 构建授权）；
   或把预构建 tarball 挂 GitHub Release + 条目里加 `tarball:` 字段。
5. **可选**：`data/screenshots.json` 配 1-8 张 GitHub 托管的截图
   （商城详情页 AppStore 风格展示）。

## 我们的流程

### 第 0 步（已完成）：仓库文件齐备
本仓库已按社区惯例备齐：

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle` manifest + `files` + `os: win32` + metadata |
| `cordis.patch.yml` | bundle 补丁（`!!js` 相对路径解析 server.mjs，任何 profile 可装） |
| `mcp/server.mjs` / `scripts/windows-uia.ps1` | 本体（22 工具 + PowerShell UIA 引擎） |
| `test/` | 测试套件（CI 里跑 self-test + 协议测试） |
| `LICENSE` | MIT |
| `.github/workflows/ci.yml` | windows-latest 上跑 self-test + 协议测试 |
| `assets/screenshot-{1,2}.png` | 商城截图（raw.githubusercontent 可直链） |
| `publish/awesome-list-entry.yml` | 收录条目（PR 里直接用） |
| `publish/screenshots.json` | 截图清单片段（PR 里合并进列表仓库） |

### 第 1 步：推 GitHub（✅ 已完成 2026-08-16）

- 仓库：<https://github.com/Yu-tao-Li/dsh-computer-use-win>（public，11 个提交）
- topic `dsh-plugin` 已添加
- CI（windows-latest：self-test + MCP 协议测试）已绿
- 创建/推送命令（留档）：

```powershell
gh repo create dsh-computer-use-win --public --source . --push
gh repo edit Yu-tao-Li/dsh-computer-use-win --add-topic dsh-plugin
```

### 第 2 步：给仓库加 topic

```powershell
gh repo edit Yu-tao-Li/dsh-computer-use-win --add-topic dsh-plugin
```

### 第 3 步：等够"仓库年龄"

CI 要求仓库**创建满 1 天**。今天推、明天（或更晚）再提收录 PR，避免白跑 CI。

### 第 4 步：提收录 PR（满 1 天后）

```bash
git clone https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
cd awesome-dsh-plugin
# 1) 收录条目（内容见本仓库 publish/awesome-list-entry.yml）
mkdir -p data/plugins
cp <本仓库>/publish/awesome-list-entry.yml data/plugins/Yu-tao-Li__dsh-computer-use-win.yml
# 2)（可选）截图：把 publish/screenshots.json 的内容合并进 data/screenshots.json
# 3) 重新生成 README（必须，CI 会校验）
npm ci
node scripts/generate-readme.mjs
# 4) 提交 + 推送 + 开 PR
git add data/plugins/Yu-tao-Li__dsh-computer-use-win.yml data/screenshots.json README.md README.zh.md
git commit -m "Add Yu-tao-Li/dsh-computer-use-win"
git push origin HEAD
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add Yu-tao-Li/dsh-computer-use-win" \
  --body "Windows computer use for DSH: MCP stdio server + PowerShell UIA backend, 22 desktop tools."
```

### 第 5 步：CI 会检查什么（失败就在同一分支推修复）

1. `dsh.bundle` —— 从我们仓库的 `package.json` 拉取校验 ✅（已声明）；
2. 仓库年龄 / 提交数 —— 1 天 / 10 次 ✅（第 3 步等够即可）；
3. `awesome-lint` + 站点构建 —— 双语一致、分隔符、日期、截图 URL 合法性。

### 第 6 步（合并后，自动）

网站与 dshmarket 自动重建，插件即上架。用户侧：

```powershell
dsh plugin --profile web add github:Yu-tao-Li/dsh-computer-use-win
# 或在 DSH 设置里的插件市场（dshmarket）搜索 "dsh-computer-use-win" 一键安装
```

### 可选加分项

- **npm 发布**：`npm publish`（包名 `dsh-computer-use-win` 目前未占用，需先
  `npm whoami` 确认账号；发布后条目 `npm:` 字段自动生效，安装免构建授权）。
- **GitHub Release tarball**：不发布 npm 也可 `npm pack` 出 tgz 挂到 Release，
  条目里加 `tarball: https://github.com/Yu-tao-Li/dsh-computer-use-win/releases/latest/download/dsh-computer-use-win-<ver>.tgz`。
- **徽章**：上架后 README 加
  `[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)`。

## 安全提醒

- 上架 ≠ 安全审查（列表官方免责声明）。插件在用户机器上以用户权限运行，
  README 里已写明风险边界与 failsafe。
- GitHub token 只存在 `E:\PythonFiles\.secrets\` 与 git 凭据管理器，
  **不在仓库内**（`.gitignore` 已排除 `.secrets/`）。

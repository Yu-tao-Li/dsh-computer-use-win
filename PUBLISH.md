# 发布流程：GitHub + 插件商城（dshmarket）

## 发版前检查清单

推送 `vX.Y.Z` 标签会启动发布工作流。工作流对标签对应的提交运行完整 CI，通过后才发布到 npm。推送前先完成下面的检查，任何外部发布都由维护者确认后执行。

验证入口：`node scripts/check-build.mjs --pack`；`node test/run-tests.mjs`；`node test/browser-bidi.mjs --live`；向宿主 `node_modules` 目录运行 `test/host-policy.mjs`、`test/host-settings-integration.mjs`、`test/host-settings-legacy.mjs`；`WCU_SETTINGS_TEST_API=legacy` 运行 `test/client-settings-contract.mjs`。

运行 `node test/measure-tool-context.mjs --write` 更新工具大小，核对 package / lock / 设置页版本一致；`npm pack --dry-run --json --ignore-scripts` 确认仅包含显式白名单内的运行时文件、策略与剪贴板模块，无测试产物、调试文档、凭据或本地路径泄露。

用实际打包的 TGZ 在隔离 DSH 配置中从 npm 稳定版升级并重启，检查工具注册、已保存的设置和项目说明的折叠态。复核反馈 TXT 的文件名、保存路径、另存为和 GitHub 反馈入口。



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
5. **可选**：在插件仓库根目录放 `screenshots.json`，列出 1-8 张仓库里的截图（列表仓库的 `data/screenshots.json` 只留给旧条目，不再接受新键）
   （商城详情页 AppStore 风格展示）。

## 我们的流程

### 第 0 步（已完成）：仓库文件齐备
本仓库已按社区惯例备齐：

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle` manifest + `files` + `os: win32` + metadata |
| `cordis.patch.yml` | bundle 补丁（`!!js` 相对路径解析 server.mjs，任何 profile 可装） |
| `mcp/server.mjs` / `scripts/windows-uia.ps1` | 本体（23 工具 + PowerShell UIA 引擎） |
| `test/` | 测试套件（CI 里跑 self-test + 协议测试） |
| `LICENSE` | MIT |
| `.github/workflows/ci.yml` | windows-latest 上跑 self-test + 协议测试 |
| `assets/market/` | 商城配图：market-1…6.png（1500×1000）、icon-180.png 卡片图标，源码和来源说明在同一目录（raw.githubusercontent 可直链） |
| `publish/awesome-list-entry.yml` | 收录条目（PR 里直接用） |
| `screenshots.json` | 商城截图清单（仓库根目录，路径相对于它本身；插件市场从这里读取） |

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
# 2) 截图不用改列表仓库：本仓库根目录的 screenshots.json 会被直接读取
# 3)（可选）本地预览生成的 README；不提交也行，合并后会在 main 上自动重新生成
npm ci
node scripts/generate-readme.mjs
# 4) 提交 + 推送 + 开 PR
git add data/plugins/Yu-tao-Li__dsh-computer-use-win.yml
git commit -m "Add Yu-tao-Li/dsh-computer-use-win"
git push origin HEAD
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add Yu-tao-Li/dsh-computer-use-win" \
  --body "Windows computer use for DSH: MCP stdio server + PowerShell UIA backend, 23 desktop tools."
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

- **npm 发布**：已启用，由 Release 工作流自动发布，见下文“npm 发布”；
  条目中的 `npm:` 字段会自动使用最新版本，安装免构建授权。
- **GitHub Release tarball**：不发布 npm 也可 `npm pack` 出 tgz 挂到 Release，
  条目里加 `tarball: https://github.com/Yu-tao-Li/dsh-computer-use-win/releases/latest/download/dsh-computer-use-win-<ver>.tgz`。
- **徽章**：上架后 README 加
  `[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)`。

## npm 发布（受信任发布，不用 token）

推送 `vX.Y.Z` 标签后，`.github/workflows/release.yml` 先对标签所在的提交跑完整 CI（`verify` 任务调用 `ci.yml`），再依次核对标签与 `package.json` 版本、检查构建和包内文件，都通过才执行 `npm publish`。npm 通过受信任发布（OIDC）确认上传来自本仓库的这个工作流，仓库和本机都不保存 npm token，也就没有 token 过期的问题。npm 会自动附上来源证明（provenance），包页面能看到构建它的提交和运行记录。

### 一次性设置（npmjs.com）

打开 npmjs.com 上 `dsh-computer-use-win` 的 Settings → Trusted Publisher，选 GitHub Actions：

| 字段 | 填写 |
|---|---|
| Organization or user | `Yu-tao-Li` |
| Repository | `dsh-computer-use-win` |
| Workflow filename | `release.yml`（只填文件名） |
| Environment name | 留空 |
| Allowed actions | 勾选 `npm publish`。2026-09-03 之后新建的配置默认只允许 `npm stage publish`，不勾的话工作流无法直接发布 |

- 新配置必须在 2 天内完成第一次发布，否则失效且不能再编辑，只能删掉重建。所以在发版当天配置。
- 受信任发布需要 npm 11.5.1 或更高，工作流会先检查。`package.json` 的 `repository.url` 必须与本仓库完全一致。
- 第一次发布成功后，在包的 Settings → Publishing access 选 “Require two-factor authentication and disallow tokens”，点 Update Package Settings 保存。受信任发布照常可用，token 不能再用来发布。旧 token 可在账号的 Access Tokens 页面撤销。

### 每次发版

1. 改 `package.json` 版本和 `CHANGELOG.md`，经 PR 合入 `main`，等 CI 通过。
2. 给 `main` 打标签并推送（以 0.6.3 为例）。推送标签就会发布：

   ```powershell
   git fetch origin main
   git tag v0.6.3 origin/main
   git push origin v0.6.3
   ```

3. 在 Actions 的 Release 运行里确认成功。运行先跑完整 CI，大约 15–35 分钟，之后才上传。npm 会先扫描新版本，通常几分钟，有时十几分钟，之后 `npm view dsh-computer-use-win version` 才显示新版本。
4. 创建 GitHub Release，附件用 npm 上的同一个包：`npm pack dsh-computer-use-win@0.6.3` 会下载 `dsh-computer-use-win-0.6.3.tgz`。

发布失败时（例如 npmjs.com 还没配好），修好后在 Actions 里重跑失败的任务，不要在本机再发布同一版本。只有 `v1.2.3` 这种正式版本标签会触发发布，`v1.2.3-rc.1` 之类的预发布标签不会。

## 安全提醒

- 上架 ≠ 安全审查（列表官方免责声明）。插件在用户机器上以用户权限运行，
  README 里已写明风险边界与 failsafe。
- GitHub token 只存在维护者本机的私密目录与 git 凭据管理器，
  **不在仓库内**（`.gitignore` 已排除 `.secrets/`）。
- npm 发布不用 token，只走 Release 工作流的受信任发布；仓库和 Actions secrets 里都不要放 npm token。

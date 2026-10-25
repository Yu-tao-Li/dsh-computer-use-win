# 插件市场配图

插件市场（dshmarket）详情页和卡片用的图，由 `publish/screenshots.json` 列出，`publish/awesome-list-entry.yml` 的 `icon` 指向卡片图标。

## 1 文件

| 文件 | 内容 |
|---|---|
| `market-1.png` … `market-6.png` | 6 张 1500×1000（3:2）的市场图：是什么、使用示意、网页实拍、桌面实拍、操作记录、设置页 |
| `icon-180.png` | 180×180 卡片图标：DSH 在标签页上用的蓝色箭头 |
| `market.html`、`icon.html` | 图的源码，每张 750×500 CSS 像素 |
| `render.mjs` | 用本机 Chrome 或 Edge 按 2 倍渲染：`node assets/market/render.mjs` |
| `src-*.png` | 图里用到的截图 |

## 2 截图从哪来

- `src-browser.png`：真实的 DSH 浏览器窗口（Edge，蓝框、标签页角标、页面小箭头），在测试屏上用浏览器通道填写一张示例报销单后，用 PrintWindow 截窗口。页面是自写的示例页，通过 CDP Fetch 以 `oa.example.com` 提供，人名是虚构的。
- `src-desktop.png`：真实的 Windows 计算器，用 UI Automation 算出 1999 × 12；接管提示（提示条、屏幕边缘、鼠标旁的 DSH 标签）由接管助手在测试模式下只画在测试屏上；背景是一个纯色窗口，挡住测试屏上的其他窗口。屏幕截图不含系统鼠标指针，`market.html` 在原来的位置补画了一个标准箭头。
- `src-settings.png`：真实设置页代码（`mcp/client.js`）在测试用 Electron 外壳里的渲染结果，和 DSH 里显示的是同一份代码。
- `src-steps.png`、`src-result.png`：2026-10-24 在真实 DSH Desktop 里让 agent 搜索“晴天”时的操作记录和结果（0.5.1）。

## 3 更新时

改 `market.html` 或换 `src-*.png` 后重新运行 `render.mjs`。市场按 220×150 裁成 3:2 显示，卡片里只有 132×88，所以每张图的字要大、要点要少。

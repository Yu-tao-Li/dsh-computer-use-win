# 第三方来源与衍生说明（THIRD_PARTY / Provenance）

本项目是 [cgissing/windows-computer-use](https://github.com/cgissing/windows-computer-use)
（MIT License，Copyright (c) 2026 cgissing）的**衍生作品（derivative work）**，
在其基础上做了 DSH 适配与大幅扩展。

## 来自上游的部分（保留其 MIT 版权）

| 部分 | 说明 |
|---|---|
| `mcp/server.mjs` 的骨架与工具 schema 基础 | MCP stdio 服务器结构、窗口目标参数约定 |
| `scripts/windows-uia.ps1` 的引擎核心 | UIA 树遍历、PrintWindow 截图 + 黑帧检测、SendInput 鼠标路径、窗口管理动作 |
| `docs/wiki/`（全部 6 个文件） | 上游的架构/安全/工具文档，原样收录 |
| 部分设计决策 | DPI 感知顺序、SendInput ABSOLUTE 多显示器问题的规避思路 |

上游版权与许可：

> Copyright (c) 2026 cgissing
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in the
> Software without restriction, subject to the conditions of the MIT License.

## 本项目新增的部分（Copyright (c) 2026 Yu-tao-Li）

- **DSH 集成**：`dsh.bundle` 打包（`cordis.patch.yml` 的 `!!js` 路径解析）、
  in-box `dsh-mcp-client` 桥接、`github:` 安装路径
- **持久化后端管理**：MCP server 侧的 JSON 行协议、懒重建、超时 kill
- **WGC 窗口捕获**：Windows.Graphics.Capture 回退（C# WinRT 助手 + 编译缓存 + 优雅降级）
- **OCR 回退**：Windows.Media.Ocr（C# 助手）+ 词框屏幕坐标换算 + query→控件回查
- **安全机制**：坐标 homing、failsafe 急停、identity guard、前台校验
- **输入增强**：`type_text` 三条路径（clipboard / sendinput-unicode / background WM_CHAR）
- **测试套件**：self-test / MCP 协议 / Notepad E2E / 功能综合 / 延迟基准
- CI（windows-latest）、发布材料（assets/、publish/、PUBLISH.md）

## 借鉴（仅思想/技术路线，未复制代码）

- 坐标 homing 与 failsafe 急停：参考 desktop-touch-mcp 的思路
- OCR 盲区回退策略：参考 PeekabooWin / iris-mcp 的思路
- MCP 协议本身为开放协议（非本项目或上游的版权内容）

按 MIT 许可，以上衍生与再分发均被允许；本项目保留双方版权声明
（见 LICENSE）。

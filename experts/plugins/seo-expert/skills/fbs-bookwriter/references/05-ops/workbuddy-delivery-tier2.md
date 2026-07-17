# WorkBuddy 交付链与 Tier2 插件（FBS）

> **目的**：把「MD/HTML 为默认、多格式走宿主」落到**可执行顺序**，避免用户找不到 Word/PDF/幻灯片导出路径。  
> **真值**：以 `host-capability-detect.mjs` 输出的 `.fbs/host-capability.json` 中 `plugins.enabled` 为准。

## 1. 能力分层（简述）

| 层级 | 典型能力 | 用户侧说法 |
|------|-----------|------------|
| Tier2 插件 | `docx`、`pdf`、`pptx`、`xlsx`、`playwright-cli` | 「用宿主里的文档/导出能力」 |
| Tier1 市场技能 | `minimax-docx`、`minimax-pdf`、`pptx-generator` 等 | 「增强型排版/印刷」 |
| 仓库脚本 | `assets/build.mjs`、合并稿 | 「本地构建 HTML / 合并全书稿」 |

## 2. 推荐顺序（S4/S5）

1. **定稿内容**以书稿目录下 Markdown 真值为准（`deliverables/` 约定见 `channel-manifest`）。
2. **HTML 预览**：`assets/build.mjs` 或宿主预览；若 `presentationBridgeSupported`，可走 `host-consume-presentation` 展示链路。
3. **Word/PDF/PPTX/XLSX**：优先走 **已启用的 Tier2 插件**；Tier1 作为增强（见 `provider-registry.yml`）。
4. 向用户说明时**不复述**插件内部代号；只说「导出为 Word」「生成 PDF」等。

## 3. 与 `intake-router` 的衔接

`firstResponseContext.deliveryAndPreview` 会给出**对人话**的交付与文件夹提示；Agent 应优先遵循该块，再查本文件细节。

# Work 论文阅读

Work 模式内置论文阅读工作流：把 arXiv 论文、papers.cool 链接或本地 PDF 导入为独立的「论文单元」，然后用 Kun Agent 生成深度解读。所有数据都是工作区里的普通文件，可以直接用 Obsidian / VS Code 打开编辑。

## 导入论文

入口有三个：

- Work 起始页的「读论文」卡片（学士帽图标）。
- 侧栏「论文」分区的 + 按钮。
- 文件树里任意 PDF 的悬浮操作「作为论文打开」（复制导入，不移动原文件）。

导入对话框接受三类输入：

- arXiv 编号或链接，例如 `1706.03762`、`arxiv.org/abs/1706.03762v7`。
- papers.cool 链接，例如 `https://papers.cool/arxiv/1706.03762` 或 venue 目录链接。
- 本地 PDF 文件（通过「选择本地 PDF」按钮）。

导入后论文会落盘为工作区下的论文单元：

```text
papers/<id>/
├── paper.json          # 单元标记与元数据
├── <id>.pdf            # 原始 PDF
├── paper.md            # 提取出的正文（带页码标记）
├── figures/
│   ├── index.json      # 图表清单
│   └── fig-*.png
├── NOTES.md            # 笔记与 papers.cool Kimi 笔记
└── <paper>-解读.md      # Agent 生成的解读（不覆盖 NOTES.md）
```

打开单元时自动进入左右分栏：左侧 PDF，右侧 NOTES.md。

## 工具条操作

当前文件属于论文单元时，编辑器工具条下方会出现论文条，显示标题、作者、年份、会议和 arXiv / papers.cool 外链。操作有四个：

- **Cool 笔记**：从 papers.cool 拉取 Kimi 笔记并追加到 NOTES.md（不消耗模型额度）。右键按钮可强制刷新缓存。
- **一键解读**：运行论文解读流程（见下）。
- **抽取图表**：生成 `paper.md` 与 `figures/index.json`（右键强制重做）。
- **打开解读**：存在解读文件时打开最近一份。

运行中的任务显示耗时并可取消。

## 一键解读

点击「一键解读」后：

1. 保存当前文档。
2. 缺少 `paper.md` 且开启自动预处理时，先自动抽取正文与图表。
3. 打开助手并提交解读提示词。Agent 依据 `paper.md`、`figures/index.json` 和 `paper.json` 工作，把解读写入 `<slug>-解读.md`（重名自动加 `-2` 后缀）。
4. 回合结束后自动记录并打开解读文件。

解读中的图引用 `figures/` 里的真实文件；难懂概念会用 Excalidraw 白板配图，PNG 导出到 `assets/` 并嵌入解读。

## 设置

设置 → Work → 「论文阅读」分区可以配置：

- **论文目录**：单元存放的工作区相对目录（默认 `papers`）。
- **解读语言**：中文 / 英文 / 跟随论文。
- **导入后自动预处理**：导入后自动提取 `paper.md` 与图表。
- **papers.cool 笔记**：是否允许拉取 Kimi 笔记。
- **解读模板**：追加到解读提示词中的阅读偏好；留空使用内置默认。

## 备注

- 无数据库：文件树即论文库，`paper.json` 是单元标记。
- `NOTES.md` 是用户/agent 的工作笔记，解读永远不会覆盖它。
- papers.cool 抓取是显式触发的串行请求，180 秒超时，结果缓存到 `.cache/coolpapers-kimi.md`。

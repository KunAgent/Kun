---
name: aippt
description: "AI 驱动的演示文稿生成能力 — 支持主题生成、文档转 PPT、单页生成与合并。 当用户需要生成 PPT、演示文稿、文档转 PPT、单页幻灯片时使用。
"
homepage: https://www.kdocs.cn/latest
version: 1.0.0
metadata: {"requires":{"bins":["kdocs-cli"],"cliHelp":"kdocs-cli --help"},"openclaw":{"category":"kdocs","emoji":"🎨","keywords":["PPT","演示文稿","幻灯片","生成PPT","做PPT","文档转PPT","AI PPT","单页生成","主题生成","培训课件","方案展示","项目展示"]}}
---

# AI PPT

AI PPT Skill 提供 AI 驱动的演示文稿生成能力，通过 kdocs-cli 命令行工具调用。 支持主题生成、文档转 PPT、单页幻灯片生成与合并。


---

---

## 能力范围

### 通用工具总览

#### 演示文稿与页面
| 工具 | 用途 |
|------|------|
| [`wpp.insert_slide`](references/wpp/slide.md) | 在已有演示中插入空白页 |
| [`wpp.import_slides`](references/wpp/slide.md) | 将外部 PPTX 的指定页面导入到已有演示文稿 |

#### PPT 生成
| 工具 | 用途 |
|------|------|
| [`aippt.execute`](references/aippt.md) | AI PPT 通用执行接口，按 task_type 路由生成 |

### 详细参考

| 文档类型 | 参考文件 | 说明 |
|----------|----------|------|
| AI PPT（aippt） | `references/aippt.md` | AI 驱动的演示文稿生成（主题生成 / 文档转 PPT / 单页生成） |
| 演示文稿（wpp） | `references/wpp.md` | 幻灯片导入与页面级操作 |

---

## 操作指南

### 执行指南

| 操作类型 | 指南文件 | 何时阅读 |
|----------|----------|----------|
| 获取文件标识指南 | `references/file-locating-guide.md` | 需要搜索或浏览文件时 |
| 环境配置与快速开始 | `references/aippt-quickstart.md` | 首次使用 AI PPT Skill / 遇到认证或版本问题时 |

### 高频流程指引

### 更多操作流程

| 流程 | 说明 | 详细参考 |
|------|------|---------|
| AI 生成演示文稿（全文） | aippt.execute 单接口全文生成链路：支持 html（两次调用 + follow_up）和 basic（一次调用，经典简约模式）两种模式，覆盖主题/文档场景 | `references/workflows/aippt-full-text.md` |
| AI 单页生成幻灯片 | aippt.execute 单接口单页生成幻灯片：HTML 布局模式，一次调用完成，可通过 wpp.import_slides 插入到已有演示文稿 | `references/workflows/aippt-single-page.md` |

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 用户希望通过主题描述或已有文档生成演示文稿。 | 用户希望 AI 生成完整 PPT（主题/文档转 PPT） → `aippt.execute`（多轮 SSE 交互，详见 `references/aippt.md`） |
| 用户需要快速生成一页幻灯片，插入到已有 PPT 中。 | 快速生成单页幻灯片并插入已有 PPT → `aippt.execute`(single_page) → `wpp.import_slides` |

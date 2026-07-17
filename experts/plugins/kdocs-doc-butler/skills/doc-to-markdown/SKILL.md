---
name: doc-to-markdown
description: "将金山文档在线文档（智能文档 .otl、Word .docx、PDF .pdf）内容提取为 Markdown 格式输出。 当用户要求「读取文档内容」、「提取文档文本」、「导出 Markdown」、「文档转文本」时使用。 若需要写入或创建文档，请使用 create-doc 技能。
"
homepage: 
version: 1.5.7
---

# 在线文档转 Markdown

在线文档转 Markdown 技能支持将云文档内容以 Markdown 格式提取。

> 本技能依赖 `kdocs` 技能的基础文档操作能力（认证、文件管理等），请确保已安装该技能。详见 `references/core/` 目录。

---


---

## 操作指南

### 通用操作路由

| 意图 | 路由 |
|------|------|
| 读取文档内容 | `read_file`（统一入口，按后缀自动返回 Markdown 或结构化数据） |
| 创建/写入 | `create_file_with_content`（统一入口，新建文档并写入内容，返回 link_url） |
| 局部更新 | 改块/改段/改单元格，已有目标文档上的修改 → 按「支持的文档类型」→ 对应 reference |
| 类型专属能力 | 条件格式、导出转换、翻译、PDF 拆分、幻灯片主题、数据校验 | 按「支持的文档类型」→ 对应 reference 中的专属功能章节 |
| 获取文件标识指南 | **必读** `references/file-locating-guide.md` |

### 高频流程指引

#### 文档内容转 Markdown

> 🎯 **核心工具**：`read_file(format="markdown")` 可将 .otl / .docx / .pdf 内容提取为 Markdown 文本。

**适用类型**：智能文档（.otl）、Word（.docx）、PDF（.pdf）
**不适用**：表格（.xlsx / .ksheet）、多维表格（.dbt）、演示文稿（.pptx）

```
步骤 1: 定位文档
        - 用户给文件名/关键词 → search_files(keyword="文档名") 获取 file_id
        - 用户给链接 → 直接提取 url 或 link_id

步骤 2: read_file(file_id=..., format="markdown") 或 read_file(url=...) / read_file(link_id=...)
        → status=ok 时取 data.content
        → status=pending 时原参数 + task_id 再次调用

步骤 3: 将 Markdown 文本直接返回给用户
```

> ⚠️ **"导出为 MD 文件"**：云端不支持创建 `.md` 后缀文件，应将 Markdown 文本直接输出给用户，由用户自行保存为本地 `.md` 文件。

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`cancel_share`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 将在线文档（智能文档、Word、PDF）内容转换为 Markdown 输出 | `search_files` → `read_file(format=markdown)` → 返回 Markdown 文本 |

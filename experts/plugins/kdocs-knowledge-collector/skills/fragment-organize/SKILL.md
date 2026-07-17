---
name: fragment-organize
description: "从多份云文档中提取碎片内容，整合生成结构化的汇总文档。可浏览目录定位源文件和目标文件。 当用户要求「整理碎片笔记」、「合并文档」、「整合分散内容」、「汇总资料」时使用。 若需要在知识库中整理，请使用 knowledge-format 技能。
"
homepage: 
version: 1.5.7
---

# 碎片内容整理

碎片内容整理技能帮助你从多份文档中提取零散信息，自动整合生成结构化汇总。

> 本技能依赖 `kdocs` 技能的基础文档操作能力（认证、文件管理等），请确保已安装该技能。详见 `references/core/` 目录。

---

## 能力范围


### 详细参考

| 文档类型 | 参考文件 | 说明 |
|----------|----------|------|
| 智能文档（otl） | `references/otl_references.md` | 页面、文本、标题、待办等元素操作 |

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

#### 创建/写入

| 用户意图 | 工具 | 适用后缀 |
|----------|------|----------|
| 对话中已有要写的内容 | `create_file_with_content` | .otl .docx .pdf .xlsx .ksheet .dbt |
| 上传本地已有文件 | `upload_file` | .doc .docx .xls .xlsx .ppt .pptx .pdf .md .txt |
| 新建空白文档（不写内容） | `create_file` | .doc .docx .otl .dbt .xlsx .xls .ksheet .pptx .ppt |
| AI 生成 PPT | `aippt.execute` | .pptx |

后缀不确定时默认 `.otl`。指定文件夹时先按 `references/file-locating-guide.md` 取 `drive_id`、`parent_id`。

选定工具后，阅读 `references/drive/create_and_upload.md` 对应章节获取参数约束（`aippt.execute` 见 `references/aippt.md`）。

#### 搜索-读取-汇报撰写

`search_files` → `read_file`（多次）→ AI 分析 → `create_file_with_content` → 返回 link_url


> 场景：搜索多份文档、提取信息、汇总撰写新报告

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`otl.block_delete`、`cancel_share`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 创建/写入 | `create_file_with_content` |
| 搜索多份文档、提取信息、汇总撰写新报告 | `search_files` → `read_file`（多次）→ AI 分析 → `create_file_with_content` → 返回 link_url |

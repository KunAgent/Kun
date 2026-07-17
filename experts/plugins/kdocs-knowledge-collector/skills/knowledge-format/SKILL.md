---
name: knowledge-format
description: "对知识库中的零散内容进行智能化整理和结构化重组。支持读取文档内容、调整格式与排版、规范化标题层级，可浏览目录批量处理多个文档。 当用户要求「整理知识库」、「重组笔记」、「知识库内容整理」、「结构化知识」、「格式化文档」时使用。 若需要将内容存入知识库，请使用 knowledge-save 技能。
"
homepage: 
version: 1.5.7
---

# 知识智能整理

知识智能整理技能可以将知识库中的碎片化笔记整理成结构化文档。

> 本技能依赖 `kdocs` 技能的基础文档操作能力（认证、文件管理等），请确保已安装该技能。详见 `references/core/` 目录。

---

## 能力范围


### 详细参考

| 文档类型 | 参考文件 | 说明 |
|----------|----------|------|
| 个人知识库（kwiki） | `references/kwiki_references.md` | 知识库空间、导入云文档、库内文件夹与资料操作 |
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

#### 知识智能整理

**流程**：
1. `kwiki.list_items` 遍历知识库获取文件列表（含 `file_id`、`drive_id`）
2. `read_file` 批量读取内容（直接使用 `list_items` 返回的 `file_id`）
3. AI 分析内容结构，生成整理/重组方案
4. `kwiki.create_item(doc_type="o")` 创建新智能文档
5. `otl.insert_content` 写入整理后的结构化内容

**按时间筛选归档**（如"一年前的文档移入归档知识库"）：
1. `kwiki.list_items` 遍历知识库，收集所有条目的 `file_id`、`ctime` 和 `drive_id`
2. 按 `ctime` 筛选出早于指定时间的文档（如 `ctime < 当前时间戳 - 365*86400`）
3. `kwiki.get_knowledge_view(name="归档")` 定位目标知识库（不存在则 `kwiki.create_knowledge_view` 创建），获取归档库 `drive_id`
4. `move_file(drive_id=原知识库drive_id, file_ids=[筛选出的file_id列表], dst_drive_id=归档库drive_id, dst_parent_id="0")` 批量移入归档库
5. ⚠️ 批量移动前需向用户确认文件列表

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`otl.block_delete`、`kwiki.close_knowledge_view`、`cancel_share`、`kwiki.delete_item`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 帮我把知识库里的零散笔记整理成结构化文档 | `kwiki.list_items` → `read_file`（批量）→ AI 整理 → `kwiki.create_item` + `otl.insert_content` |

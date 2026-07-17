---
name: doc-classify
description: "自动按内容分类创建文件夹、移动文件，支持标签管理与按标签检索。 当用户要求「分类整理」、「自动归类」、「打标签」、「按标签查找」、「文件归档」时使用。 若仅需搜索定位文件，请使用 doc-search 技能。
"
homepage: 
version: 1.5.7
---

# 文档分类整理

文档分类整理技能支持智能分类归档和标签化管理。

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

#### 智能分类整理

```
步骤 1: 定位目标目录
        - 指定文件夹 → search_files(keyword="文件夹名", file_type="folder", type="file_name")
        - 根目录 → search_files(file_type="folder", type="all", scope="personal_drive", page_size=1) 获取 drive_id

步骤 2: list_files(drive_id, parent_id, page_size=500)
        → 收集所有文件（有 next_page_token 时翻页继续）
        → 需要递归扫描子目录时，对 type="folder" 的项再次调用 list_files

步骤 3: read_file 批量读取各文件内容（用于 AI 分类判断）

步骤 4: AI 按用户指定维度分类（按内容/类型/部门/项目等）
        → 生成分类方案并向用户确认

步骤 5: create_folder(name="分类文件夹名") 创建分类目录
        move_file(file_ids=[...], dst_parent_id=分类文件夹ID)
        → ⚠️ 批量移动前需向用户确认
```

#### 标签列表、打标与按标检索

`list_labels`（或已知系统标签 ID）→ `search_files` / `list_files` 收集 `file_id` → `batch_add_label_objects`；查看某标签下文件：`get_label_objects(label_id, object_type="file")`；需确认标签定义时 `get_label_meta`。


> 场景：自定义分类标签、批量给文档打星标/项目标签，或列出「星标」「待办」等系统标签下的文件

#### 标签归类与检索

`list_labels` → `create_label`（如需新标签）→ `batch_add_label_objects`；按标签浏览 → `get_label_objects`


> 场景：自定义标签整理文件。系统标签 ID（星标、待办等）见 `references/drive.md` 中 `get_label_meta` / `get_label_objects` 说明。

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`cancel_share`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 列出目录，按内容、类型、部门等维度分类创建文件夹并归档。⚠️ `move_file` 前需向用户确认分类方案 | `search_files` → `list_files`（递归/分页）→ `read_file`（批量）→ AI 分类 → `create_folder` → `move_file` |
| 自定义分类标签、批量给文档打星标/项目标签，或列出「星标」「待办」等系统标签下的文件 | `list_labels`（或已知系统标签 ID）→ `search_files` / `list_files` 收集 `file_id` → `batch_add_label_objects`；查看某标签下文件：`get_label_objects(label_id, object_type="file")`；需确认标签定义时 `get_label_meta`。 |
| 自定义标签整理文件。系统标签 ID（星标、待办等）见 `references/drive.md` 中 `get_label_meta` / `get_label_objects` 说明。 | `list_labels` → `create_label`（如需新标签）→ `batch_add_label_objects`；按标签浏览 → `get_label_objects` |

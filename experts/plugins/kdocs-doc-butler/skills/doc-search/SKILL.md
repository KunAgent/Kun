---
name: doc-search
description: "搜索云盘文件、浏览目录结构，快速定位并整理文档。支持批量移动归档、回收站查看与恢复。 当用户要求「找文件」、「搜索文档」、「浏览目录」、「查找资料」时使用。 若需要按内容分类或打标签，请使用 doc-classify 技能。
"
homepage: 
version: 1.5.7
---

# 云文档搜索与整理

云文档搜索与整理技能帮助你快速找到和管理云盘中的文件。

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

#### 搜索定位文档

工具说明：`search_files(keyword="关键词", type="all", page_size=20)`，获取 `file_id`、`drive_id` 供后续链路使用。
详细参数与返回结构见 `references/drive/search.md`。

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

#### 整夹批量移动

```
步骤 1: search_files(keyword="源文件夹名", file_type="folder")
        → 获取源文件夹 file_id 和 drive_id
        search_files(keyword="目标文件夹名", file_type="folder")
        → 获取目标文件夹 file_id（作为 dst_parent_id）和 dst_drive_id
        → 目标不存在时 create_folder(name="目标文件夹") 先创建

步骤 2: list_files(drive_id, parent_id=源文件夹ID, page_size=500)
        → 收集所有 file_id（有 next_page_token 时翻页继续）

步骤 3: move_file(drive_id, file_ids=[...], dst_drive_id, dst_parent_id=目标文件夹ID)
        → ⚠️ 批量移动前需向用户确认文件列表和目标位置
```

#### 回收站查看与恢复

```
步骤 1: list_deleted_files(page_size=20)
        → 返回回收站文件列表（含 file_id、name、type）
        → 有 next_page_token 时翻页继续

步骤 2: 向用户展示回收站文件列表，确认需要恢复的文件

步骤 3: restore_deleted_file(file_id=选定文件ID)
        → 文件还原到原位置
        → 批量恢复时逐个调用
```

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`cancel_share`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 搜索定位文档 | `search_files` |
| 列出目录，按内容、类型、部门等维度分类创建文件夹并归档。⚠️ `move_file` 前需向用户确认分类方案 | `search_files` → `list_files`（递归/分页）→ `read_file`（批量）→ AI 分类 → `create_folder` → `move_file` |
| 用户要求将某个文件夹下的文件全部移动到另一个位置 | `search_files`（定位源和目标文件夹）→ `list_files`（分页列出全部文件）→ `move_file`（批量移动） |
| 用户需要查看回收站或恢复误删的文件 | `list_deleted_files` → `restore_deleted_file` |

---
name: knowledge-save
description: "将各类内容（网页、文件、云文档）一键保存到个人知识库。支持按时间筛选批量归档和自动分类，可浏览目录选择保存位置。 当用户要求「存入知识库」、「保存到知识库」、「归档到知识库」、「放到知识库」时使用。 若需要整理知识库已有内容，请使用 knowledge-format 技能。
"
homepage: 
version: 1.5.7
---

# 知识一键存入

知识一键存入技能帮助你将各类来源的内容快速归档到知识库。

> 本技能依赖 `kdocs` 技能的基础文档操作能力（认证、文件管理等），请确保已安装该技能。详见 `references/core/` 目录。

---

## 能力范围


### 详细参考

| 文档类型 | 参考文件 | 说明 |
|----------|----------|------|
| 个人知识库（kwiki） | `references/kwiki_references.md` | 知识库空间、导入云文档、库内文件夹与资料操作 |

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

#### 知识一键存入

**流程**：
1. **定位知识库**：指定库名 → `kwiki.get_knowledge_view(name=...)`；未指定 → `kwiki.list_knowledge_views` 推荐或引导创建
2. **定位目标路径**：指定文件夹 → `kwiki.list_items` 逐层查找；不存在则 `kwiki.create_item(doc_type="folder")` 按层级创建
3. **归档**：
   - 本地文件 → `upload_file` 上传（保持子目录结构时递归创建文件夹）
   - 网页 → `scrape_url` + `scrape_progress` → `move_file` 移入目标库
   - 云盘已有文件 → `kwiki.import_cloud_doc(action="copy"/"shortcut")`
   - **批量归档今日编辑** → `search_files(scope=["latest_edited"], time_type="mtime", start_time=今日0点时间戳, end_time=当前时间戳)` 筛选文件 → `read_file` 批量读取 → AI 按内容自动分类 → `kwiki.create_item(doc_type="folder")` 创建分类文件夹 → `kwiki.import_cloud_doc` 逐个归档
4. **确认结果**：`kwiki.list_items` 返回存放路径与直达链接

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`kwiki.close_knowledge_view`、`cancel_share`、`kwiki.delete_item`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 把这些资料存到知识库 | `kwiki.get_knowledge_view` → 按内容类型处理 → `kwiki.import_cloud_doc` / `upload_file` / `scrape_url` + `move_file` |

---
name: form-generator
description: "根据用户场景自动推断表头字段，创建信息收集或报名登记表格（.ksheet）。 当用户提到「报名表」、「信息收集」、「登记表」、「做个表单」、「收集信息」时使用。 若需要美化已有表格样式，请使用 table-beautify 技能。
"
homepage: 
version: 1.5.7
---

# 信息收集表单生成

信息收集表单生成技能根据你的需求自动推断表头字段，一键生成收集表。

> 本技能依赖 `kdocs` 技能的基础文档操作能力（认证、文件管理等），请确保已安装该技能。详见 `references/core/` 目录。

---

## 能力范围

### 通用工具总览

#### 文档创建与上传
| 工具 | 用途 |
|------|------|
| [`create_file`](references/drive/create_and_upload.md) | 在云盘下新建文件 |
| [`scrape_url`](references/drive/create_and_upload.md) | 网页剪藏，抓取网页内容并自动保存为智能文档 |
| [`scrape_progress`](references/drive/create_and_upload.md) | 查询网页剪藏任务进度 |
| [`upload_file`](references/drive/create_and_upload.md) | 全量上传写入文件（更新已有 docx/pdf 或新建并上传本地文件） |

#### 文档读取与下载
| 工具 | 用途 |
|------|------|
| [`list_files`](references/drive/read_and_download.md) | 获取指定文件夹下的子文件列表 |
| [`download_file`](references/drive/read_and_download.md) | 获取文件下载信息 |
| [`read_file`](references/drive/read_and_download.md) | 读取文档内容为 Markdown/结构化数据 |

#### 文件组织
| 工具 | 用途 |
|------|------|
| [`move_file`](references/drive/organize.md) | 批量移动文件(夹) |
| [`rename_file`](references/drive/organize.md) | 重命名文件（夹） |

#### 分享与访问
| 工具 | 用途 |
|------|------|
| [`share_file`](references/drive/share.md) | 开启文件分享 |
| [`set_share_permission`](references/drive/share.md) | 修改分享链接属性 |
| [`cancel_share`](references/drive/share.md) | 取消文件分享 |
| [`get_share_info`](references/drive/share.md) | 获取分享链接信息 |
| [`get_file_link`](references/drive/share.md) | 获取文件的云文档在线访问链接 |

#### 搜索
| 工具 | 用途 |
|------|------|
| [`search_files`](references/drive/search.md) | 文件（夹）搜索 |

#### 数据操作
| 工具 | 用途 |
|------|------|
| [`sheet.update_range_data`](references/sheet/data.md) | 批量更新选区数据 |

### 详细参考

| 文档类型 | 参考文件 | 说明 |
|----------|----------|------|
| 表格文档/智能表格（xlsx & ksheet） | `references/sheet_references.md` | 工作表管理、范围数据获取、批量更新 |

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

#### 信息收集表单生成

**步骤 1**：识别用户场景 → 根据用户场景推测表格名称(`sheetName`)和表头(`headerList`)字段

**步骤 2**：将推测的表头返回给用户确认，格式：
"已为你设计好 {{sheetName}} 表，表头为 {{headerList}}，确认生成？回复'确认'或告诉我需要调整的字段"
→ 用户回复需要调整则继续调整，回复确认则进入下一步

**步骤 3**：`create_file_with_content` 创建智能表格(.ksheet)并写入表头，直接返回 link_url
> 兜底：若表头字段过多导致单次写入失败，改用 `create_file` + `sheet.update_range_data` 分步写入

**步骤 4**：向用户展示表格链接(link_url)

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`sheet.delete_sheets`、`sheet.delete_range_data`、`cancel_share`、`sheet.delete_protection_ranges`、`sheet.delete_data_validations`、`sheet.delete_conditional_format_rules`、`sheet.delete_float_images`、`sheet.delete_filters`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 用户需要新建表格用来收集信息、统计信息 | AI 设计表头 → 用户确认 → `create_file_with_content`(.ksheet) → 返回 link_url |

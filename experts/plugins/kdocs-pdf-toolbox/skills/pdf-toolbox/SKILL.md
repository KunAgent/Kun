---
name: pdf-toolbox
description: "PDF 文档的创建、内容读取、页数查询与页面提取操作。可浏览目录定位 PDF 文件。 当用户提到「PDF」、「读取 PDF」、「PDF 页数」、「提取 PDF 页面」、「PDF 拆分」时使用。 若需要操作其他文档类型，请使用 kdocs 或对应类型技能。
"
homepage: 
version: 1.5.7
---

# PDF 工具箱

PDF 工具箱提供 PDF 文档的全面操作能力。

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

#### 页面查询
| 工具 | 用途 |
|------|------|
| [`pdf.get_pdf_page_count`](references/pdf/inspect.md) | 查询 PDF 总页数 |

#### 拆分与合并
| 工具 | 用途 |
|------|------|
| [`pdf.extract_pdf_pages`](references/pdf/split_and_merge.md) | 提取指定页并生成新 PDF |
| [`pdf.split`](references/pdf/split_and_merge.md) | 将 PDF 按固定页数间隔拆分为多个文件 |
| [`pdf.split_query`](references/pdf/split_and_merge.md) | 查询 PDF 拆分任务进度 |
| [`pdf.merge`](references/pdf/split_and_merge.md) | 将多个 PDF 文件合并为一个 |
| [`pdf.merge_query`](references/pdf/split_and_merge.md) | 查询 PDF 合并任务进度 |

#### 格式转换
| 工具 | 用途 |
|------|------|
| [`pdf.convert`](references/pdf/convert.md) | 发起 PDF 转 Office 转换任务 |
| [`pdf.convert_query`](references/pdf/convert.md) | 查询 PDF 转换任务进度与结果 |

#### 全文翻译
| 工具 | 用途 |
|------|------|
| [`pdf.translate_full_file`](references/pdf/translate.md) | 提交 PDF 全文翻译导出任务 |
| [`pdf.get_translate_progress`](references/pdf/translate.md) | 查询全文翻译任务进度 |
| [`pdf.cancel_translate`](references/pdf/translate.md) | 取消全文翻译任务 |

### 详细参考

| 文档类型 | 参考文件 | 说明 |
|----------|----------|------|
| PDF 文档（pdf） | `references/pdf_references.md` | PDF 创建与内容读取 |

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

#### PDF 文档操作

按用户需求选择对应操作：

**读取 PDF 内容**：
1. `search_files` 或 `get_share_info` 定位文档 → 获取 `file_id`、`drive_id`
2. `read_file(file_id=...)` → 返回 Markdown 文本
> 适合摘要、信息提取等场景；复杂排版可能有精度损失

**查询 PDF 页数**：
1. `search_files` 定位 PDF → 获取 `file_id`
2. `pdf.get_pdf_page_count(file_id=...)` → 返回总页数

**提取指定页面**：
1. `search_files` 定位 PDF → 获取 `file_id`
2. `pdf.get_pdf_page_count` 确认总页数，校验用户请求的页码是否越界
3. `pdf.extract_pdf_pages(file_id=..., ranges=[{from:1,to:1},{from:5,to:8}])` → 生成新 PDF
> 页码 1-based；`ranges` 为 `{from, to}` 对象数组，多段按顺序合并；提取结果为临时下载链接

**按固定页数拆分**：
1. `search_files` 定位 PDF → 获取 `file_id`
2. `pdf.get_pdf_page_count` 确认总页数
3. `pdf.split(file_id=..., dc_interval=N, file_name="章节")` 发起拆分，返回 `jobid`
4. `pdf.split_query(jobid=...)` 轮询进度，直到 `progress=100`
5. 从 `result_files` 读取各子文件（file_id、name、download_url）
> `dc_interval` 为每 N 页拆分一次；结果存入金山文档 `我的云文档/应用/PDF拆分`

**合并多个 PDF**：
1. `search_files` 定位所有待合并 PDF → 获取各 `file_id`
2. `pdf.merge(files=[{file_id:"..."}, {file_id:"..."}], file_name="完整报告")` 发起合并，返回 `jobid`
3. `pdf.merge_query(jobid=...)` 轮询进度，直到 `progress=100`
4. 从 `result_files` 读取合并结果（file_id、name、download_url）
> `files` 数组按顺序合并，至少 2 个；结果存入金山文档 `我的云文档/应用/PDF合并`

**转换为可编辑文档（Word/Excel/PPT）**：
1. `search_files` 定位 PDF → 获取 `file_id`
2. `pdf.convert(file_id=..., to_format="docx|xlsx|pptx", ...)` 发起转换任务（默认 `is_free_convert=false`）
3. 若步骤 2 返回 `code=400100` 或含 `VipLevelNotEnough` 等会员不足提示，使用相同参数、仅将 `is_free_convert=true` 重新调用 `pdf.convert`（免费额度最多处理前 5 页）
4. `pdf.convert_query(jobid=..., file_id=..., fname=...)` 轮询进度，直到 `progress=100`
5. 从 `result_files` 读取转换结果（类型、大小、下载 URL）

**全文翻译导出（双语/指定语言）**：
1. `search_files` 定位 PDF → 获取 `file_id`
2. `pdf.translate_full_file(file_id=..., from_lang=..., to_lang=..., output_file_mode=..., output_file_two_lang=...)`
3. 若 `pdf.translate_full_file` 返回任务态，再用 `pdf.get_translate_progress(file_id=..., task_id=...)` 轮询
4. 任务需中止时调用 `pdf.cancel_translate(file_id=...)`

**创建/上传 PDF**：
- `upload_file(drive_id=..., parent_id=..., name="xxx.pdf", content_base64=...)` 直接上传
- 更新已有 PDF：`upload_file(file_id=..., content_base64=...)` 全量覆盖

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`cancel_share`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 用户需要读取 PDF 内容、查询页数、提取指定页面、拆分合并、转换可编辑格式或做整文翻译导出 | `search_files` → `read_file` / `pdf.get_pdf_page_count` / `pdf.extract_pdf_pages` / `pdf.split` + `pdf.split_query` / `pdf.merge` + `pdf.merge_query` / `pdf.convert` + `pdf.convert_query` / `pdf.translate_full_file` |

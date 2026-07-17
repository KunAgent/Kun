# 拆分与合并

## 1. pdf.extract_pdf_pages

#### 功能说明

从原 PDF 中提取指定页码范围，生成新的 PDF 文件。

**适用于**：合同附件拆分、章节抽取、仅导出指定页面。

- `from` 和 `to` 都必须是正整数
- 多个范围会按传入顺序组合到新的 PDF 中
- 建议先调用 `pdf.get_pdf_page_count`，避免页码越界

**模型使用建议**：

- 当用户说"把第 3 到 5 页单独导出""保留封面和附录"时，优先使用这个工具
- 页码是 1-based，不要按 0-based 传参
- 如果用户描述的是"按章节拆分"，但没有给出章节对应页码，应先通过阅读内容或询问用户确认页码
- 如果目标是"提取正文文本"而不是"生成新 PDF"，不要用这个工具，改用 `read_file`



#### 操作约束

- **前置检查**：建议先 get_pdf_page_count 确认页码范围有效

**幂等性**：否 — 重复调用会创建多个提取任务，先确认是否已成功

#### 调用示例

提取第 1-3 页和第 8-10 页：

```json
{
  "file_id": "file_pdf_001",
  "ranges": [
    {
      "from": 1,
      "to": 3
    },
    {
      "from": 8,
      "to": 10
    }
  ]
}
```


#### 参数说明

- `file_id` (string, 必填): 原始 PDF 文件 ID
- `ranges` (array, 必填): 要提取的页码范围列表，每项含 from 和 to（1-based）
  - `from` (integer, 必填): 起始页，1-based，且包含该页
  - `to` (integer, 必填): 结束页，1-based，且包含该页

#### 返回值说明

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "download_uri": "https://weboffice-test.ks3-cn-beijing.wpscdn.cn/tmp/exportfiles/..."
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.download_uri` | string | 提取后 PDF 的临时下载链接（有时效性） |


---

## 2. pdf.split

#### 功能说明

将一个 PDF **按固定页数间隔**拆分为多个独立 PDF，**异步任务**；返回任务信息（含 `jobid`），需配合 **`pdf.split_query`** 轮询直至完成。

**适用于**：将大 PDF 切分为小文件、按固定章节大小拆分、批量分发。

- `dc_interval` 为每 N 页拆分一次，须为正整数
- 拆分结果需通过 `pdf.split_query` 轮询查询
- 若 PDF 有打开密码或编辑密码，可通过 `open_password` / `edit_password` 传入

**模型使用建议**：

- 当用户说"把 PDF 按每 X 页拆成多个文件""把大 PDF 切成小文件"时，优先使用这个工具
- 若用户说"按章节拆分"但未给出具体页数间隔，应先询问每章大约多少页
- 若目标是"提取指定几页"而不是"按固定间隔拆分"，不要用这个工具，改用 `pdf.extract_pdf_pages`



#### 操作约束

- **前置检查**：必须先调用 `pdf.get_pdf_page_count` 得到 `page_count`，再调用本工具
- **禁止**：禁止跳过页数查询凭猜测传参；禁止以 schema 默认值代替实际 page_count 映射
- **禁止**：禁止在 `pdf.split` 返回失败后修改 `is_free_convert` 或其他约定参数再次调用
- **提示**：`is_free_convert` 由 `page_count` 唯一确定：`page_count <= 5` → `true`，`> 5` → `false`
- **提示**：对用户不得透露 `is_free_convert` 字段名、免费额度策略及页数阈值等内部调用细节

**幂等性**：否 — 禁止自动换参重试；若按规则仅调用一次后仍失败，向用户说明失败现象

> 拆分完成后，结果文件存入金山文档云盘 `我的云文档/应用/PDF拆分`，文件名前缀为 `file_name` 参数值
> 任务需通过 `pdf.split_query(jobid=...)` 轮询查询，直到完成

#### 调用示例

将 PDF 按每 10 页拆分（示例假定已测得 page_count>5，故 is_free_convert 为 false；示例中该字段仅作结构示意，实际须由真实 page_count 唯一确定）：

```json
{
  "file_id": "D4wSLroj69MpzBu2Ww2P1xQVE9mmb2kz8",
  "dc_interval": 10,
  "file_name": "章节",
  "is_free_convert": false
}
```

将加密 PDF 按每 3 页拆分（示例假定已测得 page_count≤5，故 is_free_convert 为 true；示例中该字段仅作结构示意，实际须由真实 page_count 唯一确定）：

```json
{
  "file_id": "D4wSLroj69MpzBu2Ww2P1xQVE9mmb2kz8",
  "dc_interval": 3,
  "open_password": "mypass123",
  "is_free_convert": true
}
```


#### 参数说明

- `file_id` (string, 必填): 待拆分的 PDF 文件 ID（支持 V7 unique_id 或数字 file_id）
- `dc_interval` (number, 必填): 拆分间隔：每 N 页拆分一次，须为正整数。例如 dc_interval=5 表示每 5 页生成一个子文件
- `file_name` (string, 可选): 输出文件名前缀（不含扩展名），默认 document。实际文件名可能带序号，如 document_001.pdf；默认值：`document`
- `open_password` (string, 可选): PDF 打开密码（有密码保护时填写）
- `edit_password` (string, 可选): PDF 编辑密码（有密码保护时填写）
- `is_free_convert` (boolean, 可选): 是否使用免费额度，由 `pdf.get_pdf_page_count` 返回的 `page_count` 唯一确定：`page_count <= 5` 为 `true`，`> 5` 为 `false`；默认值：`false`

#### 返回值说明

```json
{
  "code": {
    "type": "number"
  },
  "msg": {
    "type": "string"
  },
  "data": {
    "type": "object",
    "fields": [
      {
        "name": "file_id",
        "type": "string",
        "description": "源 PDF 文件 ID"
      },
      {
        "name": "jobid",
        "type": "string",
        "description": "拆分任务 ID（用于调用 pdf.split_query）"
      },
      {
        "name": "query_params",
        "type": "object",
        "description": "查询参数，含 jobid 字段"
      },
      {
        "name": "total_pages",
        "type": "number",
        "description": "源 PDF 总页数"
      },
      {
        "name": "split_count",
        "type": "number",
        "description": "预计拆分出的子文件数量"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.file_id` | string | 源 PDF 文件 ID |
| `data.jobid` | string | 拆分任务 ID（用于调用 pdf.split_query） |
| `data.query_params` | object | 查询参数，含 jobid 字段 |
| `data.total_pages` | number | 源 PDF 总页数 |
| `data.split_count` | number | 预计拆分出的子文件数量 |


---

## 3. pdf.split_query

#### 功能说明

查询 PDF 拆分任务进度，完成后返回拆分结果文件信息。

**适用于**：`pdf.split` 发起拆分后，轮询查询任务状态。

- 需传入 `pdf.split` 返回的 `jobid`
- `progress=100` 表示拆分完成，此时 `result_files` 中包含所有子文件信息
- 若任务失败，`status` 会反映错误状态



> 建议轮询间隔 2-3 秒，避免频繁请求
> 拆分完成后，通过 `drive.share_file` 创建公开分享链接，再用 `drive.download_file` 获取下载信息

#### 调用示例

查询拆分任务进度：

```json
{
  "jobid": "abc123split456"
}
```


#### 参数说明

- `jobid` (string, 必填): 拆分任务 ID（pdf.split 返回的 jobid 或 query_params.jobid）

#### 返回值说明

```json
{
  "code": {
    "type": "number"
  },
  "msg": {
    "type": "string"
  },
  "data": {
    "type": "object",
    "fields": [
      {
        "name": "progress",
        "type": "number",
        "description": "任务进度（0-100），100 表示完成"
      },
      {
        "name": "status",
        "type": "string",
        "description": "任务状态，如 pending/running/done/failed"
      },
      {
        "name": "total_pages",
        "type": "number",
        "description": "源 PDF 总页数"
      },
      {
        "name": "split_count",
        "type": "number",
        "description": "实际拆分出的子文件数量"
      },
      {
        "name": "result_files",
        "type": "array",
        "description": "拆分结果文件列表（progress=100 时返回），含 file_id、name、download_url 等"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.progress` | number | 任务进度（0-100），100 表示完成 |
| `data.status` | string | 任务状态，如 pending/running/done/failed |
| `data.total_pages` | number | 源 PDF 总页数 |
| `data.split_count` | number | 实际拆分出的子文件数量 |
| `data.result_files` | array | 拆分结果文件列表（progress=100 时返回），含 file_id、name、download_url 等 |


---

## 4. pdf.merge

#### 功能说明

将多个 PDF 文件合并为一个 PDF，返回合并任务信息。

**适用于**：将多个 PDF 合并为一个大文件、批量上传文件合并归档。

- `files` 至少需要 2 个文件，按数组顺序依次合并
- 每个文件只需传 `file_id`（必填），`file_name`（选填，含 .pdf 后缀）
- 合并结果需通过 `pdf.merge_query` 轮询查询

**模型使用建议**：

- 当用户说"把几个 PDF 合并成一个""把 a.pdf 和 b.pdf 拼接"时，优先使用这个工具
- 若用户只给了一个文件 ID，询问是否还有其他文件需要合并
- 若目标是"按页码顺序拼接"，需要确认文件之间的正确顺序



**幂等性**：否 — 重复调用会创建多个合并任务，先用 merge_query 确认已有任务状态

> 合并完成后，结果文件存入金山文档云盘 `我的云文档/应用/PDF合并`，文件名为 `file_name` 参数值
> 任务需通过 `pdf.merge_query(jobid=...)` 轮询查询，直到完成

#### 调用示例

合并两个 PDF 文件：

```json
{
  "files": [
    {
      "file_id": "D4wSLroj69MpzBu2Ww2P1xQVE9mmb2kz8",
      "file_name": "第一章.pdf"
    },
    {
      "file_id": "qAFH4tdCurMo83uSC273rxcfK36RLGACh",
      "file_name": "第二章.pdf"
    }
  ],
  "file_name": "完整报告"
}
```


#### 参数说明

- `files` (array, 必填): 待合并的 PDF 文件列表，至少 2 个，按顺序合并
  - `file_id` (string, 必填): PDF 文件 ID（支持 V7 unique_id 或数字 file_id）
  - `file_name` (string, 选填): 文件名（含 .pdf 后缀），如 a.pdf，用于确认文件来源
- `file_name` (string, 可选): 合并后的输出文件名（不含扩展名），默认 merged.pdf；默认值：`merged`

#### 返回值说明

```json
{
  "code": {
    "type": "number"
  },
  "msg": {
    "type": "string"
  },
  "data": {
    "type": "object",
    "fields": [
      {
        "name": "jobid",
        "type": "string",
        "description": "合并任务 ID（用于调用 pdf.merge_query）"
      },
      {
        "name": "query_params",
        "type": "object",
        "description": "查询参数，含 jobid 字段"
      },
      {
        "name": "file_count",
        "type": "number",
        "description": "待合并的文件数量"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.jobid` | string | 合并任务 ID（用于调用 pdf.merge_query） |
| `data.query_params` | object | 查询参数，含 jobid 字段 |
| `data.file_count` | number | 待合并的文件数量 |


---

## 5. pdf.merge_query

#### 功能说明

查询 PDF 合并任务进度，完成后返回合并结果文件信息。

**适用于**：`pdf.merge` 发起合并后，轮询查询任务状态。

- 需传入 `pdf.merge` 返回的 `jobid`
- `progress=100` 表示合并完成，此时 `result_files` 中包含合并后的文件信息
- 若任务失败，`status` 会反映错误状态



> 建议轮询间隔 2-3 秒，避免频繁请求
> 合并完成后，通过 `drive.share_file` 创建公开分享链接，再用 `drive.download_file` 获取下载信息

#### 调用示例

查询合并任务进度：

```json
{
  "jobid": "abc123merge456"
}
```


#### 参数说明

- `jobid` (string, 必填): 合并任务 ID（pdf.merge 返回的 jobid 或 query_params.jobid）

#### 返回值说明

```json
{
  "code": {
    "type": "number"
  },
  "msg": {
    "type": "string"
  },
  "data": {
    "type": "object",
    "fields": [
      {
        "name": "progress",
        "type": "number",
        "description": "任务进度（0-100），100 表示完成"
      },
      {
        "name": "status",
        "type": "string",
        "description": "任务状态，如 pending/running/done/failed"
      },
      {
        "name": "file_count",
        "type": "number",
        "description": "待合并的原始文件数量"
      },
      {
        "name": "result_files",
        "type": "array",
        "description": "合并结果文件列表（progress=100 时返回），含 file_id、name、download_url 等"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.progress` | number | 任务进度（0-100），100 表示完成 |
| `data.status` | string | 任务状态，如 pending/running/done/failed |
| `data.file_count` | number | 待合并的原始文件数量 |
| `data.result_files` | array | 合并结果文件列表（progress=100 时返回），含 file_id、name、download_url 等 |


---


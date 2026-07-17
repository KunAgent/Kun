# 格式转换

## 1. pdf.convert

#### 功能说明

将 PDF 转换为 Office 可编辑格式，并返回转换任务信息。

**适用于**：需要把 PDF 转为 `docx`、`xlsx` 或 `pptx` 继续编辑的场景。

- 本工具用于“发起转换任务”
- 转换完成结果需通过 `pdf.convert_query` 查询
- 页码参数为 1-based（第一页为 1）



**幂等性**：否 — 若返回会员不足错误（VipLevelNotEnough），可将 is_free_convert 设为 true 重试一次

> 默认 `is_free_convert=false`（付费额度），若返回 `code=400100` 或错误含 `VipLevelNotEnough` 等会员不足提示，使用相同 `file_id`、`to_format`、页码范围等参数，仅将 `is_free_convert` 设为 `true` 重试一次（免费额度最多处理前 5 页）
> 转换完成后，结果文件存入金山文档云盘 `我的云文档/应用/PDF转换`，文件名为 `原文件名.docx/xlsx/pptx`
> 若 `pdf.convert_query` 不可用（返回 404），可通过 `drive.search_files` 搜索转换后的文件名找到结果
> 获取转换文件后，用 `drive.share_file` 创建公开分享链接，再用 `drive.download_file` 获取下载信息

#### 调用示例

转换 PDF 为 docx：

```json
{
  "file_id": "file_pdf_001",
  "to_format": "docx",
  "page_range_from": 1,
  "page_range_to": 3,
  "is_free_convert": false
}
```


#### 参数说明

- `file_id` (string, 必填): PDF 文件 ID
- `to_format` (string, 必填): 目标格式，仅支持 docx、xlsx、pptx
- `file_name` (string, 可选): 转换后文件的文件名（不含扩展名，如原文件为"报告.pdf"则默认输出"报告"）；默认值：`自动取原 PDF 文件名（去掉 .pdf 后缀）`
- `page_range_from` (integer, 可选): 起始页码（1-based）；默认值：`1`
- `page_range_to` (integer, 可选): 结束页码（1-based）；默认值：`1`
- `open_password` (string, 可选): 打开密码（有密码文件时填写）
- `edit_password` (string, 可选): 编辑密码（有密码文件时填写）
- `messy_repair` (boolean, 可选): 是否开启乱码修复；默认值：`false`
- `is_free_convert` (boolean, 可选): 是否使用免费转换额度（免费额度最多处理前 5 页）。默认 false，优先使用付费额度以获得完整转换。当返回会员/VIP 不足错误（code=400100 或含 VipLevelNotEnough 等提示）时，应使用相同参数、仅将此字段设为 true 重新发起转换；默认值：`false`

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
        "type": "integer",
        "description": "源 PDF 数字文件 ID"
      },
      {
        "name": "encoded_file_id",
        "type": "string",
        "description": "转换服务内部文件标识"
      },
      {
        "name": "convert_job",
        "type": "object",
        "description": "转换任务信息（含 jobid）"
      },
      {
        "name": "query_params",
        "type": "object",
        "description": "查询参数（用于调用 pdf.convert_query）"
      },
      {
        "name": "file_info",
        "type": "object",
        "description": "源 PDF 文件信息（含页数、转换进度 progress=100 表示完成）"
      },
      {
        "name": "result_files",
        "type": "array",
        "description": "转换结果文件列表（包含 file_id、name、type、download_url 等字段）"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.file_id` | integer | 源 PDF 数字文件 ID |
| `data.encoded_file_id` | string | 转换服务内部文件标识 |
| `data.convert_job` | object | 转换任务信息（含 jobid） |
| `data.query_params` | object | 查询参数（用于调用 pdf.convert_query） |
| `data.file_info` | object | 源 PDF 文件信息（含页数、转换进度 progress=100 表示完成） |
| `data.result_files` | array | 转换结果文件列表（包含 file_id、name、type、download_url 等字段） |


---

## 2. pdf.convert_query

#### 功能说明

查询 `pdf.convert` 发起的转换任务状态；完成后返回转换结果文件信息。

**适用于**：异步转换任务轮询，直到拿到可下载结果文件。

- 常见轮询间隔建议 1-2 秒
- 当 `progress=100` 时可读取结果文件信息



> `progress < 100` 时继续轮询
> `progress = 100` 时从 `result_files` 读取目标文件 URL 与类型

#### 调用示例

查询转换结果：

```json
{
  "jobid": "69d47281d3e451001f1be3a8wl",
  "file_id": "file_pdf_001",
  "fname": "contract.pdf"
}
```


#### 参数说明

- `jobid` (string, 必填): 转换任务 ID，来自 `pdf.convert` 返回值
- `file_id` (string, 必填): 源 PDF 文件 ID
- `fname` (string, 可选): 源 PDF 文件名（含 .pdf 后缀）；默认值：`document.pdf`

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
        "type": "integer",
        "description": "转换进度，100 表示完成"
      },
      {
        "name": "result_files",
        "type": "array",
        "description": "转换结果文件列表（完成后返回）"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.progress` | integer | 转换进度，100 表示完成 |
| `data.result_files` | array | 转换结果文件列表（完成后返回） |


---


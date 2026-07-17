# 下载与导出

## 1. wpp.export_image

#### 功能说明

将幻灯片导出为 **PNG** 或 **JPEG** 图片（同步接口，直接返回下载地址或 key）。

**适用于**：缩略图、逐页图片导出。



**幂等性**：否 — 导出为异步任务，用 task_id 轮询结果而非重复提交

#### 调用示例

逐页、96 dpi、PNG、含水印：

```json
{
  "link_id": "string",
  "format": "png",
  "dpi": 96,
  "water_mark": true,
  "from_page": 1,
  "to_page": 100,
  "combine_long_pic": false,
  "use_xva": true,
  "client_id": "",
  "password": "",
  "store_type": ""
}
```


#### 参数说明

- `link_id` (string, 必填): 演示文稿的分享链接 ID（从分享链接 URL 中提取）
- `format` (string, 必填): 导出图片格式。可选值：`png` / `jpeg`
- `dpi` (integer, 可选): 图片 DPI。可选值：`96` / `150` / `300`；默认值：`96`
- `water_mark` (boolean, 可选): 是否含水印；默认值：`true`
- `from_page` (integer, 可选): 起始页，从 0 开始；默认值：`1`
- `to_page` (integer, 可选): 结束页；默认值：`9999`
- `combine_long_pic` (boolean, 可选): 是否合并为长图；`false` 表示逐页
- `use_xva` (boolean, 可选): 是否使用 XVA 渲染引擎
- `client_id` (string, 可选): 客户端标识
- `password` (string, 可选): 文档打开密码（若加密）
- `store_type` (string, 可选): 存储类型，如 `ks3`、`cloud`

#### 返回值说明

```json
{
  "result": "ok",
  "url": "string",
  "key": "string",
  "file_id": "string",
  "without_attachment": false,
  "size": 0
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `result` | string | 成功为 `ok` |
| `url` | string | 图片下载地址（有时效） |
| `key` | string | 导出文件标识 |
| `file_id` | string | 关联文件 ID |
| `size` | integer | 仅当请求要求返回大小时可能存在 |

失败时可能返回 `result` 为 `error` 且带 `data.code` / `data.message`，以实际响应为准。


---

## 2. wpp.export_pdf

#### 功能说明

异步导出 PDF **步骤一**：**创建导出任务**（`POST .../async-export`），返回 `task_id`。本工具传入 `task_id` 时会调用查询接口进行轮询。

**适用于**：需要可打印、可分享的 PDF 文件。

**步骤二**：传入 `task_id` 查询导出进度，`status` 为 `running` 时需等待后重试，`finished` 时返回下载链接。



**幂等性**：否 — 导出为异步任务，用 task_id 轮询结果而非重复提交

#### 调用示例

步骤一：创建导出任务：

```json
{
  "file_id": "string",
  "format": "pdf",
  "multipage": 1,
  "opt_frame": true,
  "from_page": 1,
  "to_page": 9999,
  "client_id": "",
  "store_type": "ks3",
  "password": "",
  "export_open_password": "",
  "export_modify_password": ""
}
```

步骤二：查询导出进度：

```json
{
  "task_id": "string",
  "task_type": "normal_export"
}
```


#### 参数说明

- `file_id` (string, 必填): 演示文稿文件 ID
- `format` (string, 必填): 固定 `pdf`
- `task_id` (string, 可选): 任务 ID，步骤一返回，轮询时必填
- `task_type` (string, 可选): 任务类型，固定 `normal_export`（轮询时必填）
- `multipage` (integer, 可选): 是否多页合一类导出；`1` 表示是
- `opt_frame` (boolean, 可选): 是否优化帧；默认值：`true`
- `from_page` (integer, 可选): 起始页，从 0 开始；默认值：`1`
- `to_page` (integer, 可选): 结束页；默认值：`9999`
- `client_id` (string, 可选): 客户端标识
- `store_type` (string, 可选): 存储类型，如 `ks3`、`cloud`
- `password` (string, 可选): 源文件密码
- `export_open_password` (string, 可选): 导出 PDF 打开密码
- `export_modify_password` (string, 可选): 导出 PDF 修改密码

#### 返回值说明

```json
步骤一返回：

```json
{
  "task_id": "string",
  "task_type": "normal_export"
}
```

步骤二返回（进行中）：

```json
{
  "status": "running",
  "data": null
}
```

步骤二返回（已完成）：

```json
{
  "status": "finished",
  "data": {
    "file_id": "string",
    "key": "string",
    "result": "ok",
    "url": "string",
    "without_attachment": false
  }
}
```

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 异步任务 ID，后续查询必填 |
| `task_type` | string | 固定为 `normal_export`（导出 PDF 场景） |
| `status` | string | `running` / `finished` |
| `data.url` | string | PDF 下载地址（`finished` 时，有时效） |


---


# 演示文稿与页面

## 1. wpp.insert_slide

#### 功能说明

在**已有**在线演示文稿中插入一页空白幻灯片。

**适用于**：已存在、可编辑的 WPP 演示（`file_id` 对应在线演示文档）。



**幂等性**：否 — 重复调用会插入多页幻灯片，先确认是否已成功

#### 调用示例

在第 1 页后插入空白页：

```json
{
  "file_id": "string",
  "slide_idx": 1,
  "layer_type": 65538,
  "layout_Id": 134217788
}
```


#### 参数说明

- `file_id` (string, 必填): 演示文稿 file_id
- `slide_idx` (integer, 必填): 插入位置的幻灯片序号，**从 0 开始**
- `layer_type` (integer, 可选): 版式类型，固定值 `65538`
- `layout_Id` (integer, 可选): 指定模板版式 ID，从对应版式新建幻灯片（如结束页、标题页、内容页等）。版式 ID 与演示文稿模板中定义的版式一一对应，不同模板的可用 ID 不同

#### 返回值说明

```json
{
  "result": "ok",
  "detail": {
    "res": [
      {
        "cmdName": "slideInsert",
        "code": 0,
        "errName": "S_OK",
        "msg": "execute result",
        "token": "string"
      }
    ]
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `result` | string | 请求成功为 `ok` |
| `detail.res[].cmdName` | string | 内核命令名，如 `slideInsert` |
| `detail.res[].code` | integer | `0` 表示该条执行成功 |
| `detail.res[].errName` | string | 如 `S_OK` |
| `detail.res[].token` | string | 可选，会话/追踪用 |


---

## 2. wpp.import_slides

#### 功能说明

从外部 PPTX 文件（通过 URL 获取）中选取指定幻灯片，导入到已有在线演示文稿的指定位置。

**适用于**：将其他 PPTX 文件中的页面合并到已有在线演示文档中。



#### 操作约束

- **前置检查**：先确认目标演示文稿的 link_id（从文档 URL 路径末尾提取，或通过 search_files / get_file_info 获取）
- **提示**：object_url 域名需在服务端白名单内，否则返回 `validate_object_url` 错误

**幂等性**：否 — 重复调用会再次导入同一组页面，重试前先确认目标文稿中是否已导入成功

#### 调用示例

导入源 PPTX 第 1 页到目标文稿第 1 页位置：

```json
{
  "link_id": "cupf4t47i6Fx",
  "object_url": "https://example.com/slides/demo.pptx",
  "slide_idx": 0,
  "source_idxs": [
    0
  ]
}
```

导入源 PPTX 第 1、3、5 页到目标文稿第 2 页位置（原第 2 页及之后后移）：

```json
{
  "link_id": "cupf4t47i6Fx",
  "object_url": "https://example.com/slides/demo.pptx",
  "slide_idx": 1,
  "source_idxs": [
    0,
    2,
    4
  ]
}
```


#### 参数说明

- `link_id` (string, 必填): 目标演示文稿的 link_id（从文档 URL 路径末尾提取，或由 search_files / get_file_info 返回）
- `object_url` (string, 必填): 源 PPTX 文件的下载 URL
- `slide_idx` (integer, 必填): 插入位置，目标文稿中的幻灯片索引，**从 0 开始**。导入的页面占据该索引位置，原位置及之后的页面顺序后移。用户说"插入到第 n 页"时传 n-1。超出范围时自动尾插
- `source_idxs` (array, 必填): 要导入的源文件幻灯片索引数组，**从 0 开始**

#### 返回值说明

```json
{
  "result": "ok",
  "detail": {
    "res": [
      {
        "cmdName": "docTemplate",
        "code": 0,
        "errName": "S_OK",
        "msg": "execute result"
      }
    ]
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `result` | string | 请求成功为 `ok` |
| `detail.res[].cmdName` | string | 内核命令名，如 `docTemplate` |
| `detail.res[].code` | integer | `0` 表示该条执行成功 |
| `detail.res[].errName` | string | 如 `S_OK` |


---


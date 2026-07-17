# otl.convert

## 1. otl.convert

#### 功能说明

将 HTML、Markdown 等内容转换为智能文档块结构，适合在正式插入前先生成可复用的块内容。



**幂等性**：是

> `otl.convert` 仅做格式转换，不会修改文档内容；需配合 `otl.block_insert` 才能将转换结果写入文档
> 返回结果中 `blocks` 字段为转换得到的块数组，可直接用于 `otl.block_insert` 插入至文档。块类型和属性说明见 `references/otl/node.md`
> `params.format` 只支持 `"html"` 和 `"markdown"` 两种值
> `params.content` 中如包含换行符，使用 `\n` 表示

#### 调用示例

将 Markdown 内容转为块数据：

```json
{
  "file_id": "string",
  "params": {
    "format": "markdown",
    "content": "# 标题\n\n段落内容"
  }
}
```

将 HTML 内容转为块数据：

```json
{
  "file_id": "string",
  "params": {
    "format": "html",
    "content": "<h1>标题</h1><p>段落内容</p>"
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 智能文档文件 ID
- `params` (object, 必填): 转换参数对象
  - `format` (string, 必填): 源数据格式，支持 `"html"` 或 `"markdown"`
  - `content` (string, 必填): 待转换的源数据内容

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "...": "..."
  }
}

```


---


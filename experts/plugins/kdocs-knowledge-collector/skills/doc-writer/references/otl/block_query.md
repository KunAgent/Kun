# otl.block_query

## 1. otl.block_query

#### 功能说明

查询指定块的结构与内容，适合在更新前先读取目标块信息。



> 查询得到的块类型和属性具体含义可参考 `references/otl/node.md`

#### 调用示例

查询文档根块（获取文档完整内容）：

```json
{
  "file_id": "string",
  "params": {
    "blockIds": [
      "doc"
    ]
  }
}
```

查询指定块（blockId 来自查询文档根块的返回结果）：

```json
{
  "file_id": "string",
  "params": {
    "blockIds": [
      "目标blockId"
    ]
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 智能文档文件 ID
- `params` (object, 必填): 查询参数对象
  - `blockIds` (array, 常用): 要查询的块 ID 列表

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


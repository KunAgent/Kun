# otl.block_insert

## 1. otl.block_insert

#### 功能说明

向智能文档插入一个或多个块，适合在指定父块下按位置追加段落、列表、表格等结构化内容。



#### 操作约束

- **前置检查**：先 otl.block_query 了解文档块结构，确认插入位置
- **提示**：返回结果因内容和文档状态不同而异，以 code == 0 判断成功
- **提示**：待插入的节点类型和属性可参考 `references/otl/node.md`
- **提示**：当 blockId 为 `doc` 时，index 必须 >= 1，因为 doc 的首个子节点必须是 title（全局唯一）；正文开头插入应设 index 为 1
- **提示**：若查询到的块的 content 里包含 rangeMarkBegin 或 rangeMarkEnd，计算 index 时应忽略它们，它们是虚拟节点

**幂等性**：否 — 重复调用会插入重复内容，先确认是否已成功

#### 调用示例

在文档开头插入段落节点：

```json
{
  "file_id": "string",
  "params": {
    "blockId": "doc",
    "index": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "content": "一些文字"
          }
        ]
      }
    ]
  }
}
```

将段落的首个子节点后插入文本节点：

```json
{
  "file_id": "string",
  "params": {
    "blockId": "PARA_ID",
    "index": 1,
    "content": [
      {
        "type": "text",
        "content": "希望插入的文字"
      }
    ]
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 智能文档文件 ID
- `params` (object, 必填): 插入操作配置
  - `blockId` (string, 常用): 目标父块 ID，例如 `doc`
  - `index` (integer, 常用): 插入位置索引（从 0 开始）
  - `content` (array, 常用): 待插入的块内容数组

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


# otl.block_delete

## 1. otl.block_delete

#### 功能说明

删除一个或多个块区间，适合按父块和索引范围删除内容。



#### 操作约束

- **前置检查**：先 otl.block_query 确认待删除块的内容，避免误删
- **用户确认**：删除操作不可逆，执行前必须向用户确认删除范围
- **提示**：块类型和属性具体含义可参考 `references/otl/node.md`，删除前需先理解块结构以确认删除范围
- **提示**：若查询到的块的 content 里包含 rangeMarkBegin 或 rangeMarkEnd，计算 startIndex 和 endIndex 时应忽略它们，它们是虚拟节点

**幂等性**：否 — 删除后再次调用会报块不存在，先确认当前状态

#### 调用示例

清空文档标题：

```json
{
  "file_id": "string",
  "params": {
    "blockId": "doc",
    "startIndex": 0,
    "endIndex": 1
  }
}
```

删除文档正文首个块：

```json
{
  "file_id": "string",
  "params": {
    "blockId": "doc",
    "startIndex": 1,
    "endIndex": 2
  }
}
```

删除段落的首个子节点：

```json
{
  "file_id": "string",
  "params": {
    "blockId": "PARA_ID",
    "startIndex": 0,
    "endIndex": 1
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 智能文档文件 ID
- `params` (object, 必填): 删除操作配置
  - `blockId` (string, 常用): 目标父块 ID；`doc` 表示删除文档根节点的子节点
  - `startIndex` (integer, 常用): 删除开始位置（包含该位置），且 `startIndex < endIndex`
  - `endIndex` (integer, 常用): 删除结束位置（不包含该位置）。例如 `startIndex=2, endIndex=5` 时，会删除索引 2、3、4。当 `blockId='doc'` 时，`index=0` 指向 title 节点，正文从 `index=1` 开始

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


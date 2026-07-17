# otl.block_update

## 1. otl.block_update

#### 功能说明

更新指定块的内容或属性，支持多种操作：更新块内容、更新块属性、插入/删除表格行列、合并/拆分单元格。适合局部更新或处理 Markdown 数据不支持的内容。



#### 操作约束

- **前置检查**：先 otl.block_query 了解目标块结构，确认更新内容
- **用户确认**：当文档已有内容时，对 blockId=`doc` 执行 `update_content` 会覆盖全部标题和正文，执行前必须向用户确认
- **提示**：节点类型和属性定义可参考 `references/otl/node.md`
- **提示**：update_attrs 是覆盖操作，不需更新的属性需保持原样传入
- **提示**：当 blockId 为 `doc` 且 operation 为 `update_content` 时，content 的第一个子节点必须是 title；如仅需更新局部内容，应将 blockId 设为具体子块 ID
- **提示**：update_attrs 不支持 appComponent、lockBlock 两种块
- **提示**：表格操作中行/列数量需与表格结构对齐

**幂等性**：是

#### 调用示例

更新块内容（覆盖文档标题和正文）：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "update_content",
      "blockId": "doc",
      "content": [
        {
          "type": "title",
          "content": [
            {
              "type": "text",
              "content": "文档的标题"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "content": "文档的正文"
            }
          ]
        }
      ]
    }
  ]
}
```

更新段落的文本内容：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "update_content",
      "blockId": "PARA_ID",
      "content": [
        {
          "type": "text",
          "content": "更新后的文本内容"
        }
      ]
    }
  ]
}
```

更新高亮块的内容：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "update_content",
      "blockId": "HIGHLIGHT_BLOCK_ID",
      "content": [
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "content": "高亮块内更新后的文字"
            }
          ]
        }
      ]
    }
  ]
}
```

更新块属性（设置段落背景色）：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "update_attrs",
      "blockId": "PARA_ID",
      "attrs": {
        "color": {
          "backgroundColor": "#FBF5B3"
        }
      }
    }
  ]
}
```

插入表格行：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "insert_table_rows",
      "blockId": "TABLE_ID",
      "start": 0,
      "content": [
        {
          "type": "tableRow",
          "content": [
            {
              "type": "tableCell",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "content": "单元格内容"
                    }
                  ]
                }
              ]
            },
            {
              "type": "tableCell"
            }
          ]
        }
      ]
    }
  ]
}
```

删除表格行：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "delete_table_rows",
      "blockId": "TABLE_ID",
      "count": 2,
      "start": 0
    }
  ]
}
```

合并单元格：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "merge_table_cells",
      "blockId": "TABLE_ID",
      "rowSpan": 2,
      "colSpan": 3,
      "startRow": 0,
      "startCol": 0
    }
  ]
}
```

拆分单元格：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "split_table_cell",
      "blockId": "TABLE_ID",
      "startRow": 0,
      "startCol": 0
    }
  ]
}
```

设置文档封面图（sourceKey 通过 upload_attachment 获取）：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "update_attrs",
      "blockId": "doc",
      "attrs": {
        "cover": {
          "sourceKey": "1234567890",
          "offsetX": 0,
          "offsetY": 0
        }
      }
    }
  ]
}
```

清除文档封面图：

```json
{
  "file_id": "string",
  "params": [
    {
      "operation": "update_attrs",
      "blockId": "doc",
      "attrs": {
        "cover": {}
      }
    }
  ]
}
```


#### 参数说明

- `file_id` (string, 必填): 智能文档文件 ID
- `params` (array, 必填): 更新操作列表，每项为一个更新块对象。所有操作必须包含 `operation` 和 `blockId`，其余字段由 `operation` 决定，详见下方各操作说明
  - `operation` (string, 必填): 操作类型
  - `blockId` (string, 必填): 目标块 ID

**params 数组中每个操作项的公共必填字段：**
- `operation` (string, 必填): 操作类型，决定该项执行何种操作
- `blockId` (string, 必填): 目标块 ID

**各 operation 类型及其附加参数：**

**`update_content`** — 更新块的内容
- `operation`: "update_content"
- `blockId`: 目标块 ID；为 "doc" 时表示更新全文
- `content` (array, 必填): 新的子节点数组，节点类型参考 `references/otl/node.md`
- **当 blockId 为 "doc" 时，content 的第一个子节点必须是 type: title**，否则接口报错

**`update_attrs`** — 更新块的属性
- `operation`: "update_attrs"
- `blockId`: 目标块 ID
- `attrs` (object, 必填): 块属性对象，属性定义参考 `references/otl/node.md`
- 更新属性是覆盖操作，不需更新的属性需保持原样传入
- 不支持设置 appComponent、lockBlock 的属性；tableCell 的 colSpan/rowSpan 请用表格合并/拆分操作

**`insert_table_rows`** — 插入表格行（blockId 对应的块必须是 table）
- `operation`: "insert_table_rows"
- `blockId`: 表格块 ID
- `content` (array, 必填): tableRow 数组，单元格数量需与表格列数对齐
- `start` (integer, 可选): 插入位置行索引，默认 0

**`insert_table_columns`** — 插入表格列（blockId 对应的块必须是 table）
- `operation`: "insert_table_columns"
- `blockId`: 表格块 ID
- `content` (array, 必填): tableRow 数组，行数需与表格行数对齐，每行的单元格数量需一致
- `start` (integer, 可选): 插入位置列索引，默认 0

**`delete_table_rows`** — 删除表格行（blockId 对应的块必须是 table）
- `operation`: "delete_table_rows"
- `blockId`: 表格块 ID
- `count` (integer, 必填): 删除行数，至少为 1
- `start` (integer, 可选): 删除起始行索引，默认 0

**`delete_table_columns`** — 删除表格列（blockId 对应的块必须是 table）
- `operation`: "delete_table_columns"
- `blockId`: 表格块 ID
- `count` (integer, 必填): 删除列数，至少为 1
- `start` (integer, 可选): 删除起始列索引，默认 0

**`merge_table_cells`** — 合并单元格（blockId 对应的块必须是 table）
- `operation`: "merge_table_cells"
- `blockId`: 表格块 ID
- `rowSpan` (integer, 必填): 合并行数，至少为 1，与 colSpan 不可同时为 1
- `colSpan` (integer, 必填): 合并列数，至少为 1，与 rowSpan 不可同时为 1
- `startRow` (integer, 可选): 起始行号，默认 0
- `startCol` (integer, 可选): 起始列号，默认 0

**`split_table_cell`** — 拆分单元格（blockId 对应的块必须是 table，目标单元格必须是已合并的）
- `operation`: "split_table_cell"
- `blockId`: 表格块 ID
- `startRow` (integer, 可选): 目标单元格行号，默认 0
- `startCol` (integer, 可选): 目标单元格列号，默认 0


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


# 知识库空间 API 参考

本文件包含腾讯文档 MCP 知识库空间相关工具的 API 说明，包括空间管理和节点操作。

---

## 通用类型说明

### node_type 枚举值

| 值 | 说明 |
|---|---|
| wiki_folder | 文件夹 |
| wiki_tdoc | 在线文档（请求时使用） |
| wiki_file | 在线文档（返回值中使用） |
| link | 链接 |
| resource | 资源文件 |

### doc_type 枚举值

| 值 | 说明 |
|---|---|
| word | 文字处理文档 |
| excel | 电子表格 |
| form | 收集表 |
| slide | 幻灯片 |
| smartcanvas | 智能文档 |
| smartsheet | 智能表格 |
| mind | 思维导图 |
| flowchart | 流程图 |

### NodeInfo 节点信息结构

```json
{
  "node_id": "节点 ID，同时也是 file_id",
  "title": "节点标题",
  "node_type": "节点类型",
  "has_child": true,
  "doc_type": "文档类型（仅 wiki_file 有效）",
  "url": "访问链接"
}
```

### StringMatrix 表格数据结构

```json
{
  "texts": {
    "rows": [
      {"values": ["单元格1", "单元格2"]},
      {"values": ["单元格3", "单元格4"]}
    ]
  }
}
```

数据从 A1 单元格开始，按行列顺序填充。

---

## 工具列表

| 工具名称 | 功能说明 |
|---------|---------|
| query_space_list | 获取知识库空间列表 |
| create_space | 创建新的知识库空间 |
| query_space_node | 查询空间内节点列表 |
| create_space_node | 在空间中创建新节点（文件夹、文档或链接） |
| delete_space_node | 删除空间中的指定节点 |

---

## 工具详细说明

### 1. query_space_list

#### 功能说明
获取知识库空间列表，支持按不同方式排序和分页查询。

#### 调用示例
```json
{
  "num": 0,
  "order_by": 1,
  "query_by": 1,
  "descending": true
}
```

#### 参数说明
- `num` (uint32, 可选): 分页页码，从0开始，每页最多返回100个空间
- `order_by` (uint32, 可选): 排序方式（1-按最近预览时间排序，2-按最近编辑时间排序，3-按创建时间排序）
- `query_by` (uint32, 可选): 查询范围（0-查询全部空间（默认），1-仅查询我创建的空间，2-仅查询我加入的空间）
- `descending` (bool, 可选): 是否降序排列，true-降序（最新在前），false-升序，默认为true

#### 返回值说明
```json
{
  "spaces": [
    {
      "space_id": "space_1234567890",
      "title": "我的知识库",
      "description": "知识库描述",
      "is_top": false,
      "file_cnt": 10,
      "member_cnt": 5,
      "is_owner": true,
      "created_at": 1713600000,
      "updated_at": 1713600000
    }
  ],
  "has_next": false,
  "error": "",
  "trace_id": "trace_1234567890"
}
```

### 2. create_space

#### 功能说明
创建新的知识库空间。空间是组织和管理文档的容器，可以包含文件夹、文档等节点。

#### 调用示例
```json
{
  "title": "项目文档库",
  "description": "存放项目相关的所有文档"
}
```

#### 参数说明
- `title` (string, 必填): 空间标题
- `description` (string, 可选): 空间描述

#### 返回值说明
```json
{
  "space_id": "space_1234567890",
  "error": "",
  "trace_id": "trace_1234567890"
}
```

### 3. query_space_node

#### 功能说明
查询空间内的节点列表，支持按父节点分页查询。

#### 调用示例
```json
{
  "space_id": "space_1234567890",
  "parent_id": "folder_1234567890",
  "num": 0
}
```

#### 参数说明
- `space_id` (string, 必填): 空间ID，用于指定查询的空间
- `parent_id` (string, 可选): 父节点ID，为空时返回根节点
- `num` (uint32, 可选): 分页页码，从0开始，每页返回20个节点

#### 返回值说明
```json
{
  "children": [
    {
      "node_id": "doc_1234567890",
      "title": "项目文档",
      "node_type": "wiki_file",
      "has_child": false,
      "doc_type": "smartcanvas",
      "url": "https://docs.qq.com/doc/DV2h5cWJ0R1lQb0lH"
    }
  ],
  "error": "",
  "has_next": false,
  "trace_id": "trace_1234567890"
}
```

### 4. create_space_node

#### 功能说明
在空间中创建新节点（文件夹、文档或链接）。

#### 调用示例
```json
{
  "space_id": "space_1234567890",
  "parent_node_id": "folder_1234567890",
  "title": "新建页面文档1",
  "node_type": "wiki_tdoc",
  "wiki_tdoc_node": {
    "title": "新建页面文档",
    "doc_type": "smartcanvas"
  }
}
```

#### 参数说明
- `space_id` (string, 必填): 空间ID，用于指定在哪个空间下创建节点
- `parent_node_id` (string, 可选): 父节点ID，为空或在根目录创建时可不传
- `title` (string, 必填): 节点标题
- `node_type` (string, 必填): 节点类型（wiki_folder/wiki_tdoc/link）
- `is_before` (bool, 可选): 插入位置，true 表示插入到父节点子列表开头，false 表示插入到末尾
- `wiki_folder_node` (object, 可选): 文件夹节点配置，node_type 为 wiki_folder 时必填
- `wiki_tdoc_node` (object, 可选): 在线文档节点配置，node_type 为 wiki_tdoc 时必填
- `link_node` (object, 可选): 链接节点配置，node_type 为 link 时必填

#### 返回值说明
```json
{
  "node_info": {
    "node_id": "doc_1234567890",
    "title": "新建页面文档",
    "node_type": "wiki_file",
    "has_child": false,
    "doc_type": "smartcanvas",
    "url": "https://docs.qq.com/doc/DV2h5cWJ0R1lQb0lH"
  },
  "error": "",
  "trace_id": "trace_1234567890"
}
```

### 5. delete_space_node

#### 功能说明
删除空间中的指定节点。仅删除当前节点时，子节点自动挂载到上级节点；使用 `all` 模式时递归删除所有子节点（谨慎使用）。

#### 调用示例
```json
{
  "space_id": "space_1234567890",
  "node_id": "doc_1234567890",
  "remove_type": "current"
}
```

#### 参数说明
- `space_id` (string, 必填): 空间ID
- `node_id` (string, 必填): 要删除的节点ID
- `remove_type` (string, 可选): 删除类型，枚举值：`current`（默认，仅删除当前节点，子节点挂载到上级）、`all`（删除当前节点及所有子节点，⚠️ 谨慎使用）

#### 返回值说明
```json
{
  "error": "",
  "trace_id": "trace_1234567890"
}
```

---

## 典型工作流示例

### 组织文档到指定空间目录

```
1. 调用 query_space_list 获取空间列表，找到目标空间的 space_id
2. 调用 query_space_node 遍历空间节点，查找目标文件夹，获取 parent_node_id
3. 调用 create_space_node 在目标位置创建文档节点（doc_type 优先选择 smartcanvas）
   或调用 manage.create_file（传入 space_id 和 parent_id）在空间内创建文件，两者均可
```

### 查找空间中的文档

```
1. 调用 query_space_list 获取空间列表
2. 调用 query_space_node 遍历节点树查找文档
3. 从结果中获取 node_id（即 file_id）和 url
```

---

## 注意事项

- `node_id` 即 `file_id`：空间节点的 `node_id` 同时也是文档的 `file_id`
- 删除节点需谨慎：`delete_space_node` 默认仅删除当前节点（`remove_type=current`），使用 `all` 时会递归删除所有子节点
- 分页查询：`query_space_list` 每页 100 条，`query_space_node` 每页 20 条，使用 `has_next` 判断是否有更多数据，页码从 0 开始

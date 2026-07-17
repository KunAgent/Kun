# 腾讯文档 MCP 工具完整参考

本文件包含腾讯文档 MCP 中 文件管理类 相关工具的完整 API 说明、支持文件的增删改查、文件搜索、文件夹列表、文件夹信息查询、文档权限设置。

---
## 目录
- [文件夹操作](#文件夹操作)
  - [manage.folder_list](#managefolder_list)
  - [manage.query_folder_meta](#managequery_folder_meta)
- [文档创建操作](#文档创建操作)
  - [manage.create_file](#managecreate_file)
- [文档搜索操作](#文档搜索操作)
- [文档信息查询](#文档信息查询)
  - [manage.query_file_info](#managequery_file_info)
- [文档重命名](#文档重命名)
- [云文档最近浏览列表页查询](#云文档最近浏览列表页查询)
- [文档权限管理](#文档权限管理)
  - [manage.get_privilege](#manageget_privilege)
  - [manage.set_privilege](#manageset_privilege)
- [文档移动操作](#文档移动操作)
  - [manage.move_file](#managemove_file)
  - [manage.move_file_to_space](#managemove_file_to_space)
- [文档复制操作](#文档复制操作)
  - [manage.copy_file](#managecopy_file)
- [文档删除操作](#文档删除操作)
  - [manage.delete_file](#managedelete_file)
- [文档导入操作](#文档导入操作)
  - [manage.pre_import](#managepre_import)
  - [manage.async_import](#manageasync_import)
  - [manage.import_progress](#manageimport_progress)
- [文档导出操作](#文档导出操作)
  - [manage.export_file](#manageexport_file)
  - [manage.export_progress](#manageexport_progress)
- [典型工作流示例](#典型工作流示例)

---

## 文件夹操作

### manage.folder_list

**功能**：拉取指定目录下的文件与文件夹列表。

**使用场景**：
- 查看根目录或指定文件夹下的所有文件和子文件夹
- 在创建文档前先获取目标文件夹的 ID
- 浏览用户的云文档目录结构

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `folder_id` | string |  | 文件夹ID，默认为空，表示查询根目录下的文件 |
| `start` | integer |  | 查询记录的起始位置，默认为0 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `list[].id` | string | 文件/文件夹 ID |
| `list[].title` | string | 文件/文件夹标题 |
| `list[].url` | string | 文件链接 |
| `list[].is_folder` | boolean | 是否为文件夹，`true` 表示文件夹，`false` 表示文件 |
| `finish` | boolean | 列表分页是否查完，`false` 表示还有分页未查到，`true` 表示所有分页都查询完成 |

**调用示例（查询根目录）**：

```json
{}
```

**调用示例（查询指定文件夹）**：

```json
{
  "folder_id": "folder_abc123",
  "start": 0
}
```

**返回示例**：

```json
{
  "list": [
    {
      "id": "folder_001",
      "title": "项目文档",
      "url": "",
      "is_folder": true
    },
    {
      "id": "doc_001",
      "title": "会议纪要",
      "url": "https://docs.qq.com/doc/DV2h5cWJ0R1lQb0lH",
      "is_folder": false
    }
  ],
  "finish": false,
  "trace_id": "trace_xyz"
}
```

> **注意**：
> - 返回结果中 `is_folder=true` 的条目为文件夹，其 `id` 可作为 `folder_id` 继续查询子目录内容
> - 当 `finish=false` 时，需增大 `start` 参数值进行翻页查询

---

### manage.query_folder_meta

**功能**：查询指定文件夹的元信息（meta），支持根据 folderID 查询。

**使用场景**：
- 查询某个文件夹的详细信息（名称、创建时间等）
- 验证文件夹 ID 是否有效

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `folder_id` | string | ✅ | 文件夹ID |

**调用示例**：

```json
{
  "folder_id": "folder_abc123"
}
```

---

## 文档创建操作

### manage.create_file

**功能**：创建腾讯云文档，支持创建多种类型的文档。

**使用场景**：
- 在指定文件夹下创建新的在线文档（如文档、表格、幻灯片等）
- 传入 `space_id` 时，在知识库空间中创建文档节点（兼容 `create_space_node` 能力）

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `title` | string | ✅ | 文件标题，长度不超过36字符 |
| `file_type` | string | ✅ | 文件类型，详见下方取值说明 |
| `parent_id` | string |  | 父节点ID。不传 `space_id` 时表示个人文件夹唯一标识；传入 `space_id` 时表示空间父节点ID；为空则在个人首页或空间根路径创建 |
| `space_id` | string |  | 知识库空间ID，传入时在空间中创建节点，不传时在个人首页中创建文件 |
| `link_node` | object |  | 空间链接节点配置信息，`file_type` 为 `wikilink` 时必填，包含 `link_url`（必填）和 `link_description` |

**file_type 取值说明**：

| 值              | 含义     | 支持场景 |
|-----------------|----------|---------|
| `smartcanvas`   | 智能文档  | 个人首页 / 空间 |
| `doc`           | Word     | 个人首页 / 空间 |
| `sheet`         | 表格     | 个人首页 / 空间 |
| `form`          | 收集表   | 个人首页 / 空间 |
| `slide`         | 幻灯片   | 个人首页 / 空间 |
| `mind`          | 思维导图  | 个人首页 / 空间 |
| `flowchart`     | 流程图   | 个人首页 / 空间 |
| `smartsheet`    | 智能表格  | 个人首页 / 空间 |
| `folder`        | 文件夹   | 个人首页 / 空间 |
| `wikilink`      | 空间链接  | 仅空间（需传 `space_id`） |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `file_id` | string | 文件ID（文档ID、文件夹ID 或空间内节点ID） |
| `title` | string | 文件名称 |
| `url` | string | 文件链接 |
| `type` | string | 文件类型 |
| `space_id` | string | 空间ID，在空间内创建文件时返回 |
| `error` | string | 错误信息（如有） |

**调用示例**：

```json
{
  "title": "项目计划",
  "file_type": "doc"
}
```

**返回示例**：

```json
{
  "file_id": "doc_1234567890",
  "title": "项目计划",
  "url": "https://docs.qq.com/doc/DV2h5cWJ0R1lQb0lH",
  "type": "doc",
  "space_id": "",
  "error": "",
  "trace_id": "trace_xyz"
}
```

---

## 文档搜索操作

### manage.search_file

**功能**：根据关键词搜索云文档，返回匹配关键词的文档列表。

**使用场景**：
- 搜索文档标题包含"MCP"关键字的文档

**请求参数**：

| 参数 | 类型 | 必填 | 说明                                                   |
|------|------|-----|------------------------------------------------------|
| `search_key` | string | ✅ | 搜索关键字                                                |

**返回字段**：

| 字段             | 类型     | 说明       |
|----------------|--------|----------|
| `list[].file_id`    | string | 文档id     |
| `list[].title` | string | 文档标题     |
| `list[].url`   | string | 文档链接     |

**调用示例**：

```json
{
  "search_key": "MCP"
}
```

**返回示例**：

```json
{
  "list":[
    {
      "file_id": "sheet_1",
      "title": "sheet_name_1",
      "url": "https://docs.qq.com/sheet/sheet_file_id_1"
    },
    {
      "file_id": "sheet_2",
      "title": "sheet_name_2",
      "url": "https://docs.qq.com/sheet/sheet_file_id_2"
    }
  ],
  "trace_id": "trace_xyz"
}
```

---

## 文档信息查询

### manage.query_file_info

**功能**：查询在线腾讯文档基础信息，支持查询文档状态、文档创建人、创建时间、最后修改人、最后修改时间、文档 owner 等信息，支持判断是否为文件夹以及是否为空间内文件。

**使用场景**：
- 查询文档的基本元数据（类型、创建人、修改时间等）
- 判断某个 file_id 是否属于空间内文件（通过返回的 `space_id` 是否为空判断）
- 判断某个 file_id 是否为文件夹
- 在移动文件前查询目标节点的归属（首页 or 空间）

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 文档ID |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `file_id` | string | 文档ID |
| `title` | string | 文档名称 |
| `url` | string | 文档访问链接 |
| `type` | string | 文档类型，如 `doc`、`sheet`、`slide`、`smartcanvas`、`smartsheet`、`mind`、`flowchart` 等 |
| `status` | string | 文档状态 |
| `create_time` | uint64 | 文档创建时间，Unix 时间戳（秒） |
| `create_name` | string | 文档创建人名称 |
| `last_modify_time` | uint64 | 文档最后修改时间，Unix 时间戳（秒） |
| `last_modify_name` | string | 文档最后修改人名称 |
| `owner_name` | string | 文档 owner 的名称 |
| `space_id` | string | 空间ID，为空时表示首页文档，否则返回文档所在的空间ID |
| `is_folder` | boolean | 是否是文件夹 |

**调用示例**：

```json
{
  "file_id": "DtDywXFgYFru"
}
```

**返回示例**：

```json
{
  "file_id": "DtDywXFgYFru",
  "title": "项目计划",
  "url": "https://docs.qq.com/doc/DtDywXFgYFru",
  "type": "smartcanvas",
  "status": "normal",
  "create_time": 1713600000,
  "create_name": "张三",
  "last_modify_time": 1713686400,
  "last_modify_name": "李四",
  "owner_name": "张三",
  "space_id": "",
  "is_folder": false,
  "trace_id": "trace_xyz"
}
```

> **注意**：`space_id` 为空表示该文件在个人首页，不为空则表示该文件在对应空间内。此字段常用于判断移动文件时应调用 `manage.move_file`（首页）还是 `manage.move_file_to_space`（空间）。

---

## 文档重命名

### manage.rename_file_title

**功能**：根据云文档ID更新文档标题。

**使用场景**：
- 将文档(file_id)标题更新为"MCP重命名"

**请求参数**：

| 参数 | 类型 | 必填 | 说明                      |
|------|------|-----|-------------------------|
| `file_id` | string | ✅ | 文档ID                    |
| `title` | string | ✅ | 文档标题                    |

**返回字段**：

| 字段             | 类型     | 说明         |
|----------------|--------|------------|
| `file_id`      | string  | 文档ID       |
| `title`        | string  | 文档新标题      |

**调用示例**：

```json
{
  "file_id": "MCP",
  "title": "title"
}
```

**返回示例**：

```json
{
  "file_id": "MCP",
  "title": "new_title",
  "trace_id": "trace_xyz"
}
```

---

## 云文档最近浏览列表页查询

### manage.recent_online_file

**功能**：查询云文档最近浏览页文档列表

**使用场景**：
- 用户查询最近查看或者编辑过的文档列表

**请求参数**：

| 参数 | 类型 | 必填 | 说明             |
|------|------|-----|----------------|
| `num` | uint32 | ✅ | 当前查询页码数，从1开始   |
| `count` | uint32 |  | 分页条数，默认为100，每页最多查询的记录数量   |
| `order_by` | uint32 |  | 排序方式：0-按文档查看时间排序（默认），1-按文件修改时间排序，2-按文档名称排序   |

**返回字段**：

| 字段                  | 类型     | 说明   |
|---------------------|--------|------|
| `files[].file_id`   | string  | 文档ID |
| `files[].file_name` | string  | 文档标题 |
| `files[].file_url`  | string  | 文档链接 |

**调用示例**：

```json
{
  "num": "1"
}
```

**返回示例**：

```json
{
  "file":[
    {
      "file_id": "file_1",
      "file_name": "file_name_1",
      "file_url": "xxx"
    },
    {
      "file_id": "file_2",
      "file_name": "file_name_2",
      "file_url": "xxx"
    }
  ],
  "trace_id":"trace_abc"
}
```

---

## 文档权限管理

### manage.get_privilege

**功能**：根据文档ID或空间ID查询文档/空间权限策略。返回当前的权限设置，仅支持返回 0（私密文档）、1（部分成员可见）、2（所有人可读）、3（所有人可编辑）四种权限场景，其他权限类型暂不支持。

**使用场景**：
- 查看文档或空间当前的权限状态，决定是否需要调整
- 在设置权限前先查询当前状态，避免重复设置
- 确认文档/空间分享权限是否符合预期

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 文档ID 或 空间ID |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `file_id` | string | 文档ID |
| `policy` | uint32 | 权限策略，0-私密文档，1-部分成员可见，2-所有人可读，3-所有人可编辑 |

**policy 返回值说明**：

| 值 | 含义 | 说明 |
|----|------|------|
| 0 | 私密文档 | 仅文档所有者可访问 |
| 1 | 部分成员可见 | 仅指定的协作者可访问 |
| 2 | 所有人可读 | 任何获得链接的人都可以查看文档 |
| 3 | 所有人可编辑 | 任何获得链接的人都可以编辑文档 |

> ⚠️ **注意**：当前仅支持返回上述四种权限场景（0/1/2/3），如果文档设置了其他权限类型（如所有人可执行、所有人可标注等），将返回错误。

**调用示例**：

```json
{
  "file_id": "DtDywXFgYFru"
}
```

**返回示例**：

```json
{
  "file_id": "DtDywXFgYFru",
  "policy": 2
}
```

---

### manage.set_privilege

**功能**：根据文档ID或空间ID设置文档/空间权限。当前仅支持设置为所有人可读或所有人可编辑。

**使用场景**：
- 创建文档后设置为所有人可查看，方便团队成员浏览
- 设置文档为所有人可编辑，支持多人协作编辑
- 设置空间的全员访问权限

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 文档ID 或 空间ID |
| `policy` | uint32 | ✅ | 权限策略，2-所有人可读，3-所有人可编辑 |

**policy 取值说明**：

| 值 | 含义 | 说明 |
|----|------|------|
| 2 | 所有人可读 | 任何获得链接的人都可以查看文档 |
| 3 | 所有人可编辑 | 任何获得链接的人都可以编辑文档 |

> ⚠️ **注意**：目前仅支持 policy=2（所有人可读）和 policy=3（所有人可编辑）两种权限设置，其他权限值暂不支持。

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `trace_id` | string | 请求追踪ID |

**调用示例（设置所有人可读）**：

```json
{
  "file_id": "DtDywXFgYFru",
  "policy": 2
}
```

**调用示例（设置所有人可编辑）**：

```json
{
  "file_id": "DtDywXFgYFru",
  "policy": 3
}
```

**返回示例**：

```json
{
  "trace_id": "trace_xyz"
}
```

---

## 文档移动操作

### manage.move_file

**功能**：将文件移动到首页指定的文件夹下。

**使用场景**：
- 将文件移动到首页根目录
- 将文件移动到首页某个文件夹下

> ⚠️ **注意**：此工具仅适用于**首页**文件夹，若目标位置在空间内，请使用 `manage.move_file_to_space`。

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 文件ID |
| `target_folder_id` | string | ✅ | 移动的目标文件夹唯一标识，默认为 `/` 代表首页根目录 |

**调用示例**：

```json
{
  "file_id": "doc_abc123",
  "target_folder_id": "folder_xyz"
}
```

**返回示例**：

```json
{
  "trace_id": "trace_xyz"
}
```

---

### manage.move_file_to_space

**功能**：将文件移动到空间内指定节点下。

**使用场景**：
- 将首页文件移动到某个知识库空间
- 将文件移动到空间内的某个文件夹节点下

> ⚠️ **注意**：此工具仅适用于**空间**内的移动，若目标位置在首页，请使用 `manage.move_file`。

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 文件ID |
| `space_id` | string | ✅ | 移动的目标空间唯一标识 |
| `target_parent_id` | string |  | 移动的目标空间节点唯一标识，为空时代表空间根目录 |

**调用示例**：

```json
{
  "file_id": "doc_abc123",
  "space_id": "space_xyz",
  "target_parent_id": "node_parent_001"
}
```

**返回示例**：

```json
{
  "trace_id": "trace_xyz"
}
```

---

## 文档复制操作

### manage.copy_file

**功能**：为指定文档生成一个副本文档，副本文档的权限为仅我可查看。

**使用场景**：
- 基于现有文档创建副本，用于修改或备份
- 将文档复制到指定文件夹下

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 文档ID |
| `title` | string |  | 新文档标题，新文档标题长度不能超过36个字符 |
| `folder_id` | string |  | 新文档所在目录的唯一标识，默认为当前文件所在的文件夹 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 副本文档ID |
| `title` | string | 副本文档名称 |
| `url` | string | 副本文档链接 |

**调用示例（生成副本到当前目录）**：

```json
{
  "file_id": "DtDywXFgYFru"
}
```

**调用示例（生成副本到指定目录并重命名）**：

```json
{
  "file_id": "DtDywXFgYFru",
  "title": "项目计划-副本",
  "folder_id": "folder_abc123"
}
```

**返回示例**：

```json
{
  "id": "DtDywXFgYFru_copy",
  "title": "项目计划-副本",
  "url": "https://docs.qq.com/doc/DtDywXFgYFru_copy",
  "trace_id": "trace_xyz"
}
```

> **注意**：副本文档的权限默认为仅我可查看，如需开放权限请调用 `manage.set_privilege`。

---

## 文档删除操作

### manage.delete_file

**功能**：删除首页列表文件到回收站，或删除空间内的节点文件。

**使用场景**：
- 删除首页中的源文件、共享文件或浏览记录
- 删除空间内的节点（支持仅删除当前节点或递归删除所有子节点）

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 文件ID |
| `delete_type` | string |  | **仅对首页文件有效**，首页文件所属的列表类型：`origin`-源文件（默认），`recent`-浏览记录 |
| `remove_type` | string |  | **仅对空间节点有效**，空间节点删除类型：`current`（默认）仅删除当前节点，子节点自动挂载到上级节点；`all` 删除当前节点及其所有子节点（⚠️ 谨慎使用，会递归删除所有子节点） |

**delete_type 取值说明（首页文件）**：

| 值 | 含义 |
|----|------|
| `origin` | 源文件（默认） |
| `recent` | 浏览记录 |

**remove_type 取值说明（空间节点）**：

| 值 | 含义 |
|----|------|
| `current` | 仅删除当前节点，子节点自动挂载到上级节点（默认） |
| `all` | 删除当前节点及其所有子节点（⚠️ 谨慎使用） |

> ⚠️ **注意**：`delete_type` 和 `remove_type` 分别对应不同场景，首页文件使用 `delete_type`，空间节点使用 `remove_type`，两者不可混用。

**调用示例（删除首页源文件）**：

```json
{
  "file_id": "doc_abc123",
  "delete_type": "origin"
}
```

**调用示例（删除空间节点，仅删除当前节点）**：

```json
{
  "file_id": "node_abc123",
  "remove_type": "current"
}
```

**调用示例（删除空间节点及所有子节点）**：

```json
{
  "file_id": "node_abc123",
  "remove_type": "all"
}
```

**返回示例**：

```json
{
  "trace_id": "trace_xyz"
}
```

---

## 文档导入操作

### manage.pre_import

**功能**：预导入文档，传入文件名称、文件大小和MD5值，返回COS上传链接和file_key。客户端根据返回的COS上传链接将文件上传后，再调用 `manage.async_import` 触发导入。

**使用场景**：
- 导入大文件时，避免通过 Base64 传输超出长度限制
- 需要分步控制导入流程（预导入 → 上传 → 触发导入）

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_name` | string | ✅ | 文件名称（含后缀），如 `report.docx` |
| `file_size` | integer | ✅ | 文件大小，单位为字节(bytes)，如 `36752` |
| `file_md5` | string | ✅ | 文件的MD5哈希值，hex编码的32位小写字符串 |

**返回字段**：

| 字段 | 类型 | 说明                                          |
|------|------|---------------------------------------------|
| `upload_url` | string | COS上传链接，客户端需使用HTTP PUT方法将文件二进制内容上传到此URL     |
| `file_key` | string | 文件唯一标识，上传完成后调用 `manage.async_import` 时需传入此值 |
| `task_id` | string | 导入任务 ID，请使用 `manage.import_progress` 轮询导入进度 |
**调用示例**：

```json
{
  "file_name": "report.docx",
  "file_size": 36752,
  "file_md5": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
}
```

**返回示例**：

```json
{
  "upload_url": "https://cos.ap-guangzhou.myqcloud.com/import/...",
  "file_key": "import/abc123def456",
  "task_id": "drivetask_414b0637da6b4eb097acc6d43e337e1c"
}
```

---

### manage.async_import

**功能**：异步导入文档，传入`file_size`、`task_id`、`file_key`、`file_name`、`file_md5` 触发异步导入，返回 `task_id`。前置条件：需先调用 `manage.pre_import` 获取上传链接和 `file_key`，并将文件上传到COS后再调用此接口。

**使用场景**：
- 配合 `manage.pre_import` 完成两步导入

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_key` | string | ✅ | 文件唯一标识，由 `manage.pre_import` 返回 |
| `file_name` | string | ✅ | 文件名称（含后缀），需与 `pre_import` 时传入的一致 |
| `file_md5` | string | ✅ | 文件的MD5哈希值，需与 `pre_import` 时传入的一致 |
| `file_size` | integer | ✅ | 文件大小，单位为字节(bytes)，如 `36752` |
| `task_id` | string |  | 导入任务ID，由 `manage.pre_import` 返回 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 导入任务 ID，请使用 `manage.import_progress` 轮询导入进度 |

**调用示例**：

```json
{
  "file_key": "import/abc123def456",
  "file_name": "report.docx",
  "file_md5": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "file_size": 36752,
  "task_id": "drivetask_414b0637da6b4eb097acc6d43e337e1c"
}
```

**返回示例**：

```json
{
  "task_id": "144115210435508643_e52cf886-5eae-e61c-c828-a0dddb59703d",
}
```

---

### manage.import_progress

**功能**：根据导入任务 `task_id` 查询导入进度。每隔3-5秒轮询一次，当progress=100时表示导入完成，此时返回file_id和file_url。

**使用场景**：
- 调用 `manage.async_import` 后轮询查询导入状态
- 导入完成后获取生成的云文档 ID 和访问链接

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `task_id` | string | ✅ | 导入任务 ID（由 `manage.async_import` 返回） |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `progress` | integer | 导入进度百分比（0-100） |
| `status` | string | 任务状态 |
| `file_id` | string | 导入完成后的云文档 ID |
| `file_name` | string | 文档名称 |
| `file_url` | string | 文档访问链接 |
| `error` | string | 错误信息（失败时返回） |

**调用示例**：

```json
{
  "task_id": "drivetask_414b0637da6b4eb097acc6d43e337e1c"
}
```

**返回示例（进行中）**：

```json
{
  "progress": 25,
  "trace_id": "trace_xyz"
}
```

**返回示例（完成）**：

```json
{
  "progress": 100,
  "file_id": "DjVlDHwqVVzs",
  "file_name": "report",
  "file_url": "https://docs.qq.com/doc/DRGpWbERId3FWVnpz",
  "trace_id": "trace_xyz"
}
```

---

## 文档导出操作

### manage.export_file

**功能**：根据云文档 ID 发起导出任务，返回导出任务 ID。需配合 `manage.export_progress` 轮询查询导出进度（建议间隔3-5秒），导出完成后获取file_url下载链接（带签名的临时URL，有效期约30分钟）。

**使用场景**：
- 将云端在线文档导出为本地 docx/xlsx/pptx 文件
- 备份云文档到本地

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `file_id` | string | ✅ | 云文档 ID |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 导出任务 ID，用于查询导出进度 |

**调用示例**：

```json
{
  "file_id": "DAJpzYoLEpWS"
}
```

**返回示例**：

```json
{
  "task_id": "144115210435508643_0e15f9be-a2ed-b40a-27c2-10561b7c5072",
  "trace_id": "trace_xyz"
}
```

---

### manage.export_progress

**功能**：根据导出任务 `task_id` 查询导出进度。每隔3-5秒轮询一次，当progress=100时表示导出完成，此时返回file_url（带签名的临时下载链接，有效期约30分钟）。

**使用场景**：
- 调用 `manage.export_file` 后轮询查询导出状态
- 导出完成后获取文件下载 URL，通过 curl 等工具下载到本地

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `task_id` | string | ✅ | 导出任务 ID（由 `manage.export_file` 返回） |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `progress` | integer | 导出进度百分比（0-100），100表示导出完成 |
| `status` | string | 任务状态 |
| `file_name` | string | 导出的文件名 |
| `file_url` | string | 文件下载链接（导出完成后返回，带签名的临时URL，有效期约30分钟） |
| `error` | string | 错误信息（失败时返回） |

**调用示例**：

```json
{
  "task_id": "144115210435508643_0e15f9be-a2ed-b40a-27c2-10561b7c5072"
}
```

**返回示例（进行中）**：

```json
{
  "progress": 50,
  "trace_id": "trace_xyz"
}
```

**返回示例（完成）**：

```json
{
  "progress": 100,
  "file_name": "mcp_import.docx",
  "file_url": "https://docs-import-export-xxx.cos.ap-guangzhou.myqcloud.com/export/docx/...",
  "trace_id": "trace_xyz"
}
```

> **注意**：`file_url` 为带签名的临时下载链接，有效期约 30 分钟，需及时下载。可通过 `curl -L -o <本地路径> "<file_url>"` 命令保存到本地。

---

## 典型工作流示例

### 工作流一：从零在指定目录下创建指定品类文档

```
步骤 1：获取文件夹列表
 → manage.folder_list（判断is_folder=true后获取文件夹id）

步骤 2：创建指定品类文档
 → manage.create_file（传入文件夹id和品类枚举）
```

### 工作流二：按照关键字搜索文件列表

```
步骤 1：搜索文档
 → manage.search_file（传入用户指定的关键词）

步骤 2：处理数据
 → 从返回的文档列表中获取所需的文档信息
 
```

### 工作流三：给指定文档生成副本到指定目录

```
步骤 1：获取文件夹列表
 → manage.folder_list（判断is_folder=true后获取文件夹ID）

步骤 2：按照指定文档ID生成副本
 → manage.copy_file（传入文件夹ID和待生成副本的文档ID）

 
```

### 工作流四：根据关键词搜索后删除文档

```
步骤 1：搜索文档
 → manage.search_file（传入用户指定的关键词，获取文档id）

步骤 2：删除文档
  → manage.delete_file（传入指定的file_id）
 
```

### 工作流五：将本地文件导入为云文档

> **推荐方式**：执行 `import_file.sh` 脚本，自动完成 MD5 计算、调用 `manage.pre_import` 获取上传链接、上传文件到 COS 三步，输出结果后直接调用 `manage.async_import` 触发导入。

```
步骤 1：使用脚本完成预导入和上传（推荐）
 → 执行 bash import_file.sh <文件路径>
 → 脚本自动：计算文件 MD5 和大小 → 调用 manage.pre_import 获取上传链接 → curl 上传文件到 COS
 → 成功后输出 FILE_KEY、FILE_NAME、FILE_MD5、TASK_ID

步骤 2：调用异步导入接口
 → manage.async_import（传入 task_id、file_size、file_key、file_name、file_md5）
 → 返回 task_id

步骤 3：轮询查询导入进度
 → manage.import_progress（传入 task_id）
 → 每隔 3-5 秒轮询一次，直到 progress=100 或返回错误
 → 导入完成后获取 file_id 和 file_url
```

**手动分步执行（不使用脚本）**：
```
步骤 1：计算文件信息
 → 使用 md5sum/md5 计算文件 MD5
 → 使用 stat 获取文件大小（字节）

步骤 2：调用预导入接口
 → manage.pre_import（传入 file_name、file_size、file_md5）
 → 返回 upload_url、file_key 和 task_id

步骤 3：上传文件到 COS
 → curl -X PUT -H "Content-Type: application/octet-stream" --data-binary "@<文件路径>" "<upload_url>"

步骤 4：触发异步导入
 → manage.async_import（传入 task_id、file_size、file_key、file_name、file_md5）
 → 返回 task_id

步骤 5：轮询查询导入进度
 → manage.import_progress（传入 task_id）
 → 每隔 3-5 秒轮询一次，直到 progress=100
```

### 工作流六：将云文档导出到本地

```
步骤 1：发起导出任务
 → manage.export_file（传入 file_id）
 → 返回 task_id

步骤 2：轮询查询导出进度
 → manage.export_progress（传入 task_id）
 → 每隔 3-5 秒轮询一次，直到 progress=100 或返回错误
 → 导出完成后获取 file_url（临时下载链接）

步骤 3：下载文件到本地
 → 使用 curl 或其他 HTTP 工具下载文件
 → curl -L -o <本地保存路径> "<file_url>"
```

> **注意事项**：
> - 导出的下载链接（file_url）为带签名的临时 URL，有效期约 30 分钟，需及时下载
> - 导出的文件格式取决于原始文档类型（doc→docx，sheet→xlsx，slide→pptx 等）

### 工作流七：导入本地文件后再导出验证（完整闭环）

```
步骤 1：导入本地文件
 → 按工作流五（推荐两步导入方式）执行导入操作
 → 记录返回的 file_id

步骤 2：导出刚导入的文件
 → manage.export_file（传入步骤 1 返回的 file_id）
 → 返回 task_id

步骤 3：轮询导出进度并下载
 → manage.export_progress（传入 task_id）
 → 导出完成后通过 file_url 下载到本地

步骤 4：验证文件完整性
 → 对比原文件与导出文件的大小（可能有微小差异，属正常现象）
 → 导入导出过程中腾讯文档会对文件内部 XML 结构做标准化处理
```

### 工作流八：创建文档并设置分享权限

```
步骤 1：创建文档
 → create_smartcanvas_by_markdown（传入标题和Markdown内容）
 → 返回 file_id 和 url

步骤 2：设置文档权限
 → manage.set_privilege（传入 file_id 和 policy）
 → policy=2 设置所有人可读，policy=3 设置所有人可编辑

步骤 3：分享文档链接
 → 将步骤 1 返回的 url 分享给相关人员
```

### 工作流九：查询文档权限后按需调整

```
步骤 1：查询文档当前权限
 → manage.get_privilege（传入 file_id）
 → 返回 policy：0-私密文档、1-部分成员可见、2-所有人可读、3-所有人可编辑

步骤 2：根据需要调整权限
 → 如果 policy 不符合预期，调用 manage.set_privilege（传入 file_id 和目标 policy）
 → policy=2 设置所有人可读，policy=3 设置所有人可编辑
```

### 工作流十：移动文件

移动文件有两个 tool，根据**目标位置**选择：

| 目标位置 | 使用 tool |
|---------|----------|
| 移动到**首页**文件夹 | `manage.move_file` |
| 移动到**空间**内 | `manage.move_file_to_space` |

**完整步骤：**

```
步骤 1：判断用户是否指定了目标地址（target_folder_id）

  target_folder_id 为空？
    → 直接调用 manage.move_file（不传 target_folder_id，移动到首页根目录）
    → 结束

  target_folder_id 不为空？
    → 继续步骤 2

步骤 2：查询目标地址信息，判断目标是首页还是空间
  → manage.query_file_info（传入 target_folder_id）
  → 获取返回值中的 space_id 字段：
    - space_id 不为空 → 目标在空间内，走步骤 3（移动到空间）
    - space_id 为空   → 目标在首页，走步骤 4（移动到首页）

步骤 3：移动到空间
  → manage.move_file_to_space（传入 file_id、space_id 和 target_parent_id=target_folder_id）

步骤 4：移动到首页
  → manage.move_file（传入 file_id 和 target_folder_id）
```

> ⚠️ **注意**：不支持将空间（space）本身移动，仅支持空间内的文件/文件夹节点。
# 智能表格（SmartSheet）工具完整参考文档

腾讯文档智能表格（SmartSheet）提供了一套完整的表格操作 API，支持对工作表、视图、字段、记录进行增删改查操作。

---

## 目录

- [概念说明](#概念说明)
- [工作表（SubSheet）操作](#工作表subsheet操作)
  - [smartsheet.list_tables - 列出工作表](#smartsheetlist_tables)
  - [smartsheet.add_table - 新增工作表](#smartsheetadd_table)
  - [smartsheet.delete_table - 删除工作表](#smartsheetdelete_table)
- [视图（View）操作](#视图view操作)
  - [smartsheet.list_views - 列出视图](#smartsheetlist_views)
  - [smartsheet.add_view - 新增视图](#smartsheetadd_view)
  - [smartsheet.delete_view - 删除视图](#smartsheetdelete_view)
- [字段（Field）操作](#字段field操作)
  - [smartsheet.list_fields - 列出字段](#smartsheetlist_fields)
  - [smartsheet.add_fields - 新增字段](#smartsheetadd_fields)
  - [smartsheet.update_fields - 更新字段](#smartsheetupdate_fields)
  - [smartsheet.delete_fields - 删除字段](#smartsheetdelete_fields)
- [记录（Record）操作](#记录record操作)
  - [smartsheet.list_records - 列出记录](#smartsheetlist_records)
  - [smartsheet.add_records - 新增记录](#smartsheetadd_records)
  - [smartsheet.update_records - 更新记录](#smartsheetupdate_records)
  - [smartsheet.delete_records - 删除记录](#smartsheetdelete_records)
- [枚举值参考](#枚举值参考)
- [字段值格式参考](#字段值格式参考)
- [典型工作流示例](#典型工作流示例)

---

## 概念说明

| 概念 | 说明 |
|------|------|
| `file_id` | 智能表格文档的唯一标识符，每个文档有唯一的 file_id |
| `sheet_id` | 工作表 ID，一个智能表格文档可包含多个工作表 |
| `view_id` | 视图 ID，每个工作表可有多个视图（网格视图、看板视图等） |
| `field_id` | 字段 ID，对应表格的列 |
| `record_id` | 记录 ID，对应表格的行 |

**层级关系**：`file_id（文档）` → `sheet_id（工作表）` → `view_id（视图）` / `field_id（字段）` / `record_id（记录）`

---

## 工作表（SubSheet）操作

### smartsheet.list_tables

**功能**：列出文档下的所有工作表，返回工作表基本信息列表。

**使用场景**：
- 查看一个智能表格文档中有哪些工作表
- 获取 sheet_id 以便后续操作字段、记录、视图

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |

**返回字段**：

| 字段                    | 类型 | 说明 |
|-----------------------|------|------|
| `sheets`              | array | 工作表列表 |
| `sheets[].sheet_id`   | string | 工作表唯一标识符 |
| `sheets[].title`      | string | 工作表名称 |
| `sheets[].is_visible` | bool | 工作表可见性 |
| `error`               | string | 错误信息，操作失败时返回 |
| `trace_id`            | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id"
}
```

**返回示例**：

```json
{
  "sheets": [
    {
      "sheet_id": "sheet_abc123",
      "title": "任务列表",
      "is_visible": true
    },
    {
      "sheet_id": "sheet_def456",
      "title": "已归档",
      "is_visible": false
    }
  ],
  "error": "",
  "trace_id": "trace_xyz"
}
```

---

### smartsheet.add_table

**功能**：在文档中新增工作表，支持设置工作表名称和初始配置。

**使用场景**：
- 在已有智能表格文档中添加新的工作表（如新增"2024年Q2"工作表）
- 按业务模块拆分数据到不同工作表

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `properties` | object | ✅ | 工作表属性配置 |
| `properties.sheet_id` | string | ✅ | 工作表名称（注意：此字段实际含义为工作表名称） |
| `properties.title` | string | | 工作表标题 |
| `properties.index` | uint32 | | 工作表下标（位置） |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `properties` | object | 新创建工作表的属性信息 |
| `properties.sheet_id` | string | 工作表名称 |
| `properties.title` | string | 工作表标题 |
| `properties.index` | uint32 | 工作表下标 |
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "properties": {
    "sheet_id": "新工作表",
    "title": "2024年Q2数据",
    "index": 1
  }
}
```

---

### smartsheet.delete_table

**功能**：删除指定的工作表。

**使用场景**：
- 删除不再需要的工作表
- 清理测试数据工作表

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 要删除的工作表 ID |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `error` | string | 错误信息，操作失败时返回 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123"
}
```

---

## 视图（View）操作

### smartsheet.list_views

**功能**：列出工作表下的所有视图，返回视图基本信息和配置。

**使用场景**：
- 查看工作表有哪些视图（网格视图、看板视图）
- 获取 view_id 以便按视图筛选记录或字段

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `view_ids` | []string | | 需要查询的视图 ID 数组，不填则返回全部 |
| `offset` | uint32 | | 分页查询偏移量，默认 0 |
| `limit` | uint32 | | 分页大小，最大 100 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `views` | array | 视图列表 |
| `views[].view_id` | string | 视图唯一标识符 |
| `views[].view_name` | string | 视图名称 |
| `views[].view_type` | string | 视图类型，枚举值见下方 |
| `total` | uint32 | 符合条件的视图总数 |
| `hasMore` | bool | 是否还有更多项 |
| `next` | uint32 | 下一页偏移量 |
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**视图类型枚举值**：

| 值 | 说明 |
|----|------|
| `grid` | 网格视图 |
| `kanban` | 看板视图 |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "offset": 0,
  "limit": 20
}
```

---

### smartsheet.add_view

**功能**：在工作表中新增视图，支持自定义视图名称和类型。

**使用场景**：
- 为工作表创建看板视图，按状态分组展示任务
- 创建多个网格视图，分别展示不同筛选条件的数据

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `view_title` | string | ✅ | 视图标题 |
| `view_type` | string | | 视图类型：grid-网格视图，kanban-看板视图 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `view_id` | string | 新创建的视图 ID |
| `view_title` | string | 视图标题 |
| `view_type` | string | 视图类型 |
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "view_title": "按状态分组",
  "view_type": "kanban"
}
```

---

### smartsheet.delete_view

**功能**：删除指定的视图，支持批量删除多个视图。

**使用场景**：
- 删除不再使用的视图
- 批量清理多余视图

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `view_ids` | []string | ✅ | 要删除的视图 ID 列表 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "view_ids": ["view_id1", "view_id2"]
}
```

---

## 字段（Field）操作

### smartsheet.list_fields

**功能**：列出工作表的所有字段，返回字段基本信息和类型配置。

**使用场景**：
- 查看工作表有哪些列（字段）及其类型
- 获取 field_id 以便后续更新或删除字段
- 在写入记录前，先了解字段结构和类型

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `view_id` | string | | 视图 ID，按视图筛选字段 |
| `field_ids` | []string | | 指定字段 ID 数组 |
| `field_titles` | []string | | 指定字段标题数组 |
| `offset` | uint32 | | 偏移量，初始值为 0 |
| `limit` | uint32 | | 分页大小，最大 100；不填或为 0 时，总数 >100 返回 100 条，否则返回全部 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `total` | uint32 | 符合条件的字段总数 |
| `has_more` | bool | 是否还有更多项 |
| `next` | uint32 | 下一页偏移量 |
| `fields` | array | 字段列表，详见 FieldInfo 结构 |

**FieldInfo 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `field_id` | string | 字段唯一 ID |
| `field_title` | string | 字段标题（列名） |
| `field_type` | string | 字段类型，枚举值见下方 |
| `property_*` | object | 字段属性，根据 field_type 不同而不同 |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123"
}
```

---

### smartsheet.add_fields

**功能**：批量新增字段（列），支持同时添加多个不同类型的字段。

**使用场景**：
- 为工作表添加新列，如"优先级"（单选）、"截止日期"（日期）、"负责人"（用户）
- 初始化工作表结构

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `fields` | []FieldInfo | ✅ | 要添加的字段列表 |

**FieldInfo 参数说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `field_title` | string | ✅ | 字段标题（列名） |
| `field_type` | string | ✅ | 字段类型，枚举值见下方 |
| `property_text` | object | | 文本类型属性（无需额外配置） |
| `property_number` | object | | 数字类型属性 |
| `property_checkbox` | object | | 复选框类型属性 |
| `property_date_time` | object | | 日期时间类型属性 |
| `property_url` | object | | 超链接类型属性 |
| `property_select` | object | | 多选类型属性 |
| `property_single_select` | object | | 单选类型属性 |
| `property_progress` | object | | 进度类型属性 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fields` | array | 添加成功的字段列表（含 field_id） |
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例（添加多种类型字段）**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "fields": [
      {
        "field_title": "任务名称",
        "field_type": "text",
        "property_text": {}
      },
      {
        "field_title": "优先级",
        "field_type": "singleSelect",
        "property_single_select": {
          "options": [
            { "text": "高", "style": 1 },
            { "text": "中", "style": 3 },
            { "text": "低", "style": 4 }
          ]
        }
      },
      {
        "field_title": "截止日期",
        "field_type": "dateTime",
        "property_date_time": {
          "format": "yyyy-mm-dd",
          "auto_fill": false
        }
      },
      {
        "field_title": "完成进度",
        "field_type": "progress",
        "property_progress": {
          "decimal_places": 0
        }
      },
      {
        "field_title": "是否完成",
        "field_type": "checkbox",
        "property_checkbox": {
          "checked": false
        }
      }
    ]
}
```

---

### smartsheet.update_fields

**功能**：批量更新字段属性，支持修改字段名称和配置信息。

**使用场景**：
- 修改字段标题（列名）
- 更新单选/多选字段的选项列表
- 修改数字字段的精度配置

> ⚠️ **注意**：`field_type`（字段类型）不允许被更新，但更新时必须传入原字段类型值。

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `fields` | []FieldInfo | ✅ | 要更新的字段列表，必须包含 field_id |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fields` | array | 更新成功的字段列表 |
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例（修改字段标题和选项）**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "fields": [
      {
        "field_id": "field_id_001",
        "field_title": "任务状态",
        "field_type": "singleSelect",
        "property_single_select": {
          "options": [
            { "text": "待处理", "style": 7 },
            { "text": "进行中", "style": 3 },
            { "text": "已完成", "style": 4 },
            { "text": "已取消", "style": 1 }
          ]
        }
      }
    ]
}
```

---

### smartsheet.delete_fields

**功能**：批量删除字段（列），支持同时删除多个字段。

**使用场景**：
- 删除不再需要的列
- 清理冗余字段

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `field_ids` | []string | ✅ | 要删除的字段 ID 数组 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "field_ids": ["field_id_001", "field_id_002"]
}
```

---

## 记录（Record）操作

### smartsheet.list_records

**功能**：分页列出工作表记录（行），支持排序和按字段筛选。

**使用场景**：
- 读取工作表中的数据
- 按特定字段排序查看数据
- 分页获取大量数据

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `view_id` | string | | 视图 ID，按视图筛选记录 |
| `record_ids` | []string | | 指定记录 ID 数组，精确查询 |
| `field_titles` | []string | | 只返回指定字段标题的值，不填则返回全部字段 |
| `sort` | []Sort | | 排序配置 |
| `offset` | uint32 | | 偏移量，初始值为 0 |
| `limit` | uint32 | | 分页大小，最大 100；不填或为 0 时，总数 >100 返回 100 条，否则返回全部 |

**Sort 排序配置**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `field_title` | string | ✅ | 需要排序的字段标题 |
| `desc` | bool | | 是否降序，默认 false（升序） |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `total` | uint32 | 符合条件的记录总数 |
| `has_more` | bool | 是否还有更多项 |
| `next` | uint32 | 下一页偏移量 |
| `records` | array | 记录列表，详见 RecordInfo 结构 |
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**RecordInfo 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `record_id` | string | 记录唯一 ID |
| `field_values` | array | 字段值列表，每个元素为 FieldValueEntry，包含 `field`（字段标题）和对应的值（oneof） |

**FieldValueEntry 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `field` | string | 字段标题（必填） |
| `number_value` | double | 数字类型的值，用于数字、进度、货币、百分数等字段 |
| `string_value` | string | 字符串类型的值，用于日期(毫秒级unix时间戳)、电话、邮箱等字段 |
| `bool_value` | bool | 布尔类型的值，用于复选框字段 |
| `text_value` | TextValueList | 文本类型的值列表，用于文本字段 |
| `url_value` | UrlValueList | 超链接类型的值列表，用于超链接字段 |
| `option_value` | OptionValueList | 选项类型的值列表，用于多选、单选字段 |
| `image_value` | ImageIDValueList | 图片类型的值列表，用于图片字段 |
| `auto_number_value` | AutoNumberValue | 自动编号类型的值，用于自动编号字段 |
| `reference_value` | StringValueList | 关联记录ID列表，用于关联字段 |

> ⚠️ **注意**：`field` 之外的值字段为 oneof 关系，每个 FieldValueEntry 只能设置其中一个值字段。

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "field_titles": ["任务名称", "优先级", "截止日期"],
  "sort": [
    { "field_title": "截止日期", "desc": false }
  ],
  "offset": 0,
  "limit": 50
}
```

---

### smartsheet.add_records

**功能**：批量添加记录（行），支持同时添加多条记录数据。

**使用场景**：
- 批量导入数据到工作表
- 添加新任务、新条目
- 从其他数据源同步数据

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `records` | []AddRecord | ✅ | 要添加的记录列表 |

**AddRecord 结构**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `field_values` | []FieldValueEntry | ✅ | 字段值列表，每个元素包含 `field`（字段标题）和对应的值（oneof），格式见下方 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `records` | array | 添加成功的记录列表（含 record_id） |
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "records": [
      {
        "field_values": [
          {"field": "任务名称", "text_value": {"items": [{"text": "完成需求文档", "type": "text"}]}},
          {"field": "优先级", "option_value": {"items": [{"text": "高"}]}},
          {"field": "截止日期", "string_value": "1720000000000"},
          {"field": "完成进度", "number_value": 30},
          {"field": "是否完成", "bool_value": false}
        ]
      },
      {
        "field_values": [
          {"field": "任务名称", "text_value": {"items": [{"text": "代码评审", "type": "text"}]}},
          {"field": "优先级", "option_value": {"items": [{"text": "中"}]}},
          {"field": "截止日期", "string_value": "1720086400000"},
          {"field": "完成进度", "number_value": 0},
          {"field": "是否完成", "bool_value": false}
        ]
      }
    ]
}
```

---

### smartsheet.update_records

**功能**：批量更新记录，支持修改多条记录的字段值。

**使用场景**：
- 更新任务状态、进度
- 修改记录中的某些字段值
- 批量修改多条数据

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `records` | []RecordInfo | ✅ | 要更新的记录列表，必须包含 record_id |

**RecordInfo 参数说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `record_id` | string | ✅ | 记录 ID，标识要更新哪条记录 |
| `field_values` | []FieldValueEntry | ✅ | 要更新的字段值列表，每个元素包含 `field`（字段标题）和对应的值 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "records": [
      {
        "record_id": "record_id_001",
        "field_values": [
          {"field": "完成进度", "number_value": 100},
          {"field": "是否完成", "bool_value": true},
          {"field": "优先级", "option_value": {"items": [{"text": "高"}]}}
        ]
      }
    ]
}
```

---

### smartsheet.delete_records

**功能**：批量删除记录（行），支持同时删除多条指定的记录。

**使用场景**：
- 删除已完成或过期的任务记录
- 清理测试数据
- 批量删除多条记录

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | ✅ | 智能表格文档的唯一标识符 |
| `sheet_id` | string | ✅ | 工作表 ID |
| `record_ids` | []string | ✅ | 要删除的记录 ID 列表 |

**返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `error` | string | 错误信息 |
| `trace_id` | string | 调用链追踪 ID |

**调用示例**：

```json
{
  "file_id": "your_file_id",
  "sheet_id": "sheet_abc123",
  "record_ids": ["record_id_001", "record_id_002", "record_id_003"]
}
```

---

## 枚举值参考

### 字段类型（field_type）

| 枚举值 | 类型名称 | 对应 property 字段 | 说明 |
|--------|---------|-------------------|------|
| `text` | 文本 | `property_text` | 普通文本，无需额外配置 |
| `number` | 数字 | `property_number` | 整数或浮点数 |
| `checkbox` | 复选框 | `property_checkbox` | 布尔值 true/false |
| `dateTime` | 日期 | `property_date_time` | 毫秒时间戳字符串 |
| `image` | 图片 | `property_image` | 图片 ID 数组 |
| `url` | 超链接 | `property_url` | URL 数组 |
| `select` | 多选 | `property_select` | 选项数组（可多选） |
| `createdUser` | 创建人 | `property_user` | 系统自动填充，无需配置 |
| `modifiedUser` | 最后编辑人 | `property_modified_user` | 系统自动填充，无需配置 |
| `createdTime` | 创建时间 | `property_created_time` | 系统自动填充，无需配置 |
| `modifiedTime` | 最后编辑时间 | `property_modified_time` | 系统自动填充，无需配置 |
| `progress` | 进度 | `property_progress` | 整数或浮点数（百分比） |
| `phoneNumber` | 电话 | `property_phone_number` | 字符串，无需额外配置 |
| `email` | 邮件 | `property_email` | 字符串，无需额外配置 |
| `singleSelect` | 单选 | `property_single_select` | 选项数组（只能单选） |
| `reference` | 关联 | - | 关联其他记录，值为 record_id 字符串数组 |
| `autoNumber` | 自动编号 | - | 系统自动生成编号，无需手动配置 |
| `currency` | 货币 | - | 浮点数，表示货币金额 |
| `percentage` | 百分比 | - | 浮点数，如 0.75 表示 75% |

### 视图类型（view_type）

| 枚举值 | 说明 |
|--------|------|
| `grid` | 网格视图 - 传统表格形式 |
| `kanban` | 看板视图 - 按列分组展示 |

### 选项颜色（style）

| 枚举值 | 颜色 |
|--------|------|
| `1` | 红色 |
| `2` | 橘黄色 |
| `3` | 蓝色 |
| `4` | 绿色 |
| `5` | 紫色 |
| `6` | 粉色 |
| `7` | 灰色 |
| `8` | 白色 |

### 超链接展示样式（UrlFieldProperty.type）

| 枚举值 | 说明 |
|--------|------|
| `0` | 未知 |
| `1` | 文字 |
| `2` | 图标文字 |

---

## 字段值格式参考

在 `add_records` 和 `update_records` 中，`field_values` 是一个 `FieldValueEntry` 数组，每个元素包含 `field`（字段标题）和一个 oneof 值字段。根据字段类型选择对应的值字段：

| 字段类型 | 使用的 oneof 值字段 | 示例 |
|---------|-------------------|------|
| 文本（text） | `text_value` | `{"field": "标题", "text_value": {"items": [{"text": "内容", "type": "text"}]}}` |
| 数字（number） | `number_value` | `{"field": "数量", "number_value": 42}` |
| 复选框（checkbox） | `bool_value` | `{"field": "已完成", "bool_value": true}` |
| 日期（dateTime） | `string_value` | `{"field": "日期", "string_value": "1720000000000"}` |
| 图片（image） | `image_value` | `{"field": "封面", "image_value": {"items": [{"image_id": "图片id"}]}}` |
| 超链接（url） | `url_value` | `{"field": "链接", "url_value": {"items": [{"text": "链接文字", "type": "url", "link": "https://..."}]}}` |
| 多选（select） | `option_value` | `{"field": "标签", "option_value": {"items": [{"text": "选项1"}, {"text": "选项2"}]}}` |
| 进度（progress） | `number_value` | `{"field": "进度", "number_value": 75}` |
| 电话（phoneNumber） | `string_value` | `{"field": "电话", "string_value": "13800138000"}` |
| 邮件（email） | `string_value` | `{"field": "邮箱", "string_value": "user@example.com"}` |
| 单选（singleSelect） | `option_value` | `{"field": "状态", "option_value": {"items": [{"text": "选项文字"}]}}` |
| 关联（reference） | `reference_value` | `{"field": "关联", "reference_value": {"items": ["record_id_1", "record_id_2"]}}` |
| 自动编号（autoNumber） | `auto_number_value` | `{"field": "编号", "auto_number_value": {"seq": "1", "text": "编号内容"}}` |
| 货币（currency） | `number_value` | `{"field": "金额", "number_value": 99.99}` |
| 百分比（percentage） | `number_value` | `{"field": "占比", "number_value": 0.75}` |

### TextValueList 结构

```json
{
  "items": [
    {"text": "文本内容", "type": "text"}
  ]
}
```

### UrlValueList 结构

```json
{
  "items": [
    {"text": "链接显示文字", "type": "url", "link": "https://example.com"}
  ]
}
```

### OptionValueList 结构

```json
{
  "items": [
    {"id": "选项ID（可选）", "text": "选项文字", "style": "3"}
  ]
}
```

### ImageIDValueList 结构

```json
{
  "items": [
    {"image_id": "图片ID"}
  ]
}
```

### StringValueList 结构（关联字段）

```json
{
  "items": ["record_id_1", "record_id_2"]
}
```

### AutoNumberValue 结构

```json
{
  "seq": "1",
  "text": "编号内容"
}
```

> ⚠️ **注意**：写入记录时，单选/多选字段的 `text` 必须与字段属性中已定义的选项文字完全匹配，否则可能写入失败。

---

## 字段属性（Property）详细说明

### NumberFieldProperty（数字字段属性）

```json
{
  "decimal_places": 2,
  "use_separate": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `decimal_places` | uint32 | 小数点位数（精度） |
| `use_separate` | bool | 是否使用千位符（如 1,000） |

### CheckboxFieldProperty（复选框字段属性）

```json
{
  "checked": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `checked` | bool | 新增记录时是否默认勾选 |

### DateTimeFieldProperty（日期时间字段属性）

```json
{
  "format": "yyyy-mm-dd",
  "auto_fill": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `format` | string | 日期格式，支持格式见下方 |
| `auto_fill` | bool | 新建记录时是否自动填充当前时间 |

**支持的日期格式**：

| 格式字符串 | 示例 |
|-----------|------|
| `yyyy"年"m"月"d"日"` | 2018 年 4 月 20 日 |
| `yyyy-mm-dd` | 2018-04-20 |
| `yyyy/m/d` | 2018/4/20 |
| `m"月"d"日"` | 4 月 20 日 |
| `[$-804]yyyy"年"m"月"d"日" dddd` | 2018 年 4 月 20 日 星期五 |
| `yyyy"年"m"月"d"日" hh:mm` | 2018 年 4 月 20 日 14:00 |
| `yyyy-mm-dd hh:mm` | 2018-04-20 14:00 |
| `m/d/yyyy` | 4/20/2018 |
| `d/m/yyyy` | 20/4/2018 |

### UrlFieldProperty（超链接字段属性）

```json
{
  "type": 1
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | uint32 | 展示样式：0-未知，1-文字，2-图标文字 |

### SelectFieldProperty（多选字段属性）

```json
{
  "options": [
    { "id": "opt_001", "text": "选项A", "style": 3 },
    { "id": "opt_002", "text": "选项B", "style": 4 }
  ],
  "is_multiple": true,
  "is_quick_add": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `options` | []Option | 选项列表 |
| `is_multiple` | bool | 是否多选（系统参数，用户无需设置） |
| `is_quick_add` | bool | 是否允许填写时新增选项（系统参数，用户无需设置） |

### SingleSelectFieldProperty（单选字段属性）

结构与 `SelectFieldProperty` 相同，但只允许单选。

### ProgressFieldProperty（进度字段属性）

```json
{
  "decimal_places": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `decimal_places` | uint32 | 小数位数 |

---

## 典型工作流示例

### 工作流一：从零创建表

```
步骤 1：获取文档的工作表列表
  → smartsheet.list_tables（获取 sheet_id）

步骤 2：为工作表添加字段
  → smartsheet.add_fields（添加：任务名称、优先级、负责人、截止日期、状态、进度）

步骤 3：批量添加任务记录
  → smartsheet.add_records（写入多条任务数据）

步骤 4：删除默认空行和默认列
  → smartsheet.list_records（获取建表时自动生成的空行 record_id 列表）
  → smartsheet.delete_records（传入空行 record_ids，批量删除默认空行）
  → smartsheet.list_fields（获取建表时自动生成的默认列 field_id 列表）
  → smartsheet.delete_fields（传入默认列 field_ids，批量删除默认列）

步骤 5：（可选）创建看板视图
→ smartsheet.add_view（view_type="kanban"，按状态分组）
```

### 工作流二：查询并更新任务状态

```
步骤 1：列出工作表
  → smartsheet.list_tables（获取 sheet_id）

步骤 2：查询记录
  → smartsheet.list_records（获取 record_id 和当前字段值）

步骤 3：更新指定记录
  → smartsheet.update_records（传入 record_id 和新的字段值）
```

### 工作流三：读取数据并分析

```
步骤 1：列出工作表
  → smartsheet.list_tables

步骤 2：了解字段结构
  → smartsheet.list_fields（了解有哪些列及其类型）

步骤 3：分页读取所有记录
  → smartsheet.list_records（offset=0, limit=100）
  → 若 has_more=true，继续请求下一页（offset=100）

步骤 4：处理数据
  → 根据 field_values 中的数据进行统计分析
```

### 工作流四：清理过期数据

```
步骤 1：列出工作表
  → smartsheet.list_tables

步骤 2：查询需要删除的记录
  → smartsheet.list_records（获取目标 record_id 列表）

步骤 3：批量删除记录
  → smartsheet.delete_records（传入 record_ids 数组）
```

---

> 📌 **提示**：所有操作都需要先获取 `file_id`（智能表格文档 ID）和 `sheet_id`（工作表 ID）。
> 可通过 `manage.search_file` 搜索文档获取 `file_id`，再通过 `smartsheet.list_tables` 获取 `sheet_id`。


## 注意事项

- **前置条件**：所有 smartsheet.* 工具都需要 `file_id` 和 `sheet_id`，操作前先调用 `smartsheet.list_tables` 获取 sheet_id
- **图片字段写入**：向图片类型字段（field_type=image）写入数据时，需先调用 `upload_image` 工具上传图片获取 `image_id`，再以 `[{"image_id": "xxx"}]` 格式填入字段值
- **字段类型不可变**：`update_fields` 时 `field_type` 不能修改，但必须传入原值；支持的字段类型详见字段类型枚举表
- **记录字段值格式**：不同字段类型的值格式不同，详见上方"字段值格式参考"章节

# 筛选

## 1. sheet.get_filters

#### 功能说明

获取工作表当前的筛选配置。

**前置条件：** 工作表必须已开启筛选（表中存在筛选）；未开启时请先调用 `sheet.open_filters`。

适用于在更新筛选条件前先读取现有范围和筛选列规则。



> 若工作表尚未开启筛选，返回内容可能报错或为空或不包含筛选列配置

#### 调用示例

查询当前筛选配置：

```json
{
  "file_id": "string",
  "worksheet_id": 7
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID

#### 返回值说明

```json
{
  "range": {
    "row_from": 0,
    "row_to": 100,
    "col_from": 0,
    "col_to": 5
  },
  "filters": [
    {
      "col": 2,
      "condition": {
        "values": ["进行中"]
      }
    }
  ]
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `range` | object | 当前筛选区域 |
| `filters` | array | 按列配置的筛选条件 |


---

## 2. sheet.open_filters

#### 功能说明

为指定工作表开启筛选功能，并设置筛选范围。

**前置条件：** 数据表不能为空；创建或指定筛选范围时，列范围只能覆盖到最后一个有数据的列（`col_to` 不得超过最后一列有数据的列索引）。

适用于把某块数据区域转成可按列筛选的表格区域；行列索引均为 0-based。



**幂等性**：是

> 行列索引均为 0-based
> 一般建议把首行作为表头，并确保筛选区域完整覆盖数据块

#### 调用示例

为矩形数据区域开启筛选：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "expand_filter_range": true,
  "range": {
    "col_from": 0,
    "col_to": 5,
    "row_from": 0,
    "row_to": 100
  }
}
```

单单元格选区（与用户文档示例一致）：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "expand_filter_range": true,
  "range": {
    "col_from": 0,
    "col_to": 0,
    "row_from": 0,
    "row_to": 0
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID（路径参数）
- `worksheet_id` (integer, 必填): 工作表 ID（路径参数）
- `expand_filter_range` (boolean, 必填): 是否开启将空行后面的数据纳入筛选；仅当选区为单个单元格时生效
- `range` (object, 必填): 矩形筛选区域。若选区为单个单元格，将开启所有列的筛选。
若要修改筛选范围，请先关闭筛选后再调用本接口重新开启。

  - `col_from` (integer, 必填): 列起始索引位置（0-based）
  - `col_to` (integer, 必填): 列最后索引位置
  - `row_from` (integer, 必填): 行起始索引位置（0-based）
  - `row_to` (integer, 必填): 行最后索引位置

**请求地址：** `https://openapi.wps.cn/v7/airsheet/{file_id}/worksheets/{worksheet_id}/filters`  
**HTTP 方法：** POST  
**请求体格式：** application/json  
**签名方式：** KSO-1  
**权限：** 管理智能表格（应用授权）或查询和管理智能表格（用户授权）`kso.airsheet.readwrite`

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | 是 | 文件 ID |
| `worksheet_id` | integer | 是 | 工作表 ID |

**请求体字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `expand_filter_range` | boolean | 是 | 是否开启将空行后面的数据纳入筛选（仅当选区为单个单元格时生效） |
| `range` | object | 是 | 区域范围；单个单元格时会开启所有列的筛选；若要修改筛选范围请先关闭筛选再重新开启 |

**range 对象字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `col_from` | integer | 是 | 列起始索引位置 |
| `col_to` | integer | 是 | 列最后索引位置 |
| `row_from` | integer | 是 | 行起始索引位置 |
| `row_to` | integer | 是 | 行最后索引位置 |


#### 返回值说明

```json
{}

```


---

## 3. sheet.update_filters

#### 功能说明

更新工作表某一列的筛选条件。

`col` 为要筛选的列索引（0-based）。`condition` 内通过 `param1`、`param2` 配置一至两组自定义筛选；若二者均未传入，则清空该列筛选。
适用于按枚举值、文本或其他条件动态收窄当前筛选结果。



#### 操作约束

- **前置检查**：工作表必须已开启筛选；未开启时先调用 `sheet.open_filters`

**幂等性**：是

> `condition` 内 `param1` 与 `param2` 均未传时，将清空该列筛选
> 可先通过 `sheet.get_filters` 查看当前工作表筛选状态，再构造本接口请求体

#### 调用示例

双条件且关系（与官方示例一致）：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "col": 0,
  "condition": {
    "operator": "filter_operator_and",
    "param1": {
      "custom_type": "filter_custom_type_greater",
      "val": "string"
    },
    "param2": {
      "custom_type": "filter_custom_type_greater",
      "val": "string"
    }
  }
}
```

仅使用 param1 单条件：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "col": 2,
  "condition": {
    "param1": {
      "custom_type": "filter_custom_type_contains",
      "val": "进行中"
    }
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID（路径参数）
- `worksheet_id` (integer, 必填): 工作表 ID（路径参数）
- `col` (integer, 必填): 要筛选的列号索引，从 0 开始
- `condition` (object, 必填): 筛选条件。可包含 `operator`、`param1`、`param2`。
若 `param1` 与 `param2` 均未传入，则清空该列筛选。

  - `operator` (string, 可选): 操作符，不传默认为「并且」。枚举：`filter_operator_and`、`filter_operator_or`
  - `param1` (object, 可选): 第一个筛选条件参数
  - `param2` (object, 可选): 第二个筛选条件参数（可选）

**HTTP 方法：** POST  
**请求体格式：** application/json  

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_id` | string | 是 | 文件 ID |
| `worksheet_id` | integer | 是 | 工作表 ID |

**请求体字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `col` | integer | 是 | 要筛选的列号索引，从 0 开始 |
| `condition` | object | 是 | 筛选条件 |

**condition 对象字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `operator` | string | 否 | 操作符，不传默认为并且。枚举：`filter_operator_and`、`filter_operator_or` |
| `param1` | object | 否 | 第一个筛选条件参数；若 `param1` 与 `param2` 都未传则清空筛选 |
| `param2` | object | 否 | 第二个筛选条件参数（可选） |

**param1 / param2 对象字段（结构相同）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `custom_type` | string | 是 | 筛选类型，见下列枚举 |
| `val` | string | 是 | 筛选值 |

**custom_type 枚举**

- `filter_custom_type_greater`
- `filter_custom_type_greater_equ`
- `filter_custom_type_less`
- `filter_custom_type_less_equ`
- `filter_custom_type_equals`
- `filter_custom_type_not_equ`
- `filter_custom_type_begin_with`
- `filter_custom_type_end_with`
- `filter_custom_type_contains`
- `filter_custom_type_not_contains`


#### 返回值说明

```json
{}

```


---

## 4. sheet.delete_filters

#### 功能说明

删除工作表当前的筛选配置。

**前置条件：** 工作表必须已开启筛选（表中存在筛选）；若无筛选可删则无需调用本接口。

删除后将移除整个筛选状态和筛选范围。



#### 操作约束

- **前置检查**：`sheet.get_filters` 确认当前工作表已启用筛选及拟删条件
- **用户确认**：删除筛选不可恢复，必须向用户确认

**幂等性**：是

#### 调用示例

删除当前筛选：

```json
{
  "file_id": "string",
  "worksheet_id": 7
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID

#### 返回值说明

```json
{}

```


---


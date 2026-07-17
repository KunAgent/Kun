# 数据校验

## 1. sheet.get_data_validations

#### 功能说明

获取指定区域内的数据校验规则。

适用于读取下拉选项、输入限制或其他校验规则配置。



> 行列索引均为 0-based

#### 调用示例

查询单列下拉规则：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "col_from": 2,
  "col_to": 2,
  "row_from": 1,
  "row_to": 100
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `col_from` (integer, 必填): 起始列索引
- `col_to` (integer, 必填): 结束列索引
- `row_from` (integer, 必填): 起始行索引
- `row_to` (integer, 必填): 结束行索引

#### 返回值说明

```json
{
  "data_validations": [
    {
      "type": "List",
      "formula1": "待处理,进行中,已完成",
      "multi_support": false,
      "ref_ranges": [
        { "row_from": 1, "row_to": 100, "col_from": 2, "col_to": 2 }
      ]
    }
  ]
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data_validations[].type` | string | 数据校验类型 |
| `data_validations[].formula1` | string | 第一个公式或选项来源 |
| `data_validations[].formula2` | string | 第二个公式 |
| `data_validations[].operator` | string | 判断条件类型 |
| `data_validations[].multi_support` | boolean | 是否支持多选 |
| `data_validations[].ref_ranges` | array[object] | 生效区域列表 |


---

## 2. sheet.create_data_validations

#### 功能说明

为指定区域创建数据校验规则。

常见用途包括创建下拉选项、限制输入范围或设置单元格输入约束。



#### 操作约束

- **前置检查**：先 get_data_validations 查看目标区域已有规则，避免重叠

**幂等性**：否 — 重复调用可能创建重叠规则，先确认是否已成功

> 行列索引均为 0-based

#### 调用示例

创建下拉选项规则：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "args": {
    "list_items": [
      {
        "value": "待处理"
      },
      {
        "value": "进行中"
      },
      {
        "value": "已完成"
      }
    ],
    "validation_error_title": "输入不合法",
    "validation_error_text": "请选择下拉列表中的值"
  },
  "field_type": "List",
  "range": {
    "col_from": 2,
    "col_to": 2,
    "row_from": 1,
    "row_to": 100
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `args` (object, 必填): 数据校验参数
- `field_type` (string, 必填): 字段类型，ET 目前仅支持 `List`（下拉列表）
- `range` (object, 必填): 区域范围（如需设置整列，`row_to` 传最大值 `1048575`）

**Path 参数：**

- `file_id`：文件 ID
- `worksheet_id`：工作表 ID

**Body 参数：**

- `args`：数据校验参数
- `field_type`：字段类型，ET 目前仅支持 `List`（下拉列表）
- `range`：区域范围（如需设置整列，`row_to` 传最大值 `1048575`）

**args 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `list_items` | array[object] | 列表项数组 |
| `validation_error_text` | string | 校验错误提示文本，由用户自定义 |
| `validation_error_title` | string | 校验错误提示标题，由用户自定义 |

**list_items 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `value` | string | 选项值，用户自定义列表选项名字 |

**range 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `col_from` | integer | 列起始索引位置 |
| `col_to` | integer | 列最后索引位置 |
| `row_from` | integer | 行起始索引位置 |
| `row_to` | integer | 行最后索引位置（整列可传 `1048575`） |


#### 返回值说明

```json
{}

```


---

## 3. sheet.update_data_validations

#### 功能说明

更新指定区域的数据校验规则。

适用于调整下拉候选项、校验条件或生效范围。



#### 操作约束

- **前置检查**：先 get_data_validations 获取现有配置

**幂等性**：是

> 行列索引均为 0-based
> 若需要彻底移除规则，请改用 `sheet.delete_data_validations`

#### 调用示例

更新下拉选项规则：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "args": {
    "list_items": [
      {
        "value": "待处理"
      },
      {
        "value": "进行中"
      },
      {
        "value": "已完成"
      },
      {
        "value": "已归档"
      }
    ],
    "validation_error_title": "输入不合法",
    "validation_error_text": "请选择下拉列表中的值"
  },
  "field_type": "List",
  "range": {
    "col_from": 2,
    "col_to": 2,
    "row_from": 1,
    "row_to": 100
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `args` (object, 必填): 数据校验参数
- `field_type` (string, 必填): 字段类型，ET 目前仅支持 `List`（下拉列表）
- `range` (object, 必填): 区域范围（如需设置整列，`row_to` 传最大值 `1048575`）

**Path 参数：**

- `file_id`：文件 ID
- `worksheet_id`：工作表 ID

**Body 参数：**

- `args`：数据校验参数
- `field_type`：字段类型，ET 目前仅支持 `List`（下拉列表）
- `range`：区域范围（如需设置整列，`row_to` 传最大值 `1048575`）

**args 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `list_items` | array[object] | 列表项数组 |
| `validation_error_text` | string | 校验错误提示文本，由用户自定义 |
| `validation_error_title` | string | 校验错误提示标题，由用户自定义 |

**list_items 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `value` | string | 选项值，用户自定义列表选项名字 |

**range 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `col_from` | integer | 列起始索引位置 |
| `col_to` | integer | 列最后索引位置 |
| `row_from` | integer | 行起始索引位置 |
| `row_to` | integer | 行最后索引位置（整列可传 `1048575`） |

更新时建议先调用 `sheet.get_data_validations` 对照原有配置再修改。


#### 返回值说明

```json
{}

```


---

## 4. sheet.delete_data_validations

#### 功能说明

删除指定区域内的数据校验规则。

删除后，该区域将不再保留下拉限制或输入校验约束。



#### 操作约束

- **前置检查**：`sheet.get_data_validations` 确认目标区域存在拟删校验规则
- **用户确认**：删除数据校验规则不可恢复，必须向用户确认

**幂等性**：是

#### 调用示例

删除单列下拉规则：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "range": {
    "row_from": 1,
    "row_to": 100,
    "col_from": 2,
    "col_to": 2
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `range` (object, 必填): 目标区域范围

#### 返回值说明

```json
{}

```


---


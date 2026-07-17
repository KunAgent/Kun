# 区域权限

## 1. sheet.list_protection_ranges

#### 功能说明

获取指定工作表的区域权限列表。

该能力面向智能表格（.ksheet），适合在新增、修改或删除区域权限前先读取现有配置。



> 删除或更新前，建议先读取现有区域权限，确认目标范围和 `protection_range_id`

#### 调用示例

查询指定工作表的区域权限：

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
  "items": [
    {
      "protection_range_id": "pr_123",
      "worksheet_id": 7,
      "ranges": [
        { "row_from": 0, "row_to": 9, "col_from": 0, "col_to": 2 }
      ]
    }
  ]
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `items[].protection_range_id` | string | 区域权限 ID |
| `items[].worksheet_id` | integer | 所属工作表 ID |
| `items[].ranges` | array[object] | 受保护区域列表 |


---

## 2. sheet.create_protection_ranges

#### 功能说明

创建智能表格的区域权限配置。

适用于需要限制指定区域可查看、可编辑或可操作范围的场景。



#### 操作约束

- **后置验证**：list_protection_ranges 确认权限已创建

**幂等性**：否 — 重复调用可能创建多个保护区域，先确认是否已成功

> 该能力主要适用于智能表格（.ksheet）

#### 调用示例

批量创建区域权限：

```json
{
  "file_id": "string",
  "sheets_protection_infos": [
    {
      "master_id": "string",
      "other_user_permission": "user_access_permission_visible",
      "protection_infos": [
        {
          "others_access_permission": "others_access_permission_invisible",
          "protection_ranges": [
            {
              "column_from": 0,
              "column_to": 0,
              "row_from": 0,
              "row_to": 0
            }
          ],
          "protection_user_data": [
            {
              "access_permission": "user_access_permission_visible",
              "user_id": "string"
            }
          ],
          "range_creator_id": "string"
        }
      ],
      "worksheet_id": 0
    }
  ]
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `sheets_protection_infos` (array[object], 必填): 工作表区域权限详细信息列表

**sheets_protection_infos 说明：**

- `sheets_protection_infos` 为对象数组，每个对象对应一个工作表的区域权限配置，结构如下：
  - `master_id` (string, 必填)：区域保护开启者的用户 ID（修改时不需要传）
  - `other_user_permission` (string, 必填)：剩余区域对其他人的权限类型（默认 edit，智能表格仅支持 edit）
    - 可选值：`user_access_permission_visible`、`user_access_permission_editable`
  - `protection_infos` (array[object], 必填)：工作表的区域权限列表
    - `others_access_permission` (string, 必填)：工作表保护区域中其他人的权限类型
      - 可选值：`others_access_permission_invisible`、`others_access_permission_visible`、`others_access_permission_editable`
    - `protection_ranges` (array[object], 必填)：工作表保护区域范围信息列表
      - `column_from` (integer, 必填)：保护区域列起始索引位置
      - `column_to` (integer, 必填)：保护区域列最后索引位置
      - `row_from` (integer, 必填)：保护区域行起始索引位置
      - `row_to` (integer, 必填)：保护区域行最后索引位置
    - `protection_user_data` (array[object], 必填)：工作表保护区域中指定用户权限列表
      - `access_permission` (string, 必填)：指定用户权限类型
        - 可选值：`user_access_permission_visible`、`user_access_permission_editable`
      - `user_id` (string, 必填)：用户 ID
    - `range_creator_id` (string, 必填)：区域权限创建者用户 ID（修改时不需要传）
  - `worksheet_id` (integer, 必填)：工作表 ID

**请求体示例：**

```json
{
  "sheets_protection_infos": [
    {
      "master_id": "string",
      "other_user_permission": "user_access_permission_visible",
      "protection_infos": [
        {
          "others_access_permission": "others_access_permission_invisible",
          "protection_ranges": [
            {
              "column_from": 0,
              "column_to": 0,
              "row_from": 0,
              "row_to": 0
            }
          ],
          "protection_user_data": [
            {
              "access_permission": "user_access_permission_visible",
              "user_id": "string"
            }
          ],
          "range_creator_id": "string"
        }
      ],
      "worksheet_id": 0
    }
  ]
}
```


#### 返回值说明

```json
{}

```


---

## 3. sheet.update_protection_ranges

#### 功能说明

批量更新智能表格的区域权限配置。

适用于调整受保护区域、权限主体或其他区域权限属性。



#### 操作约束

- **前置检查**：list_protection_ranges 获取现有配置

**幂等性**：是

> 若要调整范围或授权对象，先读取原始配置可降低误改风险

#### 调用示例

更新已有区域权限：

```json
{
  "file_id": "string",
  "sheets_protection_infos": [
    {
      "other_user_permission": "user_access_permission_visible",
      "protection_infos": [
        {
          "id": "string",
          "others_access_permission": "others_access_permission_invisible",
          "protection_ranges": [
            {
              "column_from": 0,
              "column_to": 0,
              "row_from": 0,
              "row_to": 0
            }
          ],
          "protection_user_data": [
            {
              "access_permission": "user_access_permission_visible",
              "user_id": "string"
            }
          ]
        }
      ],
      "worksheet_id": 0
    }
  ]
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `sheets_protection_infos` (array[object], 必填): 区域权限更新配置列表

**sheets_protection_infos 说明：**

- `sheets_protection_infos` 为对象数组，每个对象对应一个工作表的区域权限更新配置，结构如下：
  - `other_user_permission` (string, 非必填)：剩余区域对其他人的工作表区域权限类型（可选参数）
    - 可选值：`user_access_permission_visible`、`user_access_permission_editable`
  - `protection_infos` (array[object], 非必填)：修改工作表的区域权限列表（可选参数）
    - `id` (string, 必填)：区域权限 uuid（修改时需要带上）
    - `others_access_permission` (string, 必填)：工作表保护区域中其他人具有的权限类型
      - 可选值：`others_access_permission_invisible`、`others_access_permission_visible`、`others_access_permission_editable`
    - `protection_ranges` (array[object], 必填)：工作表保护区域范围信息列表
      - `column_from` (integer, 必填)：保护区域列起始索引位置
      - `column_to` (integer, 必填)：保护区域列最后索引位置
      - `row_from` (integer, 必填)：保护区域行起始索引位置
      - `row_to` (integer, 必填)：保护区域行最后索引位置
    - `protection_user_data` (array[object], 必填)：工作表保护区域中指定用户权限列表信息列表
      - `access_permission` (string, 必填)：工作表区域权限中指定用户的权限类型
        - 可选值：`user_access_permission_visible`、`user_access_permission_editable`
      - `user_id` (string, 必填)：用户 ID
  - `worksheet_id` (integer, 必填)：工作表 ID

**请求体示例：**

```json
{
  "sheets_protection_infos": [
    {
      "other_user_permission": "user_access_permission_visible",
      "protection_infos": [
        {
          "id": "string",
          "others_access_permission": "others_access_permission_invisible",
          "protection_ranges": [
            {
              "column_from": 0,
              "column_to": 0,
              "row_from": 0,
              "row_to": 0
            }
          ],
          "protection_user_data": [
            {
              "access_permission": "user_access_permission_visible",
              "user_id": "string"
            }
          ]
        }
      ],
      "worksheet_id": 0
    }
  ]
}
```


#### 返回值说明

```json
{}

```


---

## 4. sheet.delete_protection_ranges

#### 功能说明

批量删除智能表格中的区域权限配置。

删除前建议先读取现有区域权限，确认待删除的权限 ID 和目标区域。



#### 操作约束

- **前置检查**：`sheet.list_protection_ranges` 确认拟删区域权限 ID 与范围
- **用户确认**：删除区域权限不可恢复，必须向用户确认

**幂等性**：是

> 删除后原有区域限制会立即失效

#### 调用示例

删除指定区域权限：

```json
{
  "file_id": "string",
  "sheets_protection_infos": [
    {
      "delete_protection_ranges": [
        {
          "id": "string"
        }
      ],
      "worksheet_id": 0
    }
  ]
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `sheets_protection_infos` (array[object], 必填): 待删除的区域权限配置列表

**sheets_protection_infos 说明：**

- `sheets_protection_infos` (array[object], 必填)：为对象数组，每个对象对应一个工作表的区域权限删除配置，结构如下：
  - `delete_protection_ranges` (array[object], 必填)：删除时需要传的区域数组
    - `id` (string, 必填)：区域权限 uuid
  - `worksheet_id` (integer, 必填)：工作表 ID

**请求体示例：**

```json
{
  "sheets_protection_infos": [
    {
      "delete_protection_ranges": [
        {
          "id": "string"
        }
      ],
      "worksheet_id": 0
    }
  ]
}
```


#### 返回值说明

```json
{}

```


---


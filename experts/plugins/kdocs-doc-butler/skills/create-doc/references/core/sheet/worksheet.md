# 工作表管理

## 1. sheet.get_sheets_info

#### 功能说明

获取指定表格文件的所有工作表信息，包含每个工作表的名称、索引、数据区域范围等。



> rowTo/colTo 比 maxRow/maxCol 更有参考价值，表示实际数据区域

#### 调用示例

获取工作表信息：

```json
{
  "file_id": "string"
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID

#### 返回值说明

```json
{
  "sheetsInfo": [
    {
      "isEmpty": false,
      "colFrom": 0,
      "colTo": 5,
      "isVisible": true,
      "maxCol": 16383,
      "maxRow": 1048575,
      "rowFrom": 0,
      "rowTo": 50,
      "sheetId": 3,
      "sheetIdx": 0,
      "sheetName": "Sheet1",
      "sheetType": "et"
    }
  ]
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `sheetsInfo[].sheetId` | integer | 工作表 ID |
| `sheetsInfo[].sheetIdx` | integer | 工作表索引 |
| `sheetsInfo[].sheetName` | string | 工作表名称 |
| `sheetsInfo[].sheetType` | string | 工作表类型（见下表） |
| `sheetsInfo[].isEmpty` | boolean | 是否为空 |
| `sheetsInfo[].isVisible` | boolean | 是否可见 |
| `sheetsInfo[].maxRow` | integer | 最大行数（工作表总容量） |
| `sheetsInfo[].maxCol` | integer | 最大列数 |
| `sheetsInfo[].rowFrom` | integer | 数据区域起始行 |
| `sheetsInfo[].rowTo` | integer | 数据区域结束行（比 `maxRow` 更有参考价值） |
| `sheetsInfo[].colFrom` | integer | 数据区域起始列 |
| `sheetsInfo[].colTo` | integer | 数据区域结束列 |

**sheetType 工作表类型：**

| sheetType | 说明 |
|-----------|------|
| `et` | 普通电子表格 |
| `db` | 数据表 |
| `airApp` | 应用表 |
| `oldDb` | 旧的数据表 |
| `dbDashBoard` | 数据表的仪表盘 |
| `etDashBoard` | 普通表格的仪表盘 |
| `workbench` | 工作台 |


---

## 2. sheet.add_sheet

#### 功能说明

在指定表格文件中新增工作表。可指定名称、数量、插入位置和默认列宽。
插入位置通过 `before` / `after` / `end` 三选一控制。



**幂等性**：否 — 重复调用会创建多个工作表，先确认是否已成功

#### 调用示例

在末尾新增工作表：

```json
{
  "file_id": "string",
  "name": "销售数据",
  "end": true,
  "type": "xlWorksheet",
  "defColWidth": 1335,
  "count": 1
}
```

在指定工作表之后插入：

```json
{
  "file_id": "string",
  "name": "新工作表",
  "after": {
    "sheetId": 3
  }
}
```

在指定工作表之前插入：

```json
{
  "file_id": "string",
  "before": {
    "sheetId": 2
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID（路径参数 `{file_id}`）
- `before` (object, 可选): 插入到指定工作表之前；与 `after`、`end` 三选一
- `after` (object, 可选): 插入到指定工作表之后；与 `before`、`end` 三选一
- `end` (boolean, 可选): 是否插入到末尾；与 `before`、`after` 三选一
- `type` (string, 可选): 工作表类型，默认 `xlWorksheet`；默认值：`xlWorksheet`
- `defColWidth` (integer, 可选): 默认列宽，如 `1335`（约 10.5 个字符）
- `count` (integer, 可选): 新增工作表数量，默认 `1`；默认值：`1`
- `name` (string, 可选): 工作表名，默认 `sheetn`

**Path 参数：**

- `file_id`（string，必填）：文件 ID

**Body（`application/json`）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `before` | object | 否 | 在指定工作表之前插入；与 `after`、`end` 三选一 |
| `after` | object | 否 | 在指定工作表之后插入；与 `before`、`end` 三选一 |
| `end` | boolean | 否 | 是否在末尾插入；与 `before`、`after` 三选一 |
| `type` | string | 否 | 工作表类型，默认 `xlWorksheet` |
| `defColWidth` | integer | 否 | 默认列宽，如 `1335`（约 10.5 个字符） |
| `count` | integer | 否 | 新增工作表数量，默认 `1` |
| `name` | string | 否 | 工作表名，默认 `sheetn` |

**before / after 对象：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheetId` | integer | 是 | 目标工作表 ID |


#### 返回值说明

```json
{
  "sheetId": 4
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `sheetId` | integer | 新建的工作表 ID |


---

## 3. sheet.update_sheet

#### 功能说明

更新指定工作表，支持重命名以及调整工作表位置。
适用于 Excel（.xlsx）和智能表格（.ksheet）。



**幂等性**：是

#### 调用示例

更新工作表（重命名并移动）：

```json
{
  "file_id": "string",
  "worksheet_id": 1,
  "move_sheet_id": 0,
  "move_type": "sheet_move_type_before",
  "name": "string"
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `move_sheet_id` (integer, 可选): 移动时参照的工作表 ID
- `move_type` (string, 可选): 需要移动的位置，若不传则不移动位置。可选值：`sheet_move_type_before` / `sheet_move_type_after`
- `name` (string, 可选): 工作表名

#### 返回值说明

```json
{
  "code": 0,
  "msg": "string"
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | integer | 响应码 |
| `msg` | string | 错误描述，code 非 0 时返回失败原因 |


---

## 4. sheet.delete_sheets

#### 功能说明

删除一个或多个工作表。
适用于 Excel（.xlsx）和智能表格（.ksheet）。



#### 操作约束

- **前置检查**：`sheet.get_sheets_info` 核对拟删工作表名称与 sheetId
- **用户确认**：删除工作表不可恢复，必须向用户确认工作表名称和 ID

**幂等性**：是

#### 调用示例

删除多个工作表：

```json
{
  "file_id": "string",
  "worksheet_ids": [
    0
  ]
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_ids` (array[integer], 可选): 需要删除的工作表 ID 列表

#### 返回值说明

```json
{
  "code": 0,
  "msg": "string"
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | integer | 响应码 |
| `msg` | string | 错误描述，code 非 0 时返回失败原因 |


---

## 5. sheet.copy_worksheet

#### 功能说明

复制指定工作表。

适用于按模板快速生成副本、保留原始工作表不动的场景。



#### 操作约束

- **后置验证**：get_sheets_info 确认副本已创建

**幂等性**：否 — 重复调用会生成多个副本，先确认是否已成功

> 可根据是否复制第一个工作表，按需设置 `copy_first_sheet`,若要复制第一个工作表必须带该参数且设置为 true

#### 调用示例

复制指定工作表：

```json
{
  "file_id": "string",
  "worksheet_id": 7
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `copy_first_sheet` (boolean, 可选): 是否复制第一个工作表,若要复制第一个工作表必须带该参数且设置为 true

#### 返回值说明

```json
{
  "worksheet_id": 9,
  "name": "任务模板 副本"
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `worksheet_id` | integer | 新复制出的工作表 ID |
| `name` | string | 新工作表名称 |


---

## 6. sheet.update_worksheet

#### 功能说明

更新工作表名称或调整工作表顺序位置。

支持重命名工作表，也支持相对于另一张工作表前后移动。



**幂等性**：是

> `name` 与移动参数可单独使用，也可按实际接口能力组合使用

#### 调用示例

重命名工作表：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "name": "任务总览"
}
```

将工作表移动到另一张表之后：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "move_sheet_id": 3,
  "move_type": "sheet_move_type_after"
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `name` (string, 可选): 新工作表名称
- `move_sheet_id` (integer, 可选): 参照工作表 ID
- `move_type` (string, 可选): 移动类型：`sheet_move_type_before` / `sheet_move_type_after`

#### 返回值说明

```json
{}

```


---


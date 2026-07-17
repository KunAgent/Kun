# 条件格式

## 1. sheet.get_conditional_format_rules

#### 功能说明

获取工作表上的条件格式规则列表。

适用于在新增、调整或清除条件格式前先查看当前配置。



> 更新或删除前建议先读取规则，确认目标规则与生效区域

#### 调用示例

查询工作表条件格式：

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
  "rules": [
    {
      "id": "cf_1",
      "type": "cell_value",
      "ranges": [
        { "row_from": 1, "row_to": 100, "col_from": 3, "col_to": 3 }
      ],
      "format": {
        "fill": { "color": "#FFF2CC" }
      }
    }
  ]
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `rules[].id` | string | 规则 ID |
| `rules[].ranges` | array[object] | 生效区域列表 |
| `rules[].type` | string | 规则类型 |
| `rules[].format` | object | 命中后的格式设置 |


---

## 2. sheet.create_conditional_format_rules

#### 功能说明

为工作表创建条件格式规则。

适用于按单元格值、公式或其他条件自动高亮显示数据。



#### 操作约束

- **前置检查**：先 get_conditional_format_rules 查看现有规则，避免规则冲突

**幂等性**：否 — 重复调用可能创建冲突规则，先确认是否已成功

#### 调用示例

创建条件格式规则：

```json
{
  "file_id": "string",
  "worksheet_id": 0,
  "rule": {
    "cf_rule_type": "cf_rule_type_value_range",
    "formula1": "string",
    "formula2": "string",
    "id": 0,
    "lastone": true,
    "operator": "cf_rule_operator_greater",
    "priority": 0,
    "ranges": [
      {
        "col_from": 0,
        "col_to": 0,
        "row_from": 0,
        "row_to": 0
      }
    ],
    "rank": "string",
    "xf": {
      "alc_h": 0,
      "alc_v": 0,
      "clr_bottom": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "clr_diag_down": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "clr_diag_up": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "clr_inside_horz": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "clr_inside_vert": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "clr_left": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "clr_right": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "clr_top": {
        "tint": 0,
        "type": 0,
        "value": 0
      },
      "dg_bottom": 0,
      "dg_diag_down": 0,
      "dg_diag_up": 0,
      "dg_inside_horz": 0,
      "dg_inside_vert": 0,
      "dg_left": 0,
      "dg_right": 0,
      "dg_top": 0,
      "fill": {
        "back": {
          "tint": 0,
          "type": 0,
          "value": 0
        },
        "fore": {
          "tint": 0,
          "type": 0,
          "value": 0
        },
        "type": 0
      },
      "font": {
        "bls": true,
        "char_set": 0,
        "color": {
          "tint": 0,
          "type": 0,
          "value": 0
        },
        "dy_height": 0,
        "italic": true,
        "name": "string",
        "sss": 0,
        "strikeout": true,
        "theme_font": 0,
        "uls": 0
      },
      "hidden": true,
      "indent": 0,
      "locked": true,
      "mask_cats": 0,
      "mask_cats_font": 0,
      "numfmt": "string",
      "reading_order": 0,
      "shrink_to_fit": true,
      "trot": 0,
      "wrap": true
    }
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `rule` (object, 必填): 条件格式规则对象

**rule 说明：**

- `rule` (object, 必填)：条件格式规则
  - `cf_rule_type` (string, 必填)：条件格式类型
    - 可选值：`cf_rule_type_value_range`、`cf_rule_type_contains_value`、`cf_rule_type_time_period`、`cf_rule_type_rank_average`、`cf_rule_type_expression`
  - `formula1` (string, 必填)：公式 1
  - `formula2` (string, 必填)：公式 2
  - `id` (integer, 非必填)：条件格式 ID，由查询的条件格式信息返回。修改用到 id 和 priority 二选一定位删除；如果 id 和 priority 都传，以 id 为准
  - `lastone` (boolean, 必填)：是否最后一个排序（默认为第一个）
  - `operator` (string, 必填)：操作符
    - 可选值：`cf_rule_operator_greater`、`cf_rule_operator_greater_equal`、`cf_rule_operator_less`、`cf_rule_operator_less_equal`、`cf_rule_operator_equal`、`cf_rule_operator_not_equal`、`cf_rule_operator_not_between`、`cf_rule_operator_between`、`cf_rule_operator_string_conclude`、`cf_rule_operator_string_exclude`、`cf_rule_operator_string_begins_with`、`cf_rule_operator_string_ends_with`、`cf_rule_operator_today`、`cf_rule_operator_yesterday`、`cf_rule_operator_last7_days`、`cf_rule_operator_this_week`、`cf_rule_operator_last_week`、`cf_rule_operator_last_month`、`cf_rule_operator_tomorrow`、`cf_rule_operator_next_week`、`cf_rule_operator_next_month`、`cf_rule_operator_this_month`、`cf_rule_operator_duplicate_values`、`cf_rule_operator_unique_values`、`cf_rule_operator_blanks_condition`、`cf_rule_operator_no_blanks_condition`、`cf_rule_operator_errors`、`cf_rule_operator_no_errors`、`cf_rule_operator_top10`、`cf_rule_operator_top10_percent`、`cf_rule_operator_last10`、`cf_rule_operator_last10_percent`、`cf_rule_operator_above_average`、`cf_rule_operator_below_average`
  - `priority` (integer, 非必填)：优先级，由查询的条件格式信息返回。修改用到 id 和 priority 二选一定位删除；如果 id 和 priority 都传，以 id 为准
  - `ranges` (array[object], 必填)：条件格式范围列表
    - `col_from` (integer, 必填)：列起始索引位置
    - `col_to` (integer, 必填)：列最后索引位置
    - `row_from` (integer, 必填)：行起始索引位置
    - `row_to` (integer, 必填)：行最后索引位置
  - `rank` (string, 必填)：排名值，仅当条件格式类型为 `cf_rule_type_rank_average` 时需要传
  - `xf` (object, 必填)：格式信息
    - `alc_h` (integer, 非必填)：水平对齐
    - `alc_v` (integer, 非必填)：垂直对齐
    - `clr_bottom` / `clr_diag_down` / `clr_diag_up` / `clr_inside_horz` / `clr_inside_vert` / `clr_left` / `clr_right` / `clr_top` (object, 非必填)：边框颜色对象，均包含 `tint`(integer, 必填)、`type`(integer, 必填)、`value`(integer, 必填)
    - `dg_bottom` / `dg_diag_down` / `dg_diag_up` / `dg_inside_horz` / `dg_inside_vert` / `dg_left` / `dg_right` / `dg_top` (integer, 非必填)：对应边框线型
    - `fill` (object, 非必填)：填充
      - `back` (object, 必填)：背景色，包含 `tint`、`type`、`value`
      - `fore` (object, 必填)：前景色，包含 `tint`、`type`、`value`
      - `type` (integer, 必填)：填充类型
    - `font` (object, 非必填)：字体
      - `bls` (boolean, 非必填)：粗体
      - `char_set` (integer, 非必填)：字符集
      - `color` (object, 非必填)：颜色，包含 `tint`、`type`、`value`
      - `dy_height` (integer, 非必填)：字体高度（单位 Twip）
      - `italic` (boolean, 非必填)：斜体
      - `name` (string, 非必填)：字体名称
      - `sss` (integer, 非必填)：上下标类型
      - `strikeout` (boolean, 非必填)：删除线
      - `theme_font` (integer, 非必填)：字体类型
      - `uls` (integer, 非必填)：下划线类型
    - `hidden` (boolean, 非必填)：隐藏公式
    - `indent` (integer, 非必填)：缩进
    - `locked` (boolean, 非必填)：锁定单元格
    - `mask_cats` (integer, 非必填)：掩码
    - `mask_cats_font` (integer, 非必填)：掩码字体
    - `numfmt` (string, 非必填)：数字格式
    - `reading_order` (integer, 非必填)：文字方向
    - `shrink_to_fit` (boolean, 非必填)：缩小字体填充
    - `trot` (integer, 非必填)：文字旋转
    - `wrap` (boolean, 非必填)：自动换行

**请求体示例：**

```json
{
  "rule": {
    "cf_rule_type": "cf_rule_type_value_range",
    "formula1": "string",
    "formula2": "string",
    "id": 0,
    "lastone": true,
    "operator": "cf_rule_operator_greater",
    "priority": 0,
    "ranges": [
      {
        "col_from": 0,
        "col_to": 0,
        "row_from": 0,
        "row_to": 0
      }
    ],
    "rank": "string",
    "xf": {
      "alc_h": 0,
      "alc_v": 0,
      "clr_bottom": { "tint": 0, "type": 0, "value": 0 },
      "clr_diag_down": { "tint": 0, "type": 0, "value": 0 },
      "clr_diag_up": { "tint": 0, "type": 0, "value": 0 },
      "clr_inside_horz": { "tint": 0, "type": 0, "value": 0 },
      "clr_inside_vert": { "tint": 0, "type": 0, "value": 0 },
      "clr_left": { "tint": 0, "type": 0, "value": 0 },
      "clr_right": { "tint": 0, "type": 0, "value": 0 },
      "clr_top": { "tint": 0, "type": 0, "value": 0 },
      "dg_bottom": 0,
      "dg_diag_down": 0,
      "dg_diag_up": 0,
      "dg_inside_horz": 0,
      "dg_inside_vert": 0,
      "dg_left": 0,
      "dg_right": 0,
      "dg_top": 0,
      "fill": {
        "back": { "tint": 0, "type": 0, "value": 0 },
        "fore": { "tint": 0, "type": 0, "value": 0 },
        "type": 0
      },
      "font": {
        "bls": true,
        "char_set": 0,
        "color": { "tint": 0, "type": 0, "value": 0 },
        "dy_height": 0,
        "italic": true,
        "name": "string",
        "sss": 0,
        "strikeout": true,
        "theme_font": 0,
        "uls": 0
      },
      "hidden": true,
      "indent": 0,
      "locked": true,
      "mask_cats": 0,
      "mask_cats_font": 0,
      "numfmt": "string",
      "reading_order": 0,
      "shrink_to_fit": true,
      "trot": 0,
      "wrap": true
    }
  }
}
```


#### 返回值说明

```json
{}

```


---

## 3. sheet.update_conditional_format_rules

#### 功能说明

更新现有条件格式规则。

适用于调整判断条件、作用区域或命中后的显示样式。



#### 操作约束

- **前置检查**：先 get_conditional_format_rules 获取现有规则 ID

**幂等性**：是

> 若需要批量清除某些区域的条件格式，请改用 `sheet.delete_conditional_format_rules`

#### 调用示例

更新高亮规则：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "rule": {
    "id": "cf_1",
    "type": "cell_value",
    "ranges": [
      {
        "row_from": 1,
        "row_to": 100,
        "col_from": 3,
        "col_to": 3
      }
    ],
    "format": {
      "fill": {
        "color": "#FDE9D9"
      }
    }
  }
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `rule` (object, 必填): 条件格式规则对象

更新时建议在 `rule` 中保留已有规则标识，并以 `sheet.get_conditional_format_rules` 返回的结构为准进行修改。


#### 返回值说明

```json
{}

```


---

## 4. sheet.delete_conditional_format_rules

#### 功能说明

删除指定区域上的条件格式规则。

适用于清理已有高亮、色阶或其他自动格式规则。



#### 操作约束

- **前置检查**：`sheet.get_conditional_format_rules` 确认拟删规则与目标区域
- **用户确认**：删除条件格式规则不可恢复，必须向用户确认

**幂等性**：是

#### 调用示例

删除指定列的条件格式：

```json
{
  "file_id": "string",
  "worksheet_id": 7,
  "ranges": [
    {
      "row_from": 1,
      "row_to": 100,
      "col_from": 3,
      "col_to": 3
    }
  ]
}
```


#### 参数说明

- `file_id` (string, 必填): 文件 ID
- `worksheet_id` (integer, 必填): 工作表 ID
- `ranges` (array[object], 必填): 待清除条件格式的区域列表

#### 返回值说明

```json
{}

```


---


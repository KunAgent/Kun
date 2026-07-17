---
name: table-beautify
description: "对在线表格（.xlsx / .ksheet）进行格式化、样式调整与数据美化操作。可浏览目录定位目标表格文件。 当用户要求「美化表格」、「格式化表格」、「调整表格样式」、「表格排版」时使用。 若需要新建表格并写入数据，请使用 form-generator 或 jielong-table 技能。
"
homepage: 
version: 1.5.7
---

# 一键表格美化

一键表格美化技能支持快速调整表格格式和样式。

> 本技能依赖 `kdocs` 技能的基础文档操作能力（认证、文件管理等），请确保已安装该技能。详见 `references/core/` 目录。

---

## 能力范围

### 通用工具总览

#### 文档创建与上传
| 工具 | 用途 |
|------|------|
| [`create_file`](references/drive/create_and_upload.md) | 在云盘下新建文件 |
| [`scrape_url`](references/drive/create_and_upload.md) | 网页剪藏，抓取网页内容并自动保存为智能文档 |
| [`scrape_progress`](references/drive/create_and_upload.md) | 查询网页剪藏任务进度 |
| [`upload_file`](references/drive/create_and_upload.md) | 全量上传写入文件（更新已有 docx/pdf 或新建并上传本地文件） |

#### 文档读取与下载
| 工具 | 用途 |
|------|------|
| [`list_files`](references/drive/read_and_download.md) | 获取指定文件夹下的子文件列表 |
| [`download_file`](references/drive/read_and_download.md) | 获取文件下载信息 |
| [`read_file`](references/drive/read_and_download.md) | 读取文档内容为 Markdown/结构化数据 |

#### 文件组织
| 工具 | 用途 |
|------|------|
| [`move_file`](references/drive/organize.md) | 批量移动文件(夹) |
| [`rename_file`](references/drive/organize.md) | 重命名文件（夹） |

#### 分享与访问
| 工具 | 用途 |
|------|------|
| [`share_file`](references/drive/share.md) | 开启文件分享 |
| [`set_share_permission`](references/drive/share.md) | 修改分享链接属性 |
| [`cancel_share`](references/drive/share.md) | 取消文件分享 |
| [`get_share_info`](references/drive/share.md) | 获取分享链接信息 |
| [`get_file_link`](references/drive/share.md) | 获取文件的云文档在线访问链接 |

#### 搜索
| 工具 | 用途 |
|------|------|
| [`search_files`](references/drive/search.md) | 文件（夹）搜索 |

#### 工作表管理
| 工具 | 用途 |
|------|------|
| [`sheet.get_sheets_info`](references/sheet/worksheet.md) | 获取工作表列表 |

#### 数据操作
| 工具 | 用途 |
|------|------|
| [`sheet.get_range_data`](references/sheet/data.md) | 获取选区数据 |
| [`sheet.update_range_data`](references/sheet/data.md) | 批量更新选区数据 |

#### 条件格式
| 工具 | 用途 |
|------|------|
| [`sheet.get_conditional_format_rules`](references/sheet/conditional_format.md) | 获取条件格式规则 |
| [`sheet.create_conditional_format_rules`](references/sheet/conditional_format.md) | 创建条件格式规则 |
| [`sheet.update_conditional_format_rules`](references/sheet/conditional_format.md) | 更新条件格式规则 |
| [`sheet.delete_conditional_format_rules`](references/sheet/conditional_format.md) | 删除条件格式规则 |

#### 数据校验
| 工具 | 用途 |
|------|------|
| [`sheet.get_data_validations`](references/sheet/data_validations.md) | 获取数据校验规则 |
| [`sheet.create_data_validations`](references/sheet/data_validations.md) | 创建数据校验规则 |
| [`sheet.update_data_validations`](references/sheet/data_validations.md) | 更新数据校验规则 |
| [`sheet.delete_data_validations`](references/sheet/data_validations.md) | 删除数据校验规则 |

#### 区域权限
| 工具 | 用途 |
|------|------|
| [`sheet.list_protection_ranges`](references/sheet/protection_ranges.md) | 获取区域权限列表 |
| [`sheet.create_protection_ranges`](references/sheet/protection_ranges.md) | 创建区域权限 |
| [`sheet.update_protection_ranges`](references/sheet/protection_ranges.md) | 批量更新区域权限 |
| [`sheet.delete_protection_ranges`](references/sheet/protection_ranges.md) | 批量删除区域权限 |

### 详细参考

| 文档类型 | 参考文件 | 说明 |
|----------|----------|------|
| 表格文档/智能表格（xlsx & ksheet） | `references/sheet_references.md` | 工作表管理、范围数据获取、批量更新 |

---

## 操作指南

### 通用操作路由

| 意图 | 路由 |
|------|------|
| 读取文档内容 | `read_file`（统一入口，按后缀自动返回 Markdown 或结构化数据） |
| 创建/写入 | `create_file_with_content`（统一入口，新建文档并写入内容，返回 link_url） |
| 局部更新 | 改块/改段/改单元格，已有目标文档上的修改 → 按「支持的文档类型」→ 对应 reference |
| 类型专属能力 | 条件格式、导出转换、翻译、PDF 拆分、幻灯片主题、数据校验 | 按「支持的文档类型」→ 对应 reference 中的专属功能章节 |
| 获取文件标识指南 | **必读** `references/file-locating-guide.md` |

### 高频流程指引

#### 表格美化与数据规范

> 🎯 **核心原则**：美化 = 格式修正（`update_range_data`）+ 规则固化（条件格式 / 数据校验 / 区域权限）。仅写入数据而不固化规则，后续录入仍会再次混乱。

**步骤 1**：定位表格
- 用户给文件名 → `search_files(keyword="表格名")`
- 用户给链接 → 解析 `link_id` → `get_share_info`

**步骤 2**：读取表格结构和数据
```
sheet.get_sheets_info(file_id) → 获取 sheetId、数据区域 rowTo/colTo
sheet.get_range_data(file_id, worksheet_id=sheetId, row_from=0, row_to=rowTo, col_from=0, col_to=colTo) → 读取全部数据
```

**步骤 3**：AI 分析数据问题，识别列类型，生成美化与规范方案

列类型识别结果决定后续操作：
- 枚举列（状态、分类、优先级等）→ 需要创建数据校验（下拉列表）
- 数值/日期列 → 需要创建条件格式（高亮异常或超阈值数据）
- 表头行 / 公式列 → 可选创建区域权限（防误改）

**步骤 4**：格式美化（`update_range_data`）

**格式美化**（字体、颜色、对齐、边框）：
```
sheet.update_range_data(file_id, worksheet_id=sheetId, range_data=[
  {op_type: "cell_operation_type_format", row_from, row_to, col_from, col_to, xf: {font: {...}, alc_h: 2, fill: {...}, dg_bottom: 1, ...}}
])
```

**表头规范**（重写列名）：
```
sheet.update_range_data(file_id, worksheet_id=sheetId, range_data=[
  {op_type: "cell_operation_type_formula", row_from: 0, row_to: 0, col_from: 0, col_to: 0, formula: "新列名"}
])
```

**数据格式统一**（如统一手机号、日期格式）：
```
sheet.update_range_data(file_id, worksheet_id=sheetId, range_data=[
  {op_type: "cell_operation_type_formula", row_from: r, row_to: r, col_from: c, col_to: c, formula: "规范化后的值"}
])
```

**合并单元格**：
```
sheet.update_range_data(file_id, worksheet_id=sheetId, range_data=[
  {op_type: "cell_operation_type_merge", row_from, row_to, col_from, col_to, merge_type: "merge_type_center"}
])
```

**数据去重（模拟删行）**：
由于没有直接的删行 API，通过「读取 → 本地去重 → 全量覆盖 → 清空多余行」实现：
1. `get_range_data` 读取包含可能重复数据的所有行（如 100 行）
2. AI 在本地识别并剔除重复行，得到去重后的数据（如 80 行）
3. `update_range_data` 将去重后的 80 行覆盖写入表格顶部（`row_from: 0` 到 `row_to: 79`）
4. `update_range_data`（`op_type: "cell_operation_type_formula"`, `formula: ""`）将底部多余的 20 行（`row_from: 80` 到 `row_to: 99`）清空

**步骤 5**：条件格式（高亮异常值）

适用场景：数值列超阈值高亮、日期列逾期标红、重复值标黄、空值警示。

**高亮数值超阈值**（如金额 > 10000 标红）：
```
sheet.create_conditional_format_rules(file_id, worksheet_id=sheetId, rule={
  cf_rule_type: "cf_rule_type_value_range",
  operator: "cf_rule_operator_greater",
  formula1: "10000",
  ranges: [{row_from: 1, row_to: rowTo, col_from: colIdx, col_to: colIdx}],
  xf: {fill: {back: {type: 1, value: 0xFF4444, tint: 0}, fore: {type: 0, value: 0, tint: 0}, type: 1}},
  lastone: false
})
```

**高亮重复值**：
```
sheet.create_conditional_format_rules(file_id, worksheet_id=sheetId, rule={
  cf_rule_type: "cf_rule_type_value_range",
  operator: "cf_rule_operator_duplicate_values",
  formula1: "",
  ranges: [{row_from: 1, row_to: rowTo, col_from: colIdx, col_to: colIdx}],
  xf: {fill: {back: {type: 1, value: 0xFFFF00, tint: 0}, fore: {type: 0, value: 0, tint: 0}, type: 1}},
  lastone: false
})
```

> 调用前先用 `sheet.get_conditional_format_rules` 检查是否已存在同列规则，避免冲突叠加。

**步骤 6**：数据校验（枚举列固化下拉选项）

适用场景：状态列、分类列、优先级列等取值固定的枚举列，加下拉约束后录入时只能选择预设选项。

```
sheet.create_data_validations(file_id, worksheet_id=sheetId,
  field_type: "List",
  args: {
    list_items: [{value: "待处理"}, {value: "进行中"}, {value: "已完成"}],
    validation_error_title: "输入不合法",
    validation_error_text: "请从下拉列表中选择"
  },
  range: {col_from: colIdx, col_to: colIdx, row_from: 1, row_to: 1048575}  // row_to=1048575 表示整列
)
```

> 行列索引均为 0-based。设置整列校验时 `row_to` 传 `1048575`。

**步骤 7（可选）**：区域权限（锁定表头 / 公式区域）

适用场景：用户明确要求保护表头行或特定公式区域不被他人误改时执行，**执行前必须向用户确认**。

```
sheet.create_protection_ranges(file_id, sheets_protection_infos=[{
  master_id: currentUserId,          // 当前操作用户 ID
  worksheet_id: sheetId,
  other_user_permission: "user_access_permission_visible",
  protection_infos: [{
    others_access_permission: "others_access_permission_visible",  // 他人只读
    protection_ranges: [{column_from: 0, column_to: colTo, row_from: 0, row_to: 0}],  // 第 0 行（表头）
    protection_user_data: [],
    range_creator_id: currentUserId
  }]
}])
```

> 该能力同时支持智能表格（.ksheet）和普通表格（.xlsx）；智能表格的 `other_user_permission` 仅支持 `user_access_permission_editable`。执行前询问用户是否需要锁定、锁定哪些区域。

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`sheet.delete_sheets`、`sheet.delete_range_data`、`cancel_share`、`sheet.delete_protection_ranges`、`sheet.delete_data_validations`、`sheet.delete_conditional_format_rules`、`sheet.delete_float_images`、`sheet.delete_filters`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 用户要求优化、美化或规范表格的格式和数据，或需要为表格添加输入约束、高亮规则 | `search_files` → `sheet.get_sheets_info` → `sheet.get_range_data` → AI 分析 → `sheet.update_range_data`（格式化/规范化）→ `sheet.create_conditional_format_rules`（高亮异常值）→ `sheet.create_data_validations`（下拉约束）→ `sheet.create_protection_ranges`（锁定区域，可选） |

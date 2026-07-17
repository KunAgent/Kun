# 表格文档/智能表格（xlsx & ksheet）工具完整参考文档

本文件包含金山文档 Skill 中表格相关工具的完整 API 说明、详细调用示例、参数说明和返回值说明。

**适用范围**：本文档中的所有 `sheet.*` 工具同时适用于 Excel（.xlsx）和智能表格（.ksheet）。

---

### 表格工具概述

表格工具专门用于操作金山文档中的在线表格，提供工作表信息的查询、范围数据的获取以及批量更新等功能。支持两种表格类型：

- **Excel（.xlsx）**：传统在线表格
- **智能表格（.ksheet）**：高级结构化表格

### 新建并写入

新建表格并写入 → `create_file_with_content`：`name` 后缀 `.xlsx` 或 `.ksheet`，传 `rangeData`（单表、≤500 项；参数与失败补写见 `drive/create_file_with_content`）。

```json
{
  "name": "销售数据表.xlsx",
  "rangeData": [
    {
      "row_from": 0,
      "row_to": 0,
      "col_from": 0,
      "col_to": 2,
      "formula": [["姓名", "部门", "金额"]]
    }
  ]
}
```

### 写入/更新已有表格

批量改单元格、筛选、条件格式等 → 下文 `sheet.*` 与「工具组合速查」。精读区域用 `sheet.get_range_data`；概览首读可用 `read_file`（可选 `sheet_name`、`sheet_range`）。定位目标文件见 `file-locating-guide`。

### Excel vs 智能表格（ksheet）对比

| 特性 | Excel | 智能表格 ksheet |
|------|-------|----------------|
| 数据组织 | 传统行列表格 | 结构化字段+记录 |
| 视图 | 单一表格视图 | 多视图（表格/看板/日历/甘特图等） |
| 字段类型 | 通用单元格 | 丰富字段类型（单选/多选/日期/附件/关联等） |
| 适用场景 | 数据计算、报表、财务报表 | 项目管理、CRM、任务跟踪、库存管理 |
| 工作表/数据接口 | 使用 `sheet.*` 工具 | **同样使用 `sheet.*` 工具** |

### 使用场景

#### Excel 适用场景

| 场景 | 说明 |
|------|------|
| 数据记录 | 销售数据、财务报表 |
| 数据分析 | 结构化数据的读取与处理 |
| 报表汇总 | 多维度数据汇总 |
| 公式计算 | 需要复杂公式和数据透视 |

#### 智能表格 适用场景

| 场景 | 说明 |
|------|------|
| 项目管理 | 任务分配、进度跟踪 |
| CRM 管理 | 客户信息、跟进记录 |
| 资产管理 | 库存台账、设备管理 |
| 审批台账 | 合同风险排查台账等 |

### 类型选择建议

- 需要公式计算、数据透视 → 选 **Excel**
- 需要多视图、字段管理、看板展示 → 选 **ksheet**
- 需要做任务管理/项目跟踪 → 选 **ksheet**
- 需要做财务报表 → 选 **Excel**

> **注意**：`ksheet` 文件创建完成后，和 Excel 一样继续使用 `sheet.*` 接口做工作表管理与数据操作。

### 表格增强能力

除基础的工作表管理与区域读写外，智能表格（.ksheet）和普通Excel（.xlsx）还支持以下增强能力：

- **区域权限**：可通过 `sheet.list_protection_ranges`、`sheet.create_protection_ranges`、`sheet.update_protection_ranges`、`sheet.delete_protection_ranges` 管理指定区域的访问或编辑限制
- **数据校验**：可通过 `sheet.get_data_validations`、`sheet.create_data_validations`、`sheet.update_data_validations`、`sheet.delete_data_validations` 配置下拉选项和输入约束
- **条件格式**：可通过 `sheet.get_conditional_format_rules`、`sheet.create_conditional_format_rules`、`sheet.update_conditional_format_rules`、`sheet.delete_conditional_format_rules` 管理自动高亮和格式规则
- **浮动图片**：可通过 `sheet.list_float_images`、`sheet.get_float_image`、`sheet.create_float_images`、`sheet.update_float_images`、`sheet.delete_float_images` 管理工作表中的浮动图片
- **筛选与工作表编排**：可通过 `sheet.get_filters`、`sheet.open_filters`、`sheet.update_filters`、`sheet.delete_filters` 管理筛选状态，并通过 `sheet.copy_worksheet`、`sheet.update_worksheet` 复制、重命名或移动工作表

> **补充说明**：上述增强能力可同时面向智能表格（.ksheet）和普通 Excel（.xlsx）。

---

## 一、工作表管理

> 智能表格/Excel 工作表的创建、获取、复制、重命名、删除

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`sheet.get_sheets_info`](sheet/worksheet.md) | 获取工作表列表 | `file_id` |
| [`sheet.add_sheet`](sheet/worksheet.md) | 新增工作表 | `file_id` |
| [`sheet.update_sheet`](sheet/worksheet.md) | 更新工作表 | `file_id`, `worksheet_id` |
| [`sheet.delete_sheets`](sheet/worksheet.md) | 删除工作表 | `file_id` |
| [`sheet.copy_worksheet`](sheet/worksheet.md) | 复制工作表 | `file_id`, `worksheet_id` |
| [`sheet.update_worksheet`](sheet/worksheet.md) | 更新工作表名称或位置 | `file_id`, `worksheet_id` |

## 二、数据操作

> 区域数据读写、新增行、删除区域、单条记录检索与附件下载

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`sheet.get_range_data`](sheet/data.md) | 获取选区数据 | `file_id`, `sheetId`, `range` |
| [`sheet.update_range_data`](sheet/data.md) | 批量更新选区数据 | `file_id`, `sheetId`, `rangeData` |
| [`sheet.delete_range_data`](sheet/data.md) | 删除行或列 | `file_id`, `worksheet_id`, `range_data` |
| [`sheet.add_row`](sheet/data.md) | 追加一行数据 | `file_id`, `worksheet_id` |
| [`sheet.find_range_data`](sheet/data.md) | 遍历筛选记录（支持分页与条件） | `file_id`, `worksheet_id`, `range`, `filter` |
| [`sheet.get_attachment_url`](sheet/data.md) | 上传附件到文件 | `file_id`, `filename`, `url`\|`file`, `Content-Type` |

## 三、筛选

> 筛选状态的开启、获取、更新、删除

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`sheet.get_filters`](sheet/filters.md) | 获取筛选条件 | `file_id`, `worksheet_id` |
| [`sheet.open_filters`](sheet/filters.md) | 开启工作表筛选 | `file_id`, `worksheet_id`, `expand_filter_range`, `range` |
| [`sheet.update_filters`](sheet/filters.md) | 更新列筛选条件 | `file_id`, `worksheet_id`, `col`, `condition` |
| [`sheet.delete_filters`](sheet/filters.md) | 删除工作表筛选 | `file_id`, `worksheet_id` |

## 四、条件格式

> 条件格式规则的增删改查

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`sheet.get_conditional_format_rules`](sheet/conditional_format.md) | 获取条件格式规则 | `file_id`, `worksheet_id` |
| [`sheet.create_conditional_format_rules`](sheet/conditional_format.md) | 创建条件格式规则 | `file_id`, `worksheet_id`, `rule` |
| [`sheet.update_conditional_format_rules`](sheet/conditional_format.md) | 更新条件格式规则 | `file_id`, `worksheet_id`, `rule` |
| [`sheet.delete_conditional_format_rules`](sheet/conditional_format.md) | 删除条件格式规则 | `file_id`, `worksheet_id`, `ranges` |

## 五、数据校验

> 下拉选项与输入约束的增删改查

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`sheet.get_data_validations`](sheet/data_validations.md) | 获取数据校验规则 | `file_id`, `worksheet_id`, `col_from`, `col_to`, `row_from`, `row_to` |
| [`sheet.create_data_validations`](sheet/data_validations.md) | 创建数据校验规则 | `file_id`, `worksheet_id`, `args`, `field_type`, `range` |
| [`sheet.update_data_validations`](sheet/data_validations.md) | 更新数据校验规则 | `file_id`, `worksheet_id`, `args`, `field_type`, `range` |
| [`sheet.delete_data_validations`](sheet/data_validations.md) | 删除数据校验规则 | `file_id`, `worksheet_id`, `range` |

## 六、区域权限

> 区域访问/编辑权限的增删改查

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`sheet.list_protection_ranges`](sheet/protection_ranges.md) | 获取区域权限列表 | `file_id`, `worksheet_id` |
| [`sheet.create_protection_ranges`](sheet/protection_ranges.md) | 创建区域权限 | `file_id`, `sheets_protection_infos` |
| [`sheet.update_protection_ranges`](sheet/protection_ranges.md) | 批量更新区域权限 | `file_id`, `sheets_protection_infos` |
| [`sheet.delete_protection_ranges`](sheet/protection_ranges.md) | 批量删除区域权限 | `file_id`, `sheets_protection_infos` |

## 七、浮动图片

> 浮动图片的增删改查与详情

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`sheet.list_float_images`](sheet/float_images.md) | 查询浮动图片列表 | `file_id`, `worksheet_id` |
| [`sheet.get_float_image`](sheet/float_images.md) | 获取单张浮动图片详情 | `file_id`, `worksheet_id`, `float_image_id` |
| [`sheet.create_float_images`](sheet/float_images.md) | 创建浮动图片 | `file_id`, `worksheet_id`, `sheet_id`, `tag`, `x_pos`, `y_pos` |
| [`sheet.update_float_images`](sheet/float_images.md) | 更新浮动图片位置或尺寸 | `file_id`, `worksheet_id`, `float_image_id` |
| [`sheet.delete_float_images`](sheet/float_images.md) | 删除浮动图片 | `file_id`, `worksheet_id`, `float_image_id` |

### `sheet.find_range_data` 与 `sheet.get_range_data`的区别

| 对比项 | `sheet.find_range_data` | `sheet.get_range_data` |
|--------|-------------------------|------------------------|
| 核心用途 | 先筛选再返回命中数据 | 直接读取固定矩形范围数据 |
| 是否支持筛选条件 | 支持（`filter.condition`） | 不支持 |
| 是否支持搜索 | 支持（`filter.search`） | 不支持 |
| 是否支持去重 | 支持（`filter.duplicates`） | 不支持 |
| 是否支持分页 | 支持（`page.page` / `page.page_size`） | 不支持（一次返回范围内数据） |
| 是否可返回总数 | 支持（`show_total`） | 不支持 |
| 典型场景 | 大范围检索、按条件过滤、统计候选结果 | 精准读取已知区域（如 A1:F100） |
| 推荐使用时机 | 你只知道业务条件（例如“状态=已完成且金额>1000”），不知道具体行号，或结果很多需要分页浏览时 | 你已经知道要读的确切区域（例如 A1:F100），目标是快速拿到原始区域数据时 |

快速决策：**先确认用户意图是否需要筛选/搜索/去重/分页**。需要就用 `sheet.find_range_data`；不需要且范围已知就用 `sheet.get_range_data`。

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 新建表格并写入初稿 | 见 SKILL「创建/写入」 |
| 表格概览/首读 | `read_file`（可选 `sheet_name`、`sheet_range`） |
| 读表格（矩形区域，精读/校验） | `sheet.get_sheets_info` → `sheet.get_range_data` |
| 写表格（批量改单元格） | `sheet.get_range_data`（可选对照）→ `sheet.update_range_data` → `sheet.get_range_data` 验证 |
| 给某列配置下拉选项 | `sheet.get_data_validations`（可选）→ `sheet.create_data_validations` / `sheet.update_data_validations` |
| 管理条件格式高亮 | `sheet.get_conditional_format_rules` → `sheet.create_conditional_format_rules` / `sheet.update_conditional_format_rules` / `sheet.delete_conditional_format_rules` |
| 管理区域权限 | `sheet.list_protection_ranges` → `sheet.create_protection_ranges` / `sheet.update_protection_ranges` / `sheet.delete_protection_ranges` |
| 管理表格筛选 | `sheet.get_filters` → `sheet.open_filters` / `sheet.update_filters` / `sheet.delete_filters` |
| 插入并调整浮动图片 | `sheet.create_float_images` → `sheet.get_float_image` / `sheet.update_float_images` |

---

## 错误速查表

| 错误特征 | 原因 | 处理方式 |
|----------|------|----------|
| 表格读不到或结构不明 | 未先取工作表列表 / 区域错误 | 先 `sheet.get_sheets_info`，再 `sheet.get_range_data` |
| 智能表格增强配置不生效 | 使用了普通 Excel，或未先读取现有配置结构 | 确认文件为 `.ksheet`，并先调用对应的 `get/list` 工具查看当前结构 |

---

## 附录

### 错误响应

| 情况 | 响应示例 |
|------|---------|
| 命令不支持 | `{"msg":"core not support","result":"unSupport"}` |
| 内核错误 | `{"errno":-1880935404,"msg":"Invalid request","result":"ExecuteFailed"}` |
| HTTP 状态非 200 | 请求本身失败，检查鉴权信息（Cookie/Origin） |

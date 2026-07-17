# databrain-datalab-analyst图表类型与 `data` 字段结构完整映射

> 本文件是 databrain-datalab-analyst/SKILL.md 的详细参考。Agent 在需要解析具体图表数据时按需加载此文件。

---

## 基础字段（所有图表共有）

| 基础字段 | 类型 | 说明 |
|----------|------|------|
| `metrics` | string[] | 指标名列表（中文） |
| `metrics_en` | string[] | 指标名列表（英文） |
| `column_name` | object[] | 列定义（含 `name`/`name_en`/`column_type`） |
| `count` | int | 数据行数 |
| `actual_count` | int | 实际行数 |
| `granularity` | string | 时间粒度（日/周/月） |

---

## 各图表类型详细字段结构

### LineChart（折线图）

核心数据字段：`line_chart`

```json
{
  "line_chart": {
    "x_axis_data": ["2026-01-01", "2026-01-02", ...],
    "series_data": [
      {
        "name": "指标名",
        "metric": "原始字段名",
        "data": ["100", "200", "300"],
        "type": "line",
        "valueType": "number",
        "yAxisIndex": 0,
        "dimensions": "维度分组值（有子分组时出现）",
        "is_compare": false
      }
    ]
  }
}
```

**取值**：`series_data[].data[]` 与 `x_axis_data[]` 一一对应。

---

### Table（表格）

核心数据字段：`table_data`

```json
{
  "table_data": [
    {
      "列名1": {"value": "实际值", "change": "+5%", "value_type": "number", "is_statistics": false},
      "列名2": {"value": "xxx", ...}
    },
    ...
  ]
}
```

**取值**：每行是一个 map，取值用 `.value` 字段。

---

### BarChart（柱状图）

核心数据字段：`bar_charts`

```json
{
  "bar_charts": {
    "x_axis_data": [...],
    "series_data": [{"name": "...", "data": [...]}],
    "y_axis": [{"name": "..."}]
  }
}
```

---

### BigNumberChart（数字卡片）

核心数据字段：`big_number_chart` + `big_number_charts`

```json
{
  "big_number_chart": {
    "date": "2026-01-01",
    "value": "12345",
    "control_name_cn": "指标名",
    "time_comparisons": [
      {"name_cn": "环比", "date": "2025-12-31", "value": "12000", "percent": "+2.88%"}
    ]
  },
  "big_number_charts": [...]  // 多值时为数组
}
```

---

### StackBarChart（堆叠柱状图）

核心数据字段：`stack_bar_chart` + `table_data`

```json
{
  "stack_bar_chart": {
    "x_axis_data": [...],
    "series_data": [...]
  },
  "table_data": [...]  // 辅助表格
}
```

---

### PercentStackBarChart（百分比堆叠图）

核心数据字段：`percent_stack_bar_chart` + `table_data`

结构同 StackBarChart。

---

### PieChart（饼图）

核心数据字段：`chart_sum_data` + `table_data`

```json
{
  "chart_sum_data": [
    {
      "指标名": [
        {"name": "分类A", "data": "100", "percentage": "40%", "icon": "..."},
        null,  // ⚠️ 可能为 None！
        {"name": "分类B", "data": "150", "percentage": "60%"}
      ]
    }
  ]
}
```

> ⚠️ **数组元素可能为 `None`，遍历时必须 `if item is not None` 过滤！**

---

### EventLineChart（事件折线图）

核心数据字段：`event_line_chart` + `event_list` + `table_data`

```json
{
  "event_line_chart": {
    "x_axis_data": [...],
    "series_data": [...]
  },
  "event_list": [...],  // 事件标记
  "table_data": [...]
}
```

---

### HorizontalBarChart（横向柱状图）

核心数据字段：`horizontal_bar_charts` + `table_data`

```json
{
  "horizontal_bar_charts": [
    {
      "yAxis": ["类别A", "类别B", ...],
      "series": [{"name": "...", "data": [...]}]
    }
  ]
}
```

---

### TrendChart（趋势卡片）

核心数据字段：`trend_metric` + `line_chart`

```json
{
  "trend_metric": {
    "value": "12345",
    "dod": "+2.5%",    // 日环比
    "wow": "-1.2%",    // 周同比
    ...
  },
  "line_chart": {
    "x_axis_data": [...],
    "series_data": [...]
  }
}
```

---

### MixedChart（组合图）

核心数据字段：`mixed_chart`

```json
{
  "mixed_chart": {
    "x_axis_data": [...],
    "series_data": [{"name": "...", "data": [...], "type": "line/bar"}],
    "y_axis": [{"name": "..."}]
  }
}
```

---

### Map（地图）

核心数据字段：`map_charts` + `table_data`

```json
{
  "map_charts": [
    {
      "metric": "...",
      "value_type": "...",
      "min": 0,
      "max": 1000,
      "map_chart_value": [
        {"code": "US", "name_en": "United States", "name_zh": "美国", "value": "500", "percent": "25%"}
      ]
    }
  ]
}
```

---

### WordCloud（词云）

核心数据字段：`word_cloud`

```json
{
  "word_cloud": {
    "data": [
      {"维度字段": "词语A", "指标字段": 100},
      ...
    ],
    "metric_info": [{"metric": "...", "max": 100, "min": 1, "value_type": "number"}]
  }
}
```

---

### DimTrend（分维度趋势）

核心数据字段：`trend_metric` + `line_chart` + `dimension` + `last_date_dimension`

```json
{
  "trend_metric": {...},
  "line_chart": {...},
  "dimension": {
    "valueType": "...",
    "total": 1000,
    "series": [
      {"name": "维度A", "data": 500, "percentage": "50%"}
    ],
    "xAxis": [...]
  },
  "last_date_dimension": {...}
}
```

---

## Series 通用结构

折线图/柱状图/堆叠图/事件折线图/组合图共用：

```json
{
  "name": "指标名",
  "metric": "原始字段名",
  "type": "line/bar",
  "valueType": "number/percent/...",
  "data": ["100", "200", "300"],
  "yAxisIndex": 0,
  "dimensions": "维度分组值（有子分组时出现）",
  "is_compare": false
}
```

---

## 关键提取规则速查

| 图表类型 | 数据路径 | 注意事项 |
|---------|---------|---------|
| 折线图/柱状图/堆叠图 | `series_data[].data[]`，X轴 `x_axis_data[]` | 一一对应 |
| 表格 | `table_data[]`，每行 `{列名: {value: "值"}}` | 取 `.value` |
| 数字卡片 | `big_number_chart.value`，对比 `time_comparisons[]` | |
| 饼图 | `chart_sum_data[0].指标名[]` | ⚠️ 必须 `if item is not None` |
| 地图 | `map_charts[].map_chart_value[]` | 有 `code`/`name_zh`/`value` |
| 词云 | `word_cloud.data[]` | 每项是 `{维度: 值, 指标: 值}` |
| 趋势卡片 | `trend_metric`(大数字) + `line_chart`(趋势) | `dod`/`wow` 环比同比 |

---

## 各图表类型专属展示模式

| 图表类型 | 核心指标表 | 近期走势表 | 额外展示 |
|---------|:---------:|:---------:|---------|
| Table | ✅ | ✅ 直接展示原始表格 | — |
| LineChart | ✅ 最新值+环比 | ✅ 行=指标，列=日期 | 走势解读 |
| BarChart | ✅ TopN 数值 | ✅ 排名表 | 排名解读 |
| BigNumberChart | ✅ 核心数字+对比 | — | 环比/同比变化描述 |
| StackBarChart | ✅ 各组成最新占比 | ✅ 分组趋势表 | 占比变化解读 |
| PieChart | ✅ 各分类占比 | — | 占比排名描述 |
| TrendChart | ✅ 大数字+环比/同比 | ✅ 趋势线数据表 | 变化趋势解读 |
| MixedChart | ✅ 按 series type | ✅ 混合趋势表 | 多维度关联分析 |
| Map | ✅ TopN 地区排名 | — | 地区分布描述 |
| WordCloud | ✅ 高频词 TopN | — | 词频分布描述 |
| HorizontalBarChart | ✅ TopN 排名 | — | 排名解读 |
| EventLineChart | ✅ 最新值+环比 | ✅ 行=指标，列=日期 | 事件标记说明 |
| DimTrend | ✅ 各维度占比 | ✅ 维度趋势表 | 维度变化解读 |

### ⚠️ 数据展示补充规则（与 SKILL.md 一致）

1. **零值过滤**：所有指标值均为 0 或空的行，**不展示**（直接跳过）
2. **不是禁止 TopN**：TopN 展示是排名型图表的**标准展示模式**，不属于"自行聚合"禁令范畴。禁令针对的是对原始数据做 groupBy/求和/求平均等改变数据语义的操作

---

## 📋 其他候选报表提示模板

当存在 **2 个及以上** 候选报表时，在报告末尾添加：

```markdown
---

## 📋 其他包含「{关键词}」的报表

> 以上分析基于报表「{当前报表名称}」。以下报表也包含相关指标，如需查看请告诉我：

| # | 报表名称 | 报表 ID | 包含的相关图表/指标 |
|---|---------|---------|----------------|
| 1 | {报表名称} | `{dashboard_id}` | {图表1}({指标}), {图表2}({指标}) |
| 2 | {报表名称} | `{dashboard_id}` | {图表1}({指标}) |

> 💡 回复报表编号或名称即可切换查看，如"查看报表 1"。
```

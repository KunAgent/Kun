# databrain-datalab-analyst图表类型说明

> Agent 根据图表类型调整数据展示策略。

## 支持的图表类型

以下是系统当前支持的全部 **14 种**图表类型及其对应的代码标识（`chartTypeMap`）：

| 图表类型 (chartType) | 代码标识 | 中文名 | 展示策略 | 适合数据 |
|---------------------|---------|--------|---------|---------|
| Table | table | 表格 | Markdown 表格直接展示 | 多维度多指标明细 |
| LineChart | line | 折线图 | 趋势描述 + 关键转折点 | 时间序列趋势 |
| BarChart | bar | 柱状图 | 排名/对比描述 | 分类对比 |
| PieChart | pie | 饼图 | 占比分布描述 | 构成分析 |
| BigNumberChart | bignumber | 数字卡片 | 核心数字 + 环比变化 | KPI 概览 |
| StackBarChart | stackbar | 堆叠图 | 总量 + 构成 | 结构变化趋势 |
| PercentStackBarChart | percentstackbar | 百分比堆叠图 | 占比变化趋势 | 份额演变 |
| HorizontalBarChart | horizontalbar | 条形图 | 同 BarChart，横向展示 | 长标签对比 |
| EventLineChart | eventline | 事件折线图 | 趋势 + 事件标注 | 带关键事件的趋势 |
| TrendChart | trend | 趋势图 | 多指标趋势叠加 | 综合趋势对比 |
| MixedChart | mixed | 组合图 | 多图表类型混合展示 | 多指标异构对比 |
| dim_trend | dim_trend | 分维度趋势卡片 | 按维度拆分的趋势 | 维度级别趋势分析 |
| Map | map | 地图 | 地理分布可视化 | 地域维度数据 |
| WordCloud | wordcloud | 词云图 | 关键词权重分布 | 文本/标签频次分析 |

## 代码映射参考

```go
var chartTypeMap = map[string]string{
    "LineChart":            "line",
    "Table":                "table",
    "StackBarChart":        "stackbar",
    "TrendChart":           "trend",
    "PieChart":             "pie",
    "EventLineChart":       "eventline",
    "BigNumberChart":       "bignumber",
    "dim_trend":            "dim_trend",
    "Map":                  "map",
    "WordCloud":            "wordcloud",
    "HorizontalBarChart":   "horizontalbar",
    "PercentStackBarChart": "percentstackbar",
    "BarChart":             "bar",
    "MixedChart":           "mixed",
}
```

## 展示策略详解

### 表格（Table）
- 使用 Markdown 表格直接展示
- 数值右对齐，文本左对齐
- 超过 20 行时建议分页或汇总

### 折线图（LineChart）
- 描述整体趋势（上升/下降/平稳）
- 标注关键转折点和异常值
- 计算变化幅度（最大/最小/平均）

### 柱状图（BarChart）
- 按大小排序描述 Top N
- 计算各项占比
- 标注与平均值的差异

### 饼图（PieChart）
- 列出前 5 项及其占比
- 合并小项为"其他"
- 标注最大份额

### 数字卡片（BigNumberChart）
- 突出核心数字
- 展示环比/同比变化
- 用箭头（↑/↓/→）标识趋势

### 堆叠图（StackBarChart）
- 展示总量的同时体现各部分构成
- 标注各层占比变化
- 适合观察结构性变化

### 百分比堆叠图（PercentStackBarChart）
- 所有柱子归一化为 100%
- 关注各部分占比的演变
- 适合份额分析

### 条形图（HorizontalBarChart）
- 横向展示，适合标签较长的场景
- 展示策略同柱状图
- 便于阅读排名对比

### 事件折线图（EventLineChart）
- 在折线趋势基础上叠加事件标注
- 标注关键事件发生的时间节点
- 便于分析事件对指标的影响

### 趋势图（TrendChart）
- 多个指标趋势叠加展示
- 支持双Y轴对比不同量级指标
- 适合综合趋势概览

### 组合图（MixedChart）
- 混合多种图表类型（如柱状+折线）
- 支持不同指标使用不同展示形式
- 适合异构指标对比分析

### 分维度趋势卡片（dim_trend）
- 按维度值拆分的独立趋势小卡片
- 每个维度值独立展示趋势
- 适合快速对比各维度的变化情况

### 地图（Map）
- 地理区域着色或气泡展示
- 标注高/低值区域
- 适合地域分布分析

### 词云图（WordCloud）
- 关键词大小反映权重/频次
- 突出 Top N 关键词
- 适合文本分析和标签频次展示

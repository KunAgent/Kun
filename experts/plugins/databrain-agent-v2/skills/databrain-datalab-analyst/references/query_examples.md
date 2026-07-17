# databrain-datalab-analyst用户提问示例 & 参数拼接指南

> 本文档为 Agent 提供从「用户自然语言提问」到「API 参数拼接」的完整映射示例，帮助快速理解参数构造逻辑。

---

## 📖 目录

1. [场景一：直接给报表链接](#场景一直接给报表链接)
2. [场景二：指定游戏 + 关键词查数据](#场景二指定游戏--关键词查数据)
3. [场景三：指定日期范围分析](#场景三指定日期范围分析)
4. [场景四：按国家/地区筛选](#场景四按国家地区筛选)
5. [场景五：多条件组合筛选](#场景五多条件组合筛选)
6. [场景六：查看单个图表 + 聚合](#场景六查看单个图表--聚合)
7. [场景七：知识库检索](#场景七知识库检索)
8. [场景八：模糊搜索报表](#场景八模糊搜索报表)
9. [场景九：从 URL 中提取参数](#场景九从-url-中提取参数)
10. [通用参数拼接规则速查](#通用参数拼接规则速查)

---

## 场景一：直接给报表链接

### 用户提问

> "帮我分析这个报表 https://databrain.intlgame.com/v2/datalab/gstm/WorkBench/MyDashboard/ViewPage?dashboardId=c1ef70ac094263d1e8cd06ade2876b31"

### 参数拼接

```bash
python scripts/call_api.py full_report \
  --dashboard_url "https://databrain.intlgame.com/v2/datalab/gstm/WorkBench/MyDashboard/ViewPage?dashboardId=c1ef70ac094263d1e8cd06ade2876b31" \
  --question "分析报表整体数据"
```

### 拼接逻辑

| 用户输入 | 提取方式 | 对应参数 |
|---------|---------|---------|
| URL 整体 | 原样传入 | `--dashboard_url` |
| 用户的需求描述 | 原话或总结 | `--question` |

> 💡 `full_report` 内部会自动从 URL 解析出 `dashboard_id` 和 `game_code`，无需手动拆解。

---

## 场景二：指定游戏 + 关键词查数据

### 用户提问

> "看下 GST Mobile 的留存数据"

### 参数拼接步骤

**Step 1：搜索游戏获取 game_code**

```bash
python scripts/call_api.py search_game --game_name "GST Mobile" --top 3
```

返回示例：
```json
{
  "code": 0,
  "data": [
    {"game_code": "gstm", "game_name": "GST Mobile", "game_alias": ["gst手游"]}
  ]
}
```

**Step 2：用 game_code + 关键词搜索报表**

```bash
python scripts/call_api.py dashboard_search --game_code "gstm" --keyword "留存"
```

**Step 3：选定报表后获取全量数据**

```bash
python scripts/call_api.py full_report \
  --dashboard_id "从搜索结果中拿到的 dashboard_id" \
  --question "GST Mobile 留存数据分析"
```

### 拼接逻辑

| 用户输入 | 提取方式 | 对应参数 |
|---------|---------|---------|
| "GST Mobile" | 游戏名/别名 | `search_game --game_name` |
| "留存" | 业务关键词 | `dashboard_search --keyword` |
| 搜索结果中的 ID | API 返回值 | `full_report --dashboard_id` |

---

## 场景三：指定日期范围分析

### 用户提问

> "看下上周（5月12日到5月18日）的用户数据"

### 参数拼接

**先获取报表结构（确认可用筛选器）：**

```bash
python scripts/call_api.py dashboard_overview --dashboard_id "abc123"
```

返回中确认 `available_filters` 包含 `dtstatdate`：
```json
{
  "available_filters": [
    {"column": "dtstatdate", "type": "date", "label": "统计日期"}
  ]
}
```

**带日期筛选获取数据：**

```bash
python scripts/call_api.py full_report \
  --dashboard_id "abc123" \
  --question "上周用户数据分析" \
  --filters '[{"column":"dtstatdate","operation":"between","value":["2026-05-12","2026-05-18"]}]'
```

### 拼接逻辑

| 用户输入 | 转换规则 | 对应参数 |
|---------|---------|---------|
| "上周" / "5月12日到5月18日" | 转为 ISO 日期格式 YYYY-MM-DD | `filters[].value` |
| 日期范围 | 使用 `between` 操作符 | `filters[].operation` |
| "dtstatdate" | 从 `available_filters` 匹配 | `filters[].column` |

> ⚠️ **日期格式必须为 `YYYY-MM-DD`**，不支持 `YYYY/MM/DD` 或其他格式。

---

## 场景四：按国家/地区筛选

### 用户提问

> "看下中国和美国的收入情况"

### 参数拼接

**先确认筛选器存在：**

从 `dashboard_overview` 返回确认有 `country` 字段：
```json
{
  "available_filters": [
    {"column": "country", "type": "string", "label": "国家"}
  ]
}
```

**带国家筛选获取数据：**

```bash
python scripts/call_api.py full_report \
  --dashboard_id "abc123" \
  --question "中国和美国收入分析" \
  --filters '[{"column":"country","operation":"include","value":["CN","US"]}]'
```

### 拼接逻辑

| 用户输入 | 转换规则 | 对应参数 |
|---------|---------|---------|
| "中国" → "CN" | 国家名转 ISO 代码 | `filters[].value[]` |
| "美国" → "US" | 国家名转 ISO 代码 | `filters[].value[]` |
| 多选 | 使用 `include` 操作符 | `filters[].operation` |
| "country" | 从 `available_filters` 匹配 | `filters[].column` |

> ⚠️ 如果 `available_filters` 中没有 `country` 字段，**不要强行拼接**！应不带该筛选条件查询，从返回数据中查找目标行。

---

## 场景五：多条件组合筛选

### 用户提问

> "看下上周日本地区等级 10 以上用户的留存数据"

### 参数拼接

```bash
python scripts/call_api.py full_report \
  --dashboard_id "abc123" \
  --question "上周日本地区高等级用户留存分析" \
  --filters '[{"column":"dtstatdate","operation":"between","value":["2026-05-12","2026-05-18"]},{"column":"country","operation":"include","value":["JP"]},{"column":"level","operation":"greaterOrEqual","value":[10]}]'
```

### 拼接逻辑

多个筛选条件组成 JSON 数组，每个条件独立一个对象：

| 用户需求 | column | operation | value |
|---------|--------|-----------|-------|
| 上周 | `dtstatdate` | `between` | `["2026-05-12","2026-05-18"]` |
| 日本地区 | `country` | `include` | `["JP"]` |
| 等级10以上 | `level` | `greaterOrEqual` | `[10]` |

> ⚠️ 每个条件**必须**在 `available_filters` 中找到对应 column，找不到的条件**直接丢弃**，不要猜测列名。

---

## 场景六：查看单个图表 + 聚合

### 用户提问

> "把 DAU 图表按日期聚合求和，只看前 30 条"

### 参数拼接

**先从 `dashboard_overview` 获取图表 ID：**

```bash
python scripts/call_api.py dashboard_overview --dashboard_id "abc123"
```

返回中找到 DAU 图表：
```json
{
  "charts_summary": [
    {"chart_id": "chart_dau_001", "chart_name": "DAU 趋势", "chart_type": "LineChart"}
  ]
}
```

**带聚合参数查询：**

```bash
python scripts/call_api.py chart_data \
  --dashboard_id "abc123" \
  --chart_id "chart_dau_001" \
  --aggregation '{"enabled":true,"group_by":["date"],"metrics_agg":"sum","top_n":30}'
```

### 拼接逻辑

| 用户输入 | 转换规则 | 对应参数 |
|---------|---------|---------|
| "DAU 图表" | 从 overview 中匹配 chart_name | `--chart_id` |
| "按日期聚合" | group_by 填日期维度字段 | `aggregation.group_by` |
| "求和" | sum/avg/max/min | `aggregation.metrics_agg` |
| "前 30 条" | 数字 | `aggregation.top_n` |

---

## 场景七：知识库检索

### 用户提问

> "GST 的次日留存怎么计算的？为什么最近下降了？"

### 参数拼接

**MCP 不可用时的 HTTP 备用方案：**

```bash
python scripts/call_api.py knot_search \
  --query "GST 次日留存 计算口径 下降原因" \
  --top_k 5
```

### 拼接逻辑

| 用户输入 | 转换规则 | 对应参数 |
|---------|---------|---------|
| 用户的完整问题 | 提取核心关键词组合 | `--query` |
| 返回结果数量 | 一般 3~5 即可 | `--top_k` |

> 💡 `--query` 应包含业务关键词 + 分析意图，用空格拼接，如 `"留存 下降 归因 方法论"`。

---

## 场景八：模糊搜索报表

### 用户提问

> "gst 手游有没有关于付费的报表？"

### 参数拼接

```bash
# Step 1: 搜索游戏
python scripts/call_api.py search_game --game_name "gst 手游" --top 3

# Step 2: 用 game_code 搜索报表
python scripts/call_api.py dashboard_search --game_code "gstm" --keyword "付费"
```

### 拼接逻辑

| 用户输入 | 提取方式 | 对应参数 |
|---------|---------|---------|
| "gst 手游" | 游戏名/别名 | `search_game --game_name` |
| "付费" | 业务维度关键词 | `dashboard_search --keyword` |

---

## 场景九：从 URL 中提取参数

### 用户提问

> "分析这个链接 https://databrain.intlgame.com/v2/datalab/gstm/WorkBench/MyDashboard/ViewPage?dashboardId=abc123def456"

### URL 解析规则

```
URL 结构：
https://{host}/v2/datalab/{game_code}/WorkBench/MyDashboard/ViewPage?dashboardId={dashboard_id}

提取：
- host         → DATABRAIN_DISPLAY_HOST（用于生成报告链接）
- game_code    → "gstm"（从路径 /datalab/ 后一段取）
- dashboard_id → "abc123def456"（从 query string ?dashboardId= 取）
```

### 两种用法

**方式 A（推荐）：直接传 URL**

```bash
python scripts/call_api.py full_report \
  --dashboard_url "https://databrain.intlgame.com/v2/datalab/gstm/WorkBench/MyDashboard/ViewPage?dashboardId=abc123def456" \
  --question "分析报表"
```

**方式 B：手动拆解后传 ID**

```bash
python scripts/call_api.py full_report \
  --dashboard_id "abc123def456" \
  --game_code "gstm" \
  --question "分析报表"
```

---

## 通用参数拼接规则速查

### 🔑 用户意图 → Action 映射

| 用户说的话（示例） | 识别为 | Action |
|----------------|--------|--------|
| "分析这个链接 ..." | 给了 URL | `full_report --dashboard_url` |
| "看下报表 xxx 的数据" | 给了报表名/ID | `full_report --dashboard_id` |
| "xxx 游戏的 yyy 数据" | 游戏 + 关键词 | `search_game` → `dashboard_search` → `full_report` |
| "xxx 怎么计算的" | 知识查询 | `knot_search` |
| "有哪些报表" | 列表浏览 | `dashboard_list` |
| "这个图表按 xx 维度看" | 单图表 + 聚合 | `chart_data --aggregation` |

### 🔑 日期表述 → value 转换

| 用户表述 | 转换为 |
|---------|--------|
| "今天" | `["2026-05-21","2026-05-21"]` |
| "昨天" | `["2026-05-20","2026-05-20"]` |
| "上周" | `["2026-05-12","2026-05-18"]`（上周一 ~ 上周日） |
| "本周" | `["2026-05-19","2026-05-21"]`（本周一 ~ 今天） |
| "近 7 天" | `["2026-05-15","2026-05-21"]`（今天往前 7 天） |
| "近 30 天" | `["2026-04-22","2026-05-21"]`（今天往前 30 天） |
| "5月1日到5月15日" | `["2026-05-01","2026-05-15"]` |

### 🔑 Filters 拼接检查清单

```
1. ✅ 先调 dashboard_overview 获取 available_filters
2. ✅ 逐一匹配用户需求与 available_filters[].column
3. ✅ 匹配上的 → 拼入 filters 数组
4. ✅ 匹配不上的 → 直接丢弃，不猜测
5. ✅ value 始终是数组 []
6. ✅ 日期格式 YYYY-MM-DD
7. ✅ 数值型可传数字或字符串
8. 禁止循环尝试不同 column 名
9. 禁止拼接 available_filters 中不存在的 column
```

### 🔑 Aggregation 拼接检查清单

```
1. ✅ 仅在 chart_data 中使用（full_report 不支持）
2. ✅ group_by 填实际存在的维度字段名
3. ✅ metrics_agg 只能是 sum/avg/max/min 之一
4. ✅ top_n 默认 50，最大 200
5. ✅ enabled 必须为 true 才生效
```

---

## 💡 常见易错点

| 错误做法 | 正确做法 |
|---------|---------|
| `"value": "2026-05-01"` | `"value": ["2026-05-01"]`（始终数组） |
| `"column": "date"` 猜测 | 先看 `available_filters`，用实际的 `"dtstatdate"` |
| 多次尝试 `country`/`region`/`geo` | 一次匹配不上即放弃，不加该筛选 |
| 用 `chart_data` 逐个查每个图表 | 用 `full_report` 一次获取全量 |
| `--filters '{"column":"x",...}'` 传对象 | `--filters '[{"column":"x",...}]'` 传数组 |
| 不带 `--question` 参数 | 始终传入用户原始问题，用于 report_log |

---

## 📎 完整端到端示例

### 示例：用户完整交互流程

**用户提问**：
> "帮我看下 GST 手游上周的 DAU 和留存数据，按国家维度分析下中国和日本的差异"

**Agent 执行流程**：

```bash
# 1. 搜索游戏
python scripts/call_api.py search_game --game_name "GST 手游" --top 3
# → 得到 game_code: "gstm"

# 2. 因为是 gst 游戏，先查 MCP 知识库
python scripts/call_api.py knot_search --query "GST DAU 留存 国家维度 分析" --top_k 5
# → 得到相关报表信息和业务知识

# 3. 搜索报表（结合知识库建议）
python scripts/call_api.py dashboard_search --game_code "gstm" --keyword "DAU 留存"
# → 得到匹配的报表列表

# 4. 获取报表结构，确认可用筛选器
python scripts/call_api.py dashboard_overview --dashboard_id "matched_dashboard_id"
# → 确认有 dtstatdate、country 筛选器

# 5. 带筛选条件获取数据
python scripts/call_api.py full_report \
  --dashboard_id "matched_dashboard_id" \
  --question "GST 手游上周 DAU 和留存数据，中国和日本对比" \
  --filters '[{"column":"dtstatdate","operation":"between","value":["2026-05-12","2026-05-18"]},{"column":"country","operation":"include","value":["CN","JP"]}]'
```

**最终输出**：以 `# 📊 报表名称 · 分析报告` 开头的完整分析报告。

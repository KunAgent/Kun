# databrain-datalab-analyst筛选操作符详解

> 用于 chart_data / dashboard_data 接口的 filters 参数。

| 操作符 | 适用类型 | SQL 等价 | value 格式 | 示例 |
|--------|---------|---------|-----------|------|
| `include` | 字符串 | `IN (...)` | `["us", "gb"]` | 筛选美国和英国 |
| `exclude` | 字符串 | `NOT IN (...)` | `["cn"]` | 排除中国 |
| `between` | 日期/数字 | `BETWEEN ... AND ...` | `["2026-01-01", "2026-03-01"]` | 日期区间 |
| `greater` | 数字 | `>` | `[100]` | 大于100 |
| `less` | 数字 | `<` | `[100]` | 小于100 |
| `greaterOrEqual` | 数字 | `>=` | `[100]` | 大于等于100 |
| `lessOrEqual` | 数字 | `<=` | `[100]` | 小于等于100 |
| `equal` | 数字 | `=` | `[42]` | 等于42 |
| `notEqual` | 数字 | `!=` | `[42]` | 不等于42 |
| `notNull` | 任意 | `IS NOT NULL` | `[]` | 非空 |
| `null` | 任意 | `IS NULL` | `[]` | 为空 |
| `like` | 字符串 | `LIKE '%...%'` | `["keyword"]` | 模糊匹配 |
| `notLike` | 字符串 | `NOT LIKE '%...%'` | `["keyword"]` | 排除模糊匹配 |

## 合并规则

- 未传筛选 → 使用报表默认值
- 日期类型 → **覆盖**同字段默认值
- 非日期类型 → **追加**（AND 取交集）
- 同字段多条 → 后面的覆盖前面的

## filters 格式示例

```json
{
  "filters": [
    {
      "col": "country",
      "op": "include",
      "val": ["us", "gb", "jp"]
    },
    {
      "col": "dt",
      "op": "between",
      "val": ["2026-01-01", "2026-01-31"]
    },
    {
      "col": "revenue",
      "op": "greater",
      "val": [1000]
    }
  ]
}
```

## 常用筛选场景

| 场景 | 筛选字段 | 操作符 | 示例值 |
|------|---------|--------|--------|
| 按日期范围 | dt | between | ["2026-01-01", "2026-01-31"] |
| 按国家/地区 | country | include | ["us", "gb"] |
| 排除测试数据 | channel | exclude | ["test", "debug"] |
| 按平台 | platform | include | ["ios", "android"] |
| 高价值用户 | revenue | greater | [100] |
| 活跃用户 | login_days | greaterOrEqual | [7] |

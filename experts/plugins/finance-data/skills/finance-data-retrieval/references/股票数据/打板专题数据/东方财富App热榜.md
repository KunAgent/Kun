# 东方财富热榜

> 接口：`dc_hot` | 获取东方财富App热榜数据，包括A股、ETF、港股、美股等

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| trade_date | str | N | 交易日期 |
| ts_code | str | N | TS代码 |
| market | str | N | 类型（A股市场、ETF基金、港股市场、美股市场） |
| hot_type | str | N | 热点类型（人气榜、飙升榜） |
| is_new | str | N | 是否最新（默认Y，N为盘中盘后采集，每小时更新；Y更新时间22:30） |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| data_type | str | 数据类型 |
| ts_code | str | 股票代码 |
| ts_name | str | 股票名称 |
| rank | int | 排行或热度 |
| pct_change | float | 涨跌幅% |
| current_price | float | 当前价 |
| hot | float | 热度值 |
| concept | str | 概念标签 |
| rank_time | str | 排行榜获取时间 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "dc_hot",
    "params": {"trade_date": "20250228", "market": "A股市场"},
    "fields": "ts_code,ts_name,rank,pct_change"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "data_type", "ts_code", "ts_name", "rank", "pct_change", "current_price", "hot", "concept", "rank_time"],
    "items": [
      ["20250228", "A股市场", "002207.SZ", "准油股份", 1, 10.02, 5.82, null, null, "2025-02-28 21:30:01"],
      ["20250228", "A股市场", "300084.SZ", "海默科技", 2, 5.41, 6.04, null, null, "2025-02-28 21:30:01"],
      ["20250228", "A股市场", "870436.BJ", "大地电气", 3, 29.98, 24.93, null, null, "2025-02-28 21:30:01"]
    ]
  }
}
```

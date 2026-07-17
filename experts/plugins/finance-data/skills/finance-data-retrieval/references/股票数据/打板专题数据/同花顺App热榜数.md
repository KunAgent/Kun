# 同花顺热榜

> 接口：`ths_hot` | 获取同花顺App热榜数据，包括热股、概念板块、ETF、可转债、港美股等

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| trade_date | str | N | 交易日期 |
| ts_code | str | N | TS代码 |
| market | str | N | 热榜类型（热股、ETF、可转债、行业板块、概念板块、期货、港股、热基、美股） |
| is_new | str | N | 是否最新（默认Y，N为盘中盘后采集，每小时更新；Y更新时间22:30） |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| data_type | str | 数据类型 |
| ts_code | str | 股票代码 |
| ts_name | str | 股票名称 |
| rank | int | 排行 |
| pct_change | float | 涨跌幅% |
| current_price | float | 当前价格 |
| concept | str | 标签 |
| rank_reason | str | 上榜解读 |
| hot | float | 热度值 |
| rank_time | str | 排行榜获取时间 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "ths_hot",
    "params": {"trade_date": "20250228", "market": "热股"},
    "fields": "ts_code,ts_name,hot,concept"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "data_type", "ts_code", "ts_name", "rank", "pct_change", "current_price", "hot", "concept", "rank_time", "rank_reason"],
    "items": [
      ["20250228", "热股", "600811.SH", "东方集团", 1, -7.36, 2.14, 887630.0, "[\"新型城镇化\", \"人造肉\"]", "2025-02-28 21:30:51", null],
      ["20250228", "热股", "603496.SH", "恒为科技", 2, 9.99, 38.1, 420865.0, "[\"华为昇腾\", \"国产操作系统\"]", "2025-02-28 21:30:52", null],
      ["20250228", "热股", "000063.SZ", "中兴通讯", 3, -4.5, 38.66, 325283.0, "[\"液冷服务器\", \"AI手机\"]", "2025-02-28 21:30:52", null]
    ]
  }
}
```

# ETF日线行情

> 接口：`fund_daily` | 获取ETF每日收盘行情数据，历史数据超10年

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 基金代码 |
| trade_date | str | N | 交易日期（YYYYMMDD） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | 基金代码 |
| trade_date | str | 交易日期 |
| pre_close | float | 昨收价（元） |
| open | float | 开盘价（元） |
| high | float | 最高价（元） |
| low | float | 最低价（元） |
| close | float | 收盘价（元） |
| change | float | 涨跌额（元） |
| pct_chg | float | 涨跌幅（%） |
| vol | float | 成交量（手） |
| amount | float | 成交额（千元） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "fund_daily",
    "params": {"ts_code": "510050.SH", "trade_date": "20250228"},
    "fields": "ts_code,trade_date,open,high,low,close,vol,amount"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "trade_date", "pre_close", "open", "high", "low", "close", "change", "pct_chg", "vol", "amount"],
    "items": [
      ["510050.SH", "20250228", 2.74, 2.732, 2.75, 2.699, 2.705, -0.035, -1.2774, 9990512.64, 2722485.399]
    ]
  }
}
```

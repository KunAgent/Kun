# ETF历史分钟

> 接口：`stk_mins` | 获取ETF历史分钟行情数据，支持1~60分钟频率，可通过循环代码和时间段获取10年以上历史数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | Y | ETF代码（如510050.SH） |
| freq | str | Y | 频率：1min/5min/15min/30min/60min |
| start_date | datetime | N | 开始时间（如2025-02-28 09:00:00） |
| end_date | datetime | N | 结束时间（如2025-02-28 16:00:00） |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | ETF代码 |
| trade_time | str | 交易时间 |
| close | float | 收盘价 |
| open | float | 开盘价 |
| high | float | 最高价 |
| low | float | 最低价 |
| vol | int | 成交量（股） |
| amount | float | 成交额（元） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "stk_mins",
    "params": {"ts_code": "510050.SH", "freq": "5min", "start_date": "2025-02-28 09:00:00", "end_date": "2025-02-28 16:00:00"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "trade_time", "close", "open", "high", "low", "vol", "amount"],
    "items": [
      ["510050.SH", "2025-02-28 15:00:00", 2.705, 2.702, 2.706, 2.7, 28396350.0, 76765360.0],
      ["510050.SH", "2025-02-28 14:55:00", 2.703, 2.701, 2.703, 2.699, 15175300.0, 40984264.0],
      ["510050.SH", "2025-02-28 14:50:00", 2.701, 2.703, 2.703, 2.7, 17751240.0, 47955132.0]
    ]
  }
}
```

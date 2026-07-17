# ETF实时分钟

> 接口：`rt_min` | 获取ETF实时分钟行情数据，支持1~60分钟频率

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | Y | ETF代码，支持逗号分隔多个（如510050.SH,159100.SZ） |
| freq | str | Y | 频率：1MIN/5MIN/15MIN/30MIN/60MIN |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | ETF代码 |
| freq | str | 频率 |
| time | str | 交易时间 |
| open | float | 开盘价 |
| close | float | 收盘价 |
| high | float | 最高价 |
| low | float | 最低价 |
| vol | float | 成交量（股） |
| amount | float | 成交额（元） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "rt_min",
    "params": {"ts_code": "510050.SH", "freq": "5MIN"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "freq", "time", "open", "close", "high", "low", "vol", "amount"],
    "items": [
      ["510050.SH", "5MIN", "2026-03-03 15:00:00", 3.092, 3.096, 3.099, 3.092, 9371000.0, 29009463.0]
    ]
  }
}
```

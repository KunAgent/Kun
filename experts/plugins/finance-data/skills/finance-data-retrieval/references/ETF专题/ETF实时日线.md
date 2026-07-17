# ETF实时日线

> 接口：`rt_etf_k` | 获取ETF实时日线行情数据，支持通配符批量获取（需单独权限）

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | Y | 支持通配符格式，如5*.SH、15*.SZ、159101.SZ |
| topic | str | Y | 分类参数，上海ETF填HQ_FND_TICK |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | ETF代码 |
| name | str | ETF名称 |
| pre_close | float | 昨收价 |
| high | float | 最高价 |
| open | float | 开盘价 |
| low | float | 最低价 |
| close | float | 最新价 |
| vol | int | 成交量（股） |
| amount | int | 成交额（元） |
| num | int | 开盘以来成交笔数 |
| ask_volume1 | int | 卖一量（股） |
| bid_volume1 | int | 买一量（股） |
| trade_time | str | 交易时间 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "rt_etf_k",
    "params": {"ts_code": "5*.SH", "topic": "HQ_FND_TICK"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "name", "pre_close", "high", "open", "low", "close", "vol", "amount", "num"],
    "items": [
      ["520860.SH", "港股通科", 1.024, 1.054, 1.048, 1.041, 1.048, 15071600, 15780985, 307],
      ["515320.SH", "电子50", 1.173, 1.211, 1.184, 1.184, 1.206, 1830600, 2191339, 98],
      ["511600.SH", "货币ETF", 100.008, 100.003, 100.002, 99.999, 100.0, 12022, 1202204, 28]
    ]
  }
}
```

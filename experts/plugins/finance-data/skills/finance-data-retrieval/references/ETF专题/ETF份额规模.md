# ETF份额规模

> 接口：`etf_share_size` | 获取沪深ETF每日份额和规模数据，反映规模和份额变动，跟踪ETF资金流向

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 基金代码 |
| trade_date | str | N | 交易日期（YYYYMMDD） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |
| exchange | str | N | 交易所：SSE-上交所 SZSE-深交所 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| ts_code | str | ETF代码 |
| etf_name | str | 基金名称 |
| total_share | float | 总份额（万份） |
| total_size | float | 总规模（万元） |
| nav | float | 基金份额净值（元） |
| close | float | 收盘价（元） |
| exchange | str | 交易所 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "etf_share_size",
    "params": {"ts_code": "510050.SH", "trade_date": "20250228"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "ts_code", "etf_name", "total_share", "total_size", "exchange"],
    "items": [
      ["20250228", "510050.SH", "上证50ETF", 5288916.68, 14267910.5276, "SSE"]
    ]
  }
}
```

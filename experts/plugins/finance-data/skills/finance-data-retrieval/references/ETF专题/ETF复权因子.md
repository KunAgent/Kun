# ETF复权因子

> 接口：`fund_adj` | 获取基金复权因子，用于计算基金复权价格

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 基金代码（支持多个） |
| trade_date | str | N | 交易日期（YYYYMMDD） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |
| offset | str | N | 起始行 |
| limit | str | N | 最大行数 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | 基金代码 |
| trade_date | str | 交易日期 |
| adj_factor | float | 复权因子 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "fund_adj",
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
    "fields": ["ts_code", "trade_date", "adj_factor"],
    "items": [
      ["510050.SH", "20250228", 1.41]
    ]
  }
}
```

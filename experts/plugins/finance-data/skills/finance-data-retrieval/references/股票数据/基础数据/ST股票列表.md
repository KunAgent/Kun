# ST股票列表

> 接口：`stock_st` | 获取每个交易日的ST股票列表，支持历史数据查询

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 股票代码 |
| trade_date | str | N | 交易日期（YYYYMMDD格式） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | 股票代码 |
| name | str | 股票名称 |
| trade_date | str | 交易日期 |
| type | str | 类型 |
| type_name | str | 类型名称 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "stock_st",
    "params": {"trade_date": "20250228"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "name", "trade_date", "type", "type_name"],
    "items": [
      ["002808.SZ", "ST恒久", "20250228", "ST", "风险警示板"],
      ["600360.SH", "ST华微", "20250228", "ST", "风险警示板"],
      ["600831.SH", "ST广网", "20250228", "ST", "风险警示板"]
    ]
  }
}
```

# Libor利率

> 接口：`libor` | 伦敦同业拆借利率（London Interbank Offered Rate）数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| date | str | N | 日期（格式：YYYYMMDD） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |
| curr_type | str | N | 货币代码（USD美元/EUR欧元/JPY日元/GBP英镑/CHF瑞郎，默认USD） |

**限量：** 单次最大4000条，总量不限。**权限：** 用户需至少120积分。

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| date | str | 日期 |
| curr_type | str | 货币 |
| on | float | 隔夜 |
| 1w | float | 1周 |
| 1m | float | 1个月 |
| 2m | float | 2个月 |
| 3m | float | 3个月 |
| 6m | float | 6个月 |
| 12m | float | 12个月 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "libor",
    "params": {"curr_type": "USD", "start_date": "20181101", "end_date": "20181130"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["date", "curr_type", "on", "1w", "1m", "2m", "3m", "6m", "12m"],
    "items": [
      ["20181130", "USD", 2.17750, 2.22131, 2.34694, 2.51006, 2.73613, 2.89463, 3.12025],
      ["20181129", "USD", 2.18275, 2.22881, 2.34925, 2.51125, 2.73813, 2.88519, 3.11869],
      ["20181128", "USD", 2.18250, 2.22450, 2.34463, 2.49500, 2.70663, 2.88663, 3.13413]
    ]
  }
}
```

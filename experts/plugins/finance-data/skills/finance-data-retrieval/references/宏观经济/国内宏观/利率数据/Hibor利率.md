# Hibor利率

> 接口：`hibor` | 香港银行间同业拆借利率（Hong Kong Interbank Offered Rate）数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| date | str | N | 日期（格式：YYYYMMDD） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

**限量：** 单次最大4000条，总量不限。**权限：** 用户需至少120积分。

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| date | str | 日期 |
| on | float | 隔夜 |
| 1w | float | 1周 |
| 2w | float | 2周 |
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
    "api_name": "hibor",
    "params": {"start_date": "20181101", "end_date": "20181130"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["date", "on", "1w", "2w", "1m", "2m", "3m", "6m", "12m"],
    "items": [
      ["20181101", 1.52500, 1.78571, 1.89286, 2.14286, 2.35714, 2.57143, 2.78571, 3.00000],
      ["20181031", 1.53571, 1.71429, 1.82143, 2.10714, 2.32143, 2.55357, 2.78214, 2.98571],
      ["20181030", 1.50000, 1.67857, 1.80357, 2.08929, 2.30357, 2.53571, 2.76429, 2.97143]
    ]
  }
}
```

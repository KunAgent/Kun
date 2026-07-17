# Shibor利率

> 接口：`shibor` | 上海银行间同业拆放利率数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| date | str | N | 日期（格式：YYYYMMDD） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

**限量：** 单次最大2000条，总量不限。**权限：** 用户需至少120积分。

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| date | str | 日期 |
| on | float | 隔夜 |
| 1w | float | 1周 |
| 2w | float | 2周 |
| 1m | float | 1个月 |
| 3m | float | 3个月 |
| 6m | float | 6个月 |
| 9m | float | 9个月 |
| 1y | float | 1年 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "shibor",
    "params": {"date": "20250228"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["date", "on", "1w", "2w", "1m", "3m", "6m", "9m", "1y"],
    "items": [
      ["20250228", 1.865, 2.093, 2.273, 1.868, 1.922, 1.946, 1.953, 1.944]
    ]
  }
}
```

# LPR贷款基础利率

> 接口：`shibor_lpr` | 贷款市场报价利率（Loan Prime Rate）数据

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
| 1y | float | 1年期贷款利率 |
| 5y | float | 5年期贷款利率 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "shibor_lpr",
    "params": {"date": "20250220"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["date", "1y", "5y"],
    "items": [
      ["20250220", 3.1, 3.6]
    ]
  }
}
```

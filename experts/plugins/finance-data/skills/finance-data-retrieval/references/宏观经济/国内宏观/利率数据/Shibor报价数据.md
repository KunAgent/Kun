# Shibor报价数据

> 接口：`shibor_quote` | 获取各报价银行的Shibor报价数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| date | str | N | 日期（格式：YYYYMMDD） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |
| bank | str | N | 银行名称（中文，如"农业银行"） |

**限量：** 单次最大4000条，总量不限。**权限：** 用户需至少120积分。

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| date | str | 日期 |
| bank | str | 报价银行 |
| on_b | float | 隔夜_Bid |
| on_a | float | 隔夜_Ask |
| 1w_b | float | 1周_Bid |
| 1w_a | float | 1周_Ask |
| 2w_b | float | 2周_Bid |
| 2w_a | float | 2周_Ask |
| 1m_b | float | 1月_Bid |
| 1m_a | float | 1月_Ask |
| 3m_b | float | 3月_Bid |
| 3m_a | float | 3月_Ask |
| 6m_b | float | 6月_Bid |
| 6m_a | float | 6月_Ask |
| 9m_b | float | 9月_Bid |
| 9m_a | float | 9月_Ask |
| 1y_b | float | 1年_Bid |
| 1y_a | float | 1年_Ask |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "shibor_quote",
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
    "fields": ["date", "bank", "on_b", "on_a", "1w_b", "1w_a", "2w_b", "2w_a", "1m_b", "1m_a", "3m_b", "3m_a", "6m_b", "6m_a", "9m_b", "9m_a", "1y_b", "1y_a"],
    "items": [
      ["20250228", "上海银行", 1.86, 1.86, 2.10, 2.10, 2.27, 2.27, 1.86, 1.86, 1.91, 1.91, 1.93, 1.93, 1.94, 1.94, 1.93, 1.93],
      ["20250228", "中信银行", 1.86, 1.86, 2.09, 2.09, 2.27, 2.27, 1.98, 1.98, 2.02, 2.02, 2.02, 2.02, 2.02, 2.02, 2.02, 2.02],
      ["20250228", "中国银行", 1.85, 1.85, 2.09, 2.09, 2.27, 2.27, 1.83, 1.83, 1.85, 1.85, 1.86, 1.86, 1.87, 1.87, 1.88, 1.88]
    ]
  }
}
```

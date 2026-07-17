# IPO新股上市

> 接口：`new_share` | 获取IPO新股上市数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| start_date | str | N | 网上发行开始日期 |
| end_date | str | N | 网上发行结束日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | TS股票代码 |
| sub_code | str | 申购代码 |
| name | str | 股票名称 |
| ipo_date | str | 网上发行日期 |
| issue_date | str | 上市日期 |
| amount | float | 发行总量（万股） |
| market_amount | float | 网上发行总量（万股） |
| price | float | 发行价格 |
| pe | float | 市盈率 |
| limit_amount | float | 个人申购上限（万股） |
| funds | float | 募集资金（亿元） |
| ballot | float | 中签率 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "new_share",
    "params": {"start_date": "20250101", "end_date": "20250301"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "sub_code", "name", "ipo_date", "issue_date", "amount", "market_amount", "price", "pe", "limit_amount", "funds", "ballot"],
    "items": [
      ["301275.SZ", "301275", "汉朔科技", "20250228", "20250311", 4224.0, 1352.0, 27.5, 16.75, 0.65, 11.616, 0.02],
      ["603271.SH", "732271", "永杰新材", "20250228", "20250311", 4920.0, 3149.0, 20.6, 16.43, 1.55, 10.135, 0.03],
      ["603409.SH", "732409", "汇通控股", "20250221", "20250304", 3151.0, 2521.0, 24.18, 20.72, 1.25, 7.619, 0.03]
    ]
  }
}
```

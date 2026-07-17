# ETF基准指数

> 接口：`etf_index` | 获取ETF基准指数列表信息

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 指数代码 |
| pub_date | str | N | 发布日期（YYYYMMDD） |
| base_date | str | N | 指数基期（YYYYMMDD） |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | 指数代码 |
| indx_name | str | 指数全称 |
| indx_csname | str | 指数简称 |
| pub_party_name | str | 指数发布机构 |
| pub_date | str | 指数发布日期 |
| base_date | str | 指数基日 |
| bp | float | 指数基点 |
| adj_circle | str | 成份证券调整周期 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "etf_index",
    "params": {},
    "fields": "ts_code,indx_name,pub_date,bp"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "indx_name", "indx_csname", "pub_party_name", "pub_date", "base_date", "bp", "adj_circle"],
    "items": [
      ["000068.SH", "上证自然资源指数", "上证资源", "中证指数有限公司", "20100528", "20031231", 1000.0, "半年"],
      ["000001.SH", "上证综合指数", "上证指数", "中证指数有限公司", "19910715", "19901219", 100.0, "自动调整"],
      ["000989.SH", "中证全指可选消费指数", "全指可选", "中证指数有限公司", "20110802", "20041231", 1000.0, "半年"]
    ]
  }
}
```

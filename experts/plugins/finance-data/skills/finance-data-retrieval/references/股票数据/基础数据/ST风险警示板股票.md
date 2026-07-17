# ST风险警示板股票

> 接口：`st` | 获取ST风险警示板股票列表及变更记录

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 股票代码 |
| pub_date | str | N | 公告日期 |
| imp_date | str | N | 实施日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ts_code | str | 股票代码 |
| name | str | 股票名称 |
| pub_date | str | 公告日期 |
| imp_date | str | 实施日期 |
| st_tpye | str | ST类型 |
| st_reason | str | ST变更原因 |
| st_explain | str | ST变更详细说明 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "st",
    "params": {"ts_code": "300125.SZ"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["ts_code", "name", "pub_date", "imp_date", "st_tpye", "st_reason", "st_explain"],
    "items": [
      ["300125.SZ", "*ST聆达", "20260127", "20260128", "撤销叠加*ST", "重整完成或和解协议执行完成或案件结束", "公司重整计划已经执行完毕..."],
      ["300125.SZ", "*ST聆达", "20251119", "20251119", "叠加*ST", "法院依法受理公司重整、和解或者破产清算申请", "公司2024年扣除非经常性损益后的净利润为负..."],
      ["300125.SZ", "*ST聆达", "20250424", "20250425", "从ST变为*ST", "最近一个会计年度经审计的利润总额、净利润或者扣除非经常性损益后的净利润孰低者为负值且营业收入低于1亿元", "公司2024年度经审计的扣除非经常性损益后的净利润为-85,579万元..."]
    ]
  }
}
```

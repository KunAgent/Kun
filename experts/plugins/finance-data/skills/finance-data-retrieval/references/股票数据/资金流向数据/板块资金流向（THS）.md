# 板块资金流向（THS）

> 接口：`moneyflow_cnt_ths` | 获取同花顺概念板块每日资金流向数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 板块代码 |
| trade_date | str | N | 交易日期（YYYYMMDD格式） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| ts_code | str | 板块代码 |
| name | str | 板块名称 |
| lead_stock | str | 领涨股名称 |
| close_price | float | 领涨股最新价 |
| pct_change | float | 板块涨跌幅（%） |
| industry_index | float | 板块指数 |
| company_num | int | 公司数量 |
| pct_change_stock | float | 领涨股涨跌幅（%） |
| net_buy_amount | float | 流入资金（亿元） |
| net_sell_amount | float | 流出资金（亿元） |
| net_amount | float | 净额（亿元） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "moneyflow_cnt_ths",
    "params": {"trade_date": "20250228"},
    "fields": "trade_date,ts_code,name,lead_stock,pct_change,net_amount"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "ts_code", "name", "lead_stock", "close_price", "pct_change", "industry_index", "company_num", "pct_change_stock", "net_buy_amount", "net_sell_amount", "net_amount"],
    "items": [
      ["20250228", "885748.TI", "可燃冰", "潜能恒信", 16.24, 1.88, 1131.67, 12, 1.88, 10.0, 10.0, 0.0],
      ["20250228", "885699.TI", "ST板块", "*ST嘉寓", 1.0, -0.15, 408.38, 129, -0.15, 29.0, 34.0, -4.0],
      ["20250228", "885591.TI", "中韩自贸区", "青岛金王", 5.99, -0.18, 2022.99, 9, -0.18, 4.0, 3.0, 0.0]
    ]
  }
}
```

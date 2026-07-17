# 行业资金流向（THS）

> 接口：`moneyflow_ind_ths` | 获取同花顺行业资金流向数据，每日盘后更新

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 行业代码 |
| trade_date | str | N | 交易日期（YYYYMMDD格式） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| ts_code | str | 行业代码 |
| industry | str | 行业名称 |
| lead_stock | str | 领涨股名称 |
| close | float | 收盘指数 |
| pct_change | float | 指数涨跌幅（%） |
| company_num | int | 公司数量 |
| pct_change_stock | float | 领涨股涨跌幅（%） |
| close_price | float | 领涨股最新价 |
| net_buy_amount | float | 流入资金（亿元） |
| net_sell_amount | float | 流出资金（亿元） |
| net_amount | float | 净额（亿元） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "moneyflow_ind_ths",
    "params": {"trade_date": "20250228"},
    "fields": "trade_date,ts_code,industry,lead_stock,pct_change,net_amount"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "ts_code", "industry", "lead_stock", "close", "pct_change", "company_num", "pct_change_stock", "close_price", "net_buy_amount", "net_sell_amount", "net_amount"],
    "items": [
      ["20250228", "881107.TI", "油气开采及服务", "潜能恒信", 1128.09, 1.76, 21, 20.03, 16.24, 21.0, 18.0, 2.0],
      ["20250228", "881273.TI", "白酒", "岩石股份", 3223.38, 0.31, 20, 10.04, 12.28, 103.0, 97.0, 5.0],
      ["20250228", "881170.TI", "小金属", "三祥新材", 3984.95, -0.46, 24, 10.0, 27.94, 31.0, 35.0, -4.0]
    ]
  }
}
```

# 个股资金流向（DC）

> 接口：`moneyflow_dc` | 获取东方财富个股资金流向数据，每日盘后更新。数据自2023年9月11日起

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 股票代码 |
| trade_date | str | N | 交易日期（YYYYMMDD格式） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| ts_code | str | 股票代码 |
| name | str | 股票名称 |
| pct_change | float | 涨跌幅（%） |
| close | float | 最新价 |
| net_amount | float | 今日主力净流入净额（万元） |
| net_amount_rate | float | 今日主力净流入占比（%） |
| buy_elg_amount | float | 今日超大单净流入净额（万元） |
| buy_elg_amount_rate | float | 今日超大单净流入占比（%） |
| buy_lg_amount | float | 今日大单净流入净额（万元） |
| buy_lg_amount_rate | float | 今日大单净流入占比（%） |
| buy_md_amount | float | 今日中单净流入净额（万元） |
| buy_md_amount_rate | float | 今日中单净流入占比（%） |
| buy_sm_amount | float | 今日小单净流入净额（万元） |
| buy_sm_amount_rate | float | 今日小单净流入占比（%） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "moneyflow_dc",
    "params": {"trade_date": "20250228", "ts_code": "000001.SZ"},
    "fields": "trade_date,ts_code,name,pct_change,close,net_amount,net_amount_rate"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "ts_code", "name", "pct_change", "close", "net_amount", "net_amount_rate", "buy_elg_amount", "buy_elg_amount_rate", "buy_lg_amount", "buy_lg_amount_rate", "buy_md_amount", "buy_md_amount_rate", "buy_sm_amount", "buy_sm_amount_rate"],
    "items": [
      ["20250228", "000001.SZ", "平安银行", -0.8, 11.17, -4422.05, -4.02, -2411.6, -2.19, -2010.45, -1.83, 3632.33, 3.3, 789.72, 0.72]
    ]
  }
}
```

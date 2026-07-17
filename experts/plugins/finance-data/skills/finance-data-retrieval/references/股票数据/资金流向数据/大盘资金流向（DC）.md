# 大盘资金流向（DC）

> 接口：`moneyflow_mkt_dc` | 获取东方财富大盘资金流向数据，每日盘后更新

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| trade_date | str | N | 交易日期（YYYYMMDD格式） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| close_sh | float | 上证收盘点位 |
| pct_change_sh | float | 上证涨跌幅（%） |
| close_sz | float | 深证收盘点位 |
| pct_change_sz | float | 深证涨跌幅（%） |
| net_amount | float | 今日主力净流入（元） |
| net_amount_rate | float | 今日主力净流入占比（%） |
| buy_elg_amount | float | 今日超大单净流入（元） |
| buy_elg_amount_rate | float | 今日超大单净流入占比（%） |
| buy_lg_amount | float | 今日大单净流入（元） |
| buy_lg_amount_rate | float | 今日大单净流入占比（%） |
| buy_md_amount | float | 今日中单净流入（元） |
| buy_md_amount_rate | float | 今日中单净流入占比（%） |
| buy_sm_amount | float | 今日小单净流入（元） |
| buy_sm_amount_rate | float | 今日小单净流入占比（%） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "moneyflow_mkt_dc",
    "params": {"trade_date": "20250228"},
    "fields": "trade_date,close_sh,pct_change_sh,close_sz,pct_change_sz,net_amount,net_amount_rate"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "close_sh", "pct_change_sh", "close_sz", "pct_change_sz", "net_amount", "net_amount_rate", "buy_elg_amount", "buy_elg_amount_rate", "buy_lg_amount", "buy_lg_amount_rate", "buy_md_amount", "buy_md_amount_rate", "buy_sm_amount", "buy_sm_amount_rate"],
    "items": [
      ["20250228", 3320.9, -1.98, 10611.24, -2.89, -130663522304.0, -7.0, -69844324352.0, -3.74, -60819197952.0, -3.26, 21733298176.0, 1.16, 108930228224.0, 5.83]
    ]
  }
}
```

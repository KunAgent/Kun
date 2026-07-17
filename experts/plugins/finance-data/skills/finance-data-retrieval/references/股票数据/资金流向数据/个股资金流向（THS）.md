# 个股资金流向（THS）

> 接口：`moneyflow_ths` | 获取同花顺个股资金流向数据，每日盘后更新

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
| latest | float | 最新价 |
| net_amount | float | 净流入金额（万元） |
| net_d5_amount | float | 5日主力净额（万元） |
| buy_lg_amount | float | 今日大单净流入（万元） |
| buy_lg_amount_rate | float | 今日大单净流入占比（%） |
| buy_md_amount | float | 今日中单净流入（万元） |
| buy_md_amount_rate | float | 今日中单净流入占比（%） |
| buy_sm_amount | float | 今日小单净流入（万元） |
| buy_sm_amount_rate | float | 今日小单净流入占比（%） |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "moneyflow_ths",
    "params": {"trade_date": "20250228", "ts_code": "000001.SZ"},
    "fields": "trade_date,ts_code,name,pct_change,latest,net_amount,buy_lg_amount"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "ts_code", "name", "pct_change", "latest", "net_amount", "net_d5_amount", "buy_lg_amount", "buy_lg_amount_rate", "buy_md_amount", "buy_md_amount_rate", "buy_sm_amount", "buy_sm_amount_rate"],
    "items": [
      ["20250228", "000001.SZ", "平安银行", -0.77, 11.53, -19117.97, -24194.23, -13028.88, -11.84, -3645.48, -3.31, -2443.61, -2.22]
    ]
  }
}
```

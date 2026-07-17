# 板块资金流向（DC）

> 接口：`moneyflow_ind_dc` | 获取东方财富板块资金流向数据，每日盘后更新

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 板块代码 |
| trade_date | str | N | 交易日期（YYYYMMDD格式） |
| start_date | str | N | 开始日期 |
| end_date | str | N | 结束日期 |
| content_type | str | N | 资金类型（行业、概念、地域） |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| trade_date | str | 交易日期 |
| content_type | str | 数据类型 |
| ts_code | str | DC板块代码 |
| name | str | 板块名称 |
| pct_change | float | 板块涨跌幅（%） |
| close | float | 板块最新指数 |
| net_amount | float | 今日主力净流入净额（元） |
| net_amount_rate | float | 今日主力净流入净占比（%） |
| buy_elg_amount | float | 今日超大单净流入净额（元） |
| buy_elg_amount_rate | float | 今日超大单净流入净占比（%） |
| buy_lg_amount | float | 今日大单净流入净额（元） |
| buy_lg_amount_rate | float | 今日大单净流入净占比（%） |
| buy_md_amount | float | 今日中单净流入净额（元） |
| buy_md_amount_rate | float | 今日中单净流入净占比（%） |
| buy_sm_amount | float | 今日小单净流入净额（元） |
| buy_sm_amount_rate | float | 今日小单净流入净占比（%） |
| buy_sm_amount_stock | str | 今日主力净流入最大股 |
| rank | int | 序号 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "moneyflow_ind_dc",
    "params": {"trade_date": "20250228"},
    "fields": "trade_date,name,pct_change,close,net_amount,net_amount_rate,rank"
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["trade_date", "content_type", "ts_code", "name", "pct_change", "close", "net_amount", "net_amount_rate", "buy_elg_amount", "buy_elg_amount_rate", "buy_lg_amount", "buy_lg_amount_rate", "buy_md_amount", "buy_md_amount_rate", "buy_sm_amount", "buy_sm_amount_rate", "buy_sm_amount_stock", "rank"],
    "items": [
      ["20250228", "概念", "BK0896.DC", "白酒", -0.57, 2101.28, 681968176.0, 2.26, 587108656.0, 1.95, 94859520.0, 0.31, -570356992.0, -1.89, -128997120.0, -0.43, "贵州茅台", 1],
      ["20250228", "概念", "BK0932.DC", "尾气治理", -2.42, 1392.52, 416139184.0, 2.95, 783328336.0, 5.55, -367189152.0, -2.6, -442182368.0, -3.13, 23065744.0, 0.16, "有研新材", 2],
      ["20250228", "概念", "BK0578.DC", "稀土永磁", -2.02, 2225.64, 305095376.0, 1.09, 951568848.0, 3.4, -646473472.0, -2.31, -452367616.0, -1.62, 168868352.0, 0.6, "有研新材", 3]
    ]
  }
}
```

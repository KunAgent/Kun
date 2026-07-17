# 实时盘口Tick快照

> 接口：`realtime_quote` | 获取A股实时盘口Tick快照数据，爬虫接口，仅支持Python SDK调用

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| ts_code | str | N | 股票代码（如 000001.SZ），sina源支持多只（逗号分隔，最多50只） |
| src | str | N | 数据源：sina-新浪（默认），dc-东方财富（仅单只） |

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| name | str | 股票名称 |
| ts_code | str | 股票代码 |
| date | str | 交易日期 |
| time | str | 交易时间 |
| open | float | 开盘价 |
| pre_close | float | 昨收价 |
| price | float | 现价 |
| high | float | 最高价 |
| low | float | 最低价 |
| bid | float | 竞买价（买一） |
| ask | float | 竞卖价（卖一） |
| volume | int | 成交量 |
| amount | float | 成交金额（元） |
| b1_v ~ b5_v | float | 委买一至五（量，手） |
| b1_p ~ b5_p | float | 委买一至五（价，元） |
| a1_v ~ a5_v | float | 委卖一至五（量，手） |
| a1_p ~ a5_p | float | 委卖一至五（价，元） |

## 调用说明

此接口为爬虫接口，数据来自网络，**不支持HTTP API调用**，仅支持Python SDK。0积分开放，需tushare账号。

```python
import tushare as ts

ts.set_token('YOUR_TOKEN')

# 新浪数据（支持多只）
df = ts.realtime_quote(ts_code='600000.SH,000001.SZ')

# 东财数据（仅单只）
df = ts.realtime_quote(ts_code='600000.SH', src='dc')
```

# 历史Tick行情

> 期货Tick高频行情数据，仅提供CSV网盘交付，不提供API接口

## 数据特点

- 近10年历史数据
- 一次性网盘拷贝，支持按交易所、日期定制
- 每天增量更新
- 独立数据服务，不在积分权限范畴

## 数据字段

| 字段 | 类型 | 说明 | 样例 |
|------|------|------|------|
| InstrumentID | string | 合约ID | cu2310 |
| BidPrice1 | float | 买一价 | 68190.0 |
| BidVolume1 | int | 买一量 | 4 |
| AskPrice1 | float | 卖一价 | 68212.0 |
| AskVolume1 | int | 卖一量 | 2 |
| LastPrice | float | 最新价 | 68210.0 |
| Volume | int | 成交量 | 3223 |
| Turnover | float | 成交金额 | 382577245.0 |
| OpenInterest | int | 持仓量 | 203332 |
| UpperLimitPrice | float | 涨停价 | 68210.0 |
| LowerLimitPrice | float | 跌停价 | 62210.0 |
| OpenPrice | float | 今开盘 | 68010.0 |
| PreSettlementPrice | float | 昨结算价 | 68110.0 |
| PreClosePrice | float | 昨收盘价 | 68113.0 |
| PreOpenInterest | int | 昨持仓量 | 3232343 |
| TradingDay | string | 交易日期 | 20230925 |
| UpdateTime | string | 更新时间 | 10:00:00.500 |

## 获取方式

微信联系 `waditu_a`，联系时请注明期货tick数据。

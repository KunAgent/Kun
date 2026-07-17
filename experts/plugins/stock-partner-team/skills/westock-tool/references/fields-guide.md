# WeStock Tool - 字段速查表

> **定位**：本文档是 SKILL.md 的 **L3 层补充材料**，提供选股工具支持的全部字段详细说明。
>
> **使用方式**：AI 在需要查阅具体字段名称、市场适用范围时按需加载本文档。命令用法和基本说明请参见
> [SKILL.md](../SKILL.md)。

---

> ⚠️ **市场差异**：不同市场的估值/盈利类字段名有差异（如沪深 `PE_TTM` vs 港美
> `PeTTM`），使用时请注意区分。 ⚠️ **市值单位差异**：沪深 `TotalMV` 单位为"元"，港股/美股 `TotalMV`
> 单位为"亿元"。 标注说明：**HS** = 沪深A股，**HK** = 港股，**US** = 美股

## 一、行情数据（Main）

### 1. 基础价格与成交

| 字段名         | 描述       | HS  | HK  | US  |
| -------------- | ---------- | :-: | :-: | :-: |
| ClosePrice     | 收盘价     | ✅  | ✅  | ✅  |
| OpenPrice      | 开盘价     | ✅  | ✅  | ✅  |
| HighPrice      | 最高价     | ✅  | ✅  | ✅  |
| LowPrice       | 最低价     | ✅  | ✅  | ✅  |
| PrevClosePrice | 昨收       | ✅  | ✅  | ✅  |
| AvgPrice       | 均价       | ✅  | ✅  | ✅  |
| ChangePrice    | 涨跌额     | ✅  | ✅  | ✅  |
| ChangePCT      | 涨跌幅(%)  | ✅  | ✅  | ✅  |
| RangePCT       | 振幅(%)    | ✅  | ✅  | ✅  |
| TurnoverVolume | 成交量     | ✅  | ✅  | ✅  |
| TurnoverValue  | 成交额     | ✅  | ✅  | ✅  |
| TurnoverRate   | 换手率(%)  | ✅  | ✅  | ✅  |
| VolumeRatio    | 量比       | ✅  | ✅  | ✅  |
| WbRatio        | 委比       | ✅  |  -  |  -  |
| Week52High     | 52周最高   | ✅  | ✅  | ✅  |
| Week52Low      | 52周最低   | ✅  | ✅  | ✅  |
| HistHigh       | 历史最高价 | ✅  | ✅  | ✅  |
| HistLow        | 历史最低价 | ✅  | ✅  | ✅  |

### 2. 多期涨跌幅

| 字段名  | 描述              | HS  | HK  | US  |
| ------- | ----------------- | :-: | :-: | :-: |
| Chg5D   | 5日涨跌幅(%)      | ✅  | ✅  | ✅  |
| Chg10D  | 10日涨跌幅(%)     | ✅  | ✅  | ✅  |
| Chg20D  | 20日涨跌幅(%)     | ✅  | ✅  | ✅  |
| Chg60D  | 60日涨跌幅(%)     | ✅  | ✅  | ✅  |
| Chg180D | 180日涨跌幅(%)    | ✅  | ✅  |  -  |
| Chg52W  | 52周涨跌幅(%)     | ✅  |  -  |  -  |
| ChgYtd  | 年初至今涨跌幅(%) | ✅  | ✅  | ✅  |

### 3. 市值与股本

| 字段名             | 描述         | HS  | HK  | US  | 备注                    |
| ------------------ | ------------ | :-: | :-: | :-: | ----------------------- |
| TotalMV            | 总市值       | ✅  | ✅  | ✅  | HS单位元，HK/US单位亿元 |
| NegotiableMV       | 流通市值     | ✅  | ✅  | ✅  | 同上                    |
| TotalShares        | 总股本       | ✅  | ✅  | ✅  |                         |
| FloatShares        | 流通股本     | ✅  | ✅  | ✅  |                         |
| TotalMVDiluted     | 总市值(稀释) |  -  |  -  | ✅  |                         |
| TotalSharesDiluted | 总股本(稀释) |  -  |  -  | ✅  |                         |

### 4. 估值指标

| 字段名           | 描述          | HS  | HK  | US  |
| ---------------- | ------------- | :-: | :-: | :-: | ---- |
| PE_TTM           | 市盈率TTM     | ✅  |  -  |  -  | - |
| PeTTM            | 市盈率TTM     |  -  | ✅  | ✅  | - |
| PE_Fwd           | 市盈率(动态)  | ✅  | ✅  | ✅  | - |
| PE_Lyr           | 市盈率(静态)  | ✅  | ✅  | ✅  | - |
| PB               | 市净率        | ✅  |  -  |  -  | - |
| PbLF             | 市净率LF      |  -  | ✅  | ✅  | - |
| PS_TTM           | 市销率TTM     | ✅  |  -  |  -  | - |
| PsTTM            | 市销率TTM     |  -  | ⚠️  |  -  | ⚠️ 港股仅选股查询支持，快照查询返回 0 |
| PCF_TTM          | 市现率TTM     | ✅  |  -  |  -  | - |
| PcfTTM           | 市现率TTM     |  -  | ⚠️  |  -  | ⚠️ 港股仅选股查询支持，快照查询返回 0 |
| DividendRatioTTM | 股息率TTM(%)  | ✅  |  -  |  -  | - |
| DivTTM           | 股息率TTM(%)  |  -  | ✅  | ✅  | - |
| AdjustPE_TTM     | 修正市盈率TTM | ✅  |  -  |  -  | - |
| AdjustPB_LF      | 修正市净率LF  | ✅  |  -  |  -  | - |

### 5. 估值百分位

| 字段名                                   | 描述            | HS  | HK  |
| ---------------------------------------- | --------------- | :-: | :-: |
| PE_TTMPct10Y / PE_TTMPct5Y / PE_TTMPct3Y | 市盈率TTM百分位 | ✅  |  -  |
| Pe_TTMPct10Y / Pe_TTMPct5Y / Pe_TTMPct3Y | 市盈率TTM百分位 |  -  | ✅  |
| PB_LFPct10Y / PB_LFPct5Y / PB_LFPct3Y    | 市净率LF百分位  | ✅  |  -  |
| Pb_LFPct10Y / Pb_LFPct5Y / Pb_LFPct3Y    | 市净率LF百分位  |  -  | ✅  |

### 6. 复权价格

| 字段名            | 描述                   | HS  | HK  | US  |
| ----------------- | ---------------------- | :-: | :-: | :-: |
| FwdOpenPrice      | 前复权开盘价           | ✅  | ✅  | ✅  |
| FwdClosePrice     | 前复权收盘价           | ✅  | ✅  | ✅  |
| FwdHighPrice      | 前复权最高价           | ✅  | ✅  | ✅  |
| FwdLowPrice       | 前复权最低价           | ✅  | ✅  | ✅  |
| BwdOpenPrice      | 后复权开盘价           | ✅  | ✅  |  -  |
| BwdClosePrice     | 后复权收盘价           | ✅  | ✅  |  -  |
| BwdHighPrice      | 后复权最高价           | ✅  | ✅  |  -  |
| BwdLowPrice       | 后复权最低价           | ✅  | ✅  |  -  |
| FwdClosePriceLag1 | 上一交易日前复权收盘价 | ✅  | ✅  | ✅  |

### 7. 技术指标

> ⚠️ 部分技术指标在美股（US）的 expression 条件筛选中暂不可用，详见备注。

| 字段名                                                 | 描述                 | 备注                    |
| ------------------------------------------------------ | -------------------- | ----------------------- |
| MA_5 / MA_10 / MA_20 / MA_30 / MA_60 / MA_120 / MA_250 | 均线系列             | 三市场通用              |
| EMA_12 / EMA_26 / EMA_50                               | 指数平滑移动均线     | 三市场通用              |
| DIF / DEA / MACD                                       | MACD指标             | ⚠️ 美股暂不支持条件筛选 |
| KDJ_K / KDJ_D / KDJ_J                                  | KDJ指标              | 三市场通用              |
| RSI_2 / RSI_6 / RSI_12 / RSI_24                        | RSI指标（RSI_2仅HS） | ⚠️ 美股暂不支持条件筛选 |
| BOLL_UPPER / BOLL_MID / BOLL_LOWER                     | 布林带               |                         |
| BIAS_6 / BIAS_12 / BIAS_24                             | 乖离率               |                         |
| CCI_14                                                 | 商品通道指标         |                         |
| SAR                                                    | 抛物线指标           |                         |
| PDI / MDI / ADX / ADXR                                 | 趋势指标             |                         |
| WR_6 / WR_10                                           | 威廉指数             |                         |
| OBV                                                    | 累积量能             |                         |
| TRIX / TRIXMA                                          | 三重指数             |                         |
| ENE / ENE_UPPER / ENE_LOWER                            | 轨道线               |                         |
| VR / VRMA                                              | 成交量变异率         |                         |
| BBI                                                    | 多空指数             |                         |
| AR / BR                                                | 人气/意愿指标        |                         |
| DPO / MADPO                                            | 去趋势价格振荡       |                         |
| PSY / PSYMA                                            | 心理线               |                         |
| NineTurn_Red9 / NineTurn_Green9                        | 神奇九转信号         |                         |

### 8. 资金流向

| 字段名                                          | 描述           | HS  | HK  |
| ----------------------------------------------- | -------------- | :-: | :-: |
| MainNetFlow                                     | 主力净流入     | ✅  | ✅  |
| JumboNetFlow                                    | 超大单净流入   | ✅  |  -  |
| BlockNetFlow                                    | 大单净流入     | ✅  |  -  |
| MidNetFlow                                      | 中单净流入     | ✅  |  -  |
| SmallNetFlow                                    | 小单净流入     | ✅  |  -  |
| MainInFlow / MainOutFlow                        | 主力流入/流出  | ✅  |  -  |
| RetailInFlow / RetailOutFlow                    | 散户流入/流出  | ✅  |  -  |
| TotalNetFlow                                    | 总净流入       |  -  | ✅  |
| RetailNetFlow                                   | 散户净流入     |  -  | ✅  |
| MainNetFlow5D / MainNetFlow10D / MainNetFlow20D | 历史主力净流入 | ✅  |  -  |
| MainInflowRank                                  | 主力净流入排名 | ✅  |  -  |
| MainInflowCircRate                              | 主力流入流通率 | ✅  |  -  |

### 9. 沪深特有行情字段

| 字段名                                    | 描述          |
| ----------------------------------------- | ------------- |
| PriceCeiling / PriceFloor                 | 涨停价/跌停价 |
| InternalVolume / ExternalVolume           | 内盘/外盘     |
| AfterTradeValue / AfterTradeVolume        | 盘后成交额/量 |
| Ifsuspend                                 | 是否停牌      |
| IsDelisted                                | 已退市标记    |
| ChipProfitRate                            | 筹码盈利率    |
| ChipAvgCost                               | 筹码平均成本  |
| ChipConcentration90 / ChipConcentration70 | 筹码集中度    |

### 10. 港股特有行情字段

| 字段名                                           | 描述        |
| ------------------------------------------------ | ----------- |
| Lot                                              | 每手股数    |
| ShortShares / ShortAmount / ShortRatio           | 卖空数据    |
| ADRConversionPrice                               | ADR转换价格 |
| ForecastInstitutions                             | 预测机构数  |
| TargetPriceAvg / TargetPriceMax / TargetPriceMin | 目标价      |
| RatingBuyCnt / RatingIncCnt / RatingHoldCnt      | 评级统计    |

### 11. 美股特有行情字段

| 字段名                                           | 描述        |
| ------------------------------------------------ | ----------- |
| ShortRatio / ShortShares / ShortRecoverDays      | 卖空数据    |
| EpsTTM                                           | 每股收益TTM |
| DrRatio                                          | DR比例      |
| ForecastInstitutions                             | 预测机构数  |
| TargetPriceAvg / TargetPriceMax / TargetPriceMin | 目标价      |

## 二、季度财务数据（QF）

### 1. 沪深(HS)核心财务字段

**利润表**：

| 字段名                 | 描述              | 单位  |
| ---------------------- | ----------------- | ----- |
| TotalOperatingRevenue  | 营业总收入        | 元    |
| OperatingRevenue       | 营业收入          | 元    |
| OperatingCost          | 营业成本          | 元    |
| OperatingProfit        | 营业利润          | 元    |
| TotalProfit            | 利润总额          | 元    |
| NPParentCompanyOwners  | 归属母公司净利润  | 元    |
| NPDeductNonRecurringPL | 扣非净利润        | 元    |
| BasicEPS / DilutedEPS  | 基本/稀释每股收益 | 元/股 |
| RAndD                  | 研发费用          | 元    |

**资产负债表**：

| 字段名                 | 描述           | 单位 |
| ---------------------- | -------------- | ---- |
| TotalAssets            | 资产总计       | 元   |
| TotalLiability         | 负债合计       | 元   |
| TotalShareholderEquity | 股东权益合计   | 元   |
| SEWithoutMI            | 归属母公司权益 | 元   |
| CashEquivalents        | 货币资金       | 元   |
| Inventories            | 存货           | 元   |
| GoodWill               | 商誉           | 元   |
| RetainedProfit         | 未分配利润     | 元   |

**现金流量表**：

| 字段名             | 描述                | 单位 |
| ------------------ | ------------------- | ---- |
| NetOperateCashFlow | 经营活动现金流净额  | 元   |
| NetInvestCashFlow  | 投资活动现金流净额  | 元   |
| NetFinanceCashFlow | 筹资活动现金流净额  | 元   |
| FCFF / FCFE        | 企业/股权自由现金流 | 元   |

**每股指标**：

| 字段名          | 描述           | 单位  |
| --------------- | -------------- | ----- |
| EPS             | 每股收益(摊薄) | 元/股 |
| NAPS            | 每股净资产     | 元/股 |
| OperCashFlowPS  | 每股经营现金流 | 元/股 |
| UndividedProfit | 每股未分配利润 | 元/股 |
| DividendPS      | 每股股利       | 元/股 |

**盈利与增长**：

| 字段名                     | 描述                         | 单位 |
| -------------------------- | ---------------------------- | ---- |
| ROEWeighted / ROE / ROECut | 净资产收益率(加权/摊薄/扣除) | %    |
| ROA / ROIC                 | 总资产净利率/投入资本回报率  | %    |
| GrossIncomeRatio           | 销售毛利率                   | %    |
| NetProfitRatio             | 销售净利率                   | %    |
| TORGrowRate                | 营业总收入同比增长率         | %    |
| NPParentCompanyYOY         | 归母净利润同比增长率         | %    |
| ORComGrowRate3Y            | 营收3年复合增长率            | %    |
| NPPCCGrowRate3Y            | 归母净利润3年复合增长率      | %    |

**偿债与运营**：

| 字段名                    | 描述                | 单位 |
| ------------------------- | ------------------- | ---- |
| CurrentRatio / QuickRatio | 流动比率/速动比率   | 无   |
| DebtAssetsRatio           | 资产负债率          | %    |
| DebtEquityRatio           | 产权比率            | %    |
| InventoryTRate / ARTRate  | 存货/应收账款周转率 | 次   |
| TotalAssetTRate           | 总资产周转率        | 次   |

**TTM 数据**：

| 字段名                   | 描述            | 单位  |
| ------------------------ | --------------- | ----- |
| OperatingRevenueTTM      | 营业收入(TTM)   | 元    |
| NPParentCompanyOwnersTTM | 归母净利润(TTM) | 元    |
| EPSTTM                   | 每股收益(TTM)   | 元/股 |
| ROETTM / ROATTM          | ROE/ROA(TTM)    | %     |
| GrossIncomeRatioTTM      | 毛利率(TTM)     | %     |
| NetProfitRatioTTM        | 净利率(TTM)     | %     |
| DividendTTM              | 股息(TTM)       | 元    |

**银行/保险/券商特有**：

| 字段名                 | 描述          |
| ---------------------- | ------------- |
| CapitalAdequacyRatio   | 资本充足率(%) |
| NonPerformingRatio     | 不良贷款率(%) |
| BLoanCoverRatio        | 拨备覆盖率(%) |
| InterestAvAcAssetRatio | 净息差(%)     |
| NetCapital             | 净资本        |

### 2. 港股(HK)核心财务字段

| 字段名                                     | 描述                     | 单位 |
| ------------------------------------------ | ------------------------ | ---- |
| OperatingIncome                            | 营业收入                 | 港元 |
| OperatingProfit                            | 经营溢利                 | 港元 |
| EarningBeforeTax                           | 税前溢利                 | 港元 |
| ProfitToShareholders                       | 归属母公司净利润         | 港元 |
| BasicEPS / EPS                             | 基本/摊薄每股收益        | 港元 |
| TotalAssets / TotalLiability               | 总资产/总负债            | 港元 |
| Cash                                       | 现金及等价物             | 港元 |
| CFO / CFI / CFF                            | 经营/投资/筹资现金流净额 | 港元 |
| GrossIncomeRatio                           | 销售毛利率(%)            |      |
| RoeWeighted / ROA                          | ROE/ROA(%)               |      |
| DebtAssetsRatio                            | 资产负债率(%)            |      |
| CurrentRatio / QuickRatio                  | 流动比率/速动比率        |      |
| OperatingRevenueGr1y / NpParentCompanyGr1y | 营收/净利润年增长率(%)   |      |

### 3. 美股(US)核心财务字段

| 字段名                         | 描述                            | 单位   |
| ------------------------------ | ------------------------------- | ------ |
| Sales / Sales_Q                | 营业收入(累计/单季)             | 百万元 |
| GrossIncome / GrossIncome_Q    | 毛利(累计/单季)                 | 百万元 |
| EBIT / EBIT_Q                  | 息税前利润(累计/单季)           | 百万元 |
| NetIncome / NetIncome_Q        | 净利润(累计/单季)               | 百万元 |
| BasicEPS / BasicEPS_Q          | 基本每股收益(累计/单季)         | 美元   |
| TotalAssets / TotalLiabilities | 总资产/总负债                   | 百万元 |
| CFO / CFI / CFF                | 经营/投资/筹资现金流(累计)      | 百万元 |
| FreeCF / FreeCF_Q              | 自由现金流(累计/单季)           | 百万元 |
| ROE / ROA                      | 净资产收益率/资产回报率(TTM)(%) |        |
| CurrentRatio / QuickRatio      | 流动比率/速动比率               |        |
| LiabilityToAsset               | 资产负债率(%)                   |        |
| GrossMargin / NetMargin        | 毛利率/净利率(%)                |        |
| BPS                            | 每股账面价值                    | 美元   |

## 三、基本信息（BI）

| 字段名                                          | 描述                 | HS  | HK  | US  |
| ----------------------------------------------- | -------------------- | :-: | :-: | :-: |
| SecuCode                                        | 股票代码             | ✅  | ✅  | ✅  |
| SecuName                                        | 证券简称             | ✅  | ✅  |  -  |
| CompanyName                                     | 公司名称             | ✅  |  -  | ✅  |
| ChineseName / EnglishName                       | 中文/英文名称        |  -  | ✅  | ✅  |
| ListedDate                                      | 上市日期             | ✅  | ✅  | ✅  |
| ListedState / ListedStatus                      | 上市状态             | ✅  | ✅  | ✅  |
| ListedSector                                    | 上市板块             | ✅  | ✅  |  -  |
| IssuePrice                                      | 发行价               | ✅  | ✅  |  -  |
| MainBusiness / Business                         | 主营业务             | ✅  | ✅  |  -  |
| Website                                         | 公司网址             | ✅  | ✅  | ✅  |
| BriefIntroduction                               | 公司简介             |  -  | ✅  | ✅  |
| SW1Name / SW2Name / SW3Name                     | 申万行业(一/二/三级) | ✅  |  -  |  -  |
| HSLevel1Name / HSLevel2Name / HSLevel3Name      | 恒生行业(一/二/三级) |  -  | ✅  |  -  |
| IndustryName / SectorName                       | 行业/板块分类        |  -  |  -  | ✅  |
| ComponentSZ50 / ComponentHS300 / ComponentZZ500 | 指数成分标记         | ✅  |  -  |  -  |
| ComponentHSI / ComponentHSTECH / ComponentHSCEI | 恒生指数成分标记     |  -  | ✅  |  -  |

---

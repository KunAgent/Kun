# WeStock Data - AI 深度参考指南

> **定位**：本文档提供详细的数据格式参考、分析模板。命令列表和基本用法请参见 [SKILL.md](../SKILL.md)。
> 完整分析场景示例请参见 [scenarios-guide.md](./scenarios-guide.md)。

---

## 一、输出格式

命令执行后输出 **Markdown 表格**，AI 直接从表格中读取数据进行分析。

**单股查询**：输出一个 Markdown 表格，每列对应一个数据字段。

**批量查询**：输出批量摘要行 + 每个 symbol 的独立表格。

**查询失败**：输出 JSON 格式的错误信息（含 `success: false` 和 `error` 对象）。

---

## 二、各命令数据格式

### 实时行情（`quote`）

输出表格列（共通字段，三市场均返回）：
`code | name | price | prevClose | open | high | low | volume | amount | change | changePercent | turnoverRate | volumeRatio | rangePct | avgPrice | peRatio | peFwd | peLyr | pbRatio | dividendRatioTtm | totalMarketCap | circulatingMarketCap | totalShares | floatShares | high52week | low52week | chg5d | chg10d | chg20d | chg60d | chgYtd`

#### 市场差异化字段（按 `market_type` 区分）

| 字段 | 说明 | A股 | 港股 | 美股 |
|------|------|:---:|:---:|:---:|
| `price_ceiling` | 涨停价（元） | ✅ | — | — |
| `price_floor` | 跌停价（元） | ✅ | — | — |
| `inner_volume` | 内盘（主动卖出量） | ✅ | — | — |
| `outer_volume` | 外盘（主动买入量） | ✅ | — | — |
| `wb_ratio` | 委比（%） | ✅ | ✅ | — |
| `lot` | 每手股数 | — | ✅ | — |
| `adr_conversion_price` | ADR 换算价（港元） | — | ✅ | — |
| `relative_hk_stock_price` | 相对港股价格 | — | ✅ | — |
| `relative_hk_stock_chg_pct` | 相对港股涨跌幅（%） | — | ✅ | — |
| `dividend_ttm` | 股息 TTM（元） | — | ✅ | ✅ |
| `eps_ttm` | 每股收益 TTM（元） | — | — | ✅ |

> `market_type` 取值：`1`=沪A，`51`=深A，`62`=北交所，`100`=港股，`200`=美股。
> 差异字段仅在对应市场返回，其他市场该字段为 `undefined`，分析时需先判断。

### K线（`kline`）

输出表格列：`date | open | last | high | low | volume | amount | exchange`

> K线数值为原始数值，AI 在分析时自行进行单位换算

### 资金数据

#### 港股（`hkfund`）

| 字段 | 单位 | 说明 |
|------|------|------|
| `TotalNetFlow` | 港元 | 总净流入 |
| `MainNetFlow` | 港元 | 主力净流入 |
| `RetailNetFlow` | 港元 | 散户净流入 |
| `ShortShares` | 股 | 卖空数量 |
| `ShortRatio` | % | 卖空比例 |
| `LgtHoldInfo` | json | 南下资金信息 |

#### A股（`asfund`）

| 字段 | 单位 | 说明 |
|------|------|------|
| `MainNetFlow` | 元 | 主力净流入（正=流入，负=流出）|
| `JumboNetFlow` | 元 | 超大单净流入 |
| `BlockNetFlow` | 元 | 大单净流入 |
| `MidNetFlow` | 元 | 中单净流入 |
| `SmallNetFlow` | 元 | 小单净流入 |

#### LgtHoldInfo 解析字段

| 字段 | 单位 | 说明 |
|------|------|------|
| `LgtHoldShares` | 股 | 持股数量 |
| `LgtHoldRatio` | % | 持股占比 |
| `LgtCapChgDaily` | 元/港元 | 当日增仓金额 |
| `LgtShareChgDaily` | 股 | 当日增仓股数 |
| `LgtCapChgQuarterly` | 元/港元 | 季度增仓金额 |
| `LgtShareChgQuarterly` | 股 | 季度增仓股数 |

#### 美股（`usfund`）

| 字段 | 单位 | 说明 |
|------|------|------|
| `ShortRatio` | % | 卖空比例 |
| `ShortShares` | 股 | 卖空股数 |
| `ShortRecoverDays` | 天 | 回补天数 |

### 机构评级（`rating`）

**A股**：输出表格，列含 `code | name | forecastInstitutions | targetPriceAvg | ratingBuyCnt | ratingIncCnt | ratingHoldCnt | ratingDecCnt | ratingSellCnt | ratingCnt`

**港股/美股**：同上，额外可能含 `earningsForecast`（盈利预测，JSON 格式）

> ⚠️ 港股/美股评级字段（ratingBuyCnt等）暂不返回，当前仅港股 `earningsForecast` 可用

### A股一致预期（`consensus`）

输出表格，列含 `code | name | targetPrice`，以及 `forecasts` 数组中的 `year | revenue | netProfit | eps | pe | pb | ps | revenueYoy | netProfitYoy | institutionCnt`

**分析要点**：目标价 vs 当前价（上涨空间）、EPS增速（盈利确定性）、PE走势（估值消化）、机构数（共识可信度）

### 技术指标（`technical`）

#### 截面查询

输出表格列：`code | name | date | closePrice | ma.MA_5 | ma.MA_10 | ... | macd.DIF | macd.DEA | macd.MACD | kdj.KDJ_K | ...`

嵌套对象（ma/macd/kdj/rsi/boll/bias/wr/dmi）的字段会展平为 `分组.字段名` 格式。

#### 历史区间查询

输出表格，每行一个交易日，列名同上。

### 筹码成本（`chip`）

#### 截面

输出表格列：`code | name | date | closePrice | chipProfitRate | chipAvgCost | chipConcentration90 | chipConcentration70`

#### 历史区间

输出表格，每行一个交易日，列名同上。

**解读**：盈利率>80%=获利盘占优；收盘价>平均成本=整体盈利；集中度越低=筹码越集中（主力控盘可能）

### 市场/指数/板块（`market`）

#### 截面（`MarketQuoteData`）关键字段

| 字段 | 说明 |
|------|------|
| `closePrice`/`changePct` | 收盘价/涨跌幅 |
| `chg5D`/`chg10D`/`chg20D`/`chg60D`/`chgYtd` | 多日涨跌幅(%) |
| `advancingCount`/`decliningCount` | 上涨/下跌家数 |
| `mainNetFlow`/`jumboNetFlow`/`blockNetFlow` | 主力/超大单/大单净流入（沪深，元）|
| `midNetFlow`/`smallNetFlow` | 中单/小单净流入（沪深，元）|
| `totalNetFlow`/`retailNetFlow` | 总/散户净流入（港股，港元）|

> ⚠️ 美股不支持资金流向字段

#### 历史区间

输出表格，每行一个交易日，含 `date | closePrice | changePct | mainNetFlow | ...`

### 排行数据（`rank`）

输出 Markdown 表格，列头为字段中文标签（来自 `list_data_schema`），如"市盈率TTM(倍)"、"股息率TTM(%)"等。

**返回信息**：
- 清单名称、查询日期、总条数
- 排序字段（中文标签）和方向（升序/降序）
- 分页信息（offset/limit/hasMore）
- 每行含股票代码、名称及各指标字段

**参数说明**：

| 参数 | 说明 | 可选值 |
|------|------|--------|
| 清单代码 | 排行清单代码，如 `fin_valuation` | 见 SKILL.md 排行清单表 |
| --limit | 每页条数，默认20，最大50 | 数字 |
| --offset | 偏移量，默认0 | 数字 |
| --desc | 排序方向，默认true（降序） | `true`/`false` |

> 字段中文标签由 API 的 `list_data_schema` 自动解析，无需手动映射

---

### 市场资讯（`marketnews`）

输出 Markdown 表格，列含 `time | id | type | symbol | title | url | ...`

**预设市场**：`hs`(沪深)、`sh`(沪市)、`sz`(深市)、`hk`(港股)、`us`(美股)，或自定义逗号分隔指数代码

### 分红数据（`dividend`）

输出表格，字段因市场不同：

- **A股**：`reportEndDate | dividendFlag | procedure | dividendType | proposalSn | rightRegDate | exDiviDate | bonusShareRatio | tranAddShareRatio | cashDiviRMB | totalCashDiviComRMB | dividendPlan`
- **港股**：`reportEndDate | exDiviDate | cashPayDate | cashDivPerShare | specialDivPerShare | totalCashDivi | dividendPlan`
- **美股**：`exDivDate | regDate | payDate | dividendCurrency | dividend | dividendPlan`

> 美股可能额外包含 `splitInfo`（拆合股信息）

**参数说明**：
- 默认查询最近分红数据
- `--years N`：查询近N年分红历史（如 `--years 5`、`--years 10`）
- `--all`：返回所有记录（含未实施分红方案），默认只返回已实施分红的记录
- 返回记录按报告期/除权日降序排列（最新的在前）

### 业绩预告（`reserve`）

输出表格，字段因市场不同：

- **A股**：`reportEndDate | disclosureEndDate | disclosureDate | disclosureDesc`
- **港股**：`reportEndDate | disclosureDesc`
- **美股**：`reportEndDate | disclosureDate | disclosureDesc`

### 命令参数详细说明

#### news（新闻列表）

| 参数位置 | 说明 | 可选值 |
|---------|------|--------|
| 代码 | 股票代码，支持逗号分隔批量 | - |
| 页码 | 页码，默认1 | 数字，从1开始 |
| 每页数量 | 每页返回条数，默认20 | 数字 |
| 类型 | 新闻类型 | `0`=公告，`1`=研报，`2`=新闻，`3`=全部（默认） |

#### notice（公告）

| 参数位置 | 说明 | 可选值 |
|---------|------|--------|
| 代码 | 股票代码，支持逗号分隔批量 | - |
| 类型 | 公告类型 | `0`=全部（默认），`1`=财务，`2`=配股，`3`=增发，`4`=股权变动，`5`=重大事项，`6`=风险，`7`=其他 |

#### report（研报列表）

| 参数位置 | 说明 | 可选值 |
|---------|------|--------|
| 代码 | 股票代码，支持逗号分隔批量 | - |
| 页码 | 页码，默认1 | 数字，从1开始 |
| 每页数量 | 每页返回条数，默认20 | 数字 |
| 类型 | 研报类型 | `0`=全部（默认），`1`=研报，`2`=业绩会 |

#### calendar（投资日历）

| 参数位置 | 说明 | 可选值 |
|---------|------|--------|
| 日期 | 查询日期，不传则返回有事件的日期列表 | `YYYY-MM-DD` |
| 天数 | 向后查询天数，默认30 | 数字 |
| 地区 | 筛选地区 | `1`=中国，`2`=美国，`3`=港股，不传=全部 |
| 指标类型 | 筛选指标类型 | `1`=经济，`2`=央行，`3`=事件，`4`=休市，不传=全部 |

#### market（市场/指数/板块）

| 参数 | 说明 |
|------|------|
| 代码 | 指数/板块代码，支持逗号分隔批量 |
| 日期（1个） | 截面查询，返回指定日期的数据 |
| 日期（2个） | 历史区间查询，返回起始到结束日期的历史数据 |

#### lgt（沪股通/深股通成份股）

| 参数位置 | 说明 | 可选值 |
|---------|------|--------|
| 市场 | 沪股通或深股通 | `sh`=沪股通，`sz`=深股通 |
| 页码 | 页码，默认1 | 数字，从1开始 |
| 每页数量 | 每页返回条数，默认20，最多100 | 数字 |

---

## 三、货币单位处理

> ⚠️ **重要**：港股财报返回港元/美元，美股返回美元，展示时**必须**标注正确货币单位

**港股**：检查 `CurrencyType`（"港币"/"美元"/"人民币"）和 `CurrencyUnit` 字段
- ✅ 正确：`营业收入：832.3亿港元`
- ❌ 错误：`营业收入：¥832.3亿`

**跨期对比注意**：同比/环比增长率可能受汇率换算影响，展示时建议添加说明：`"注：同比数据可能受汇率波动影响"`

---

## 四、单位换算

| 数据类型 | 原始单位 | 转换 |
|---------|---------|------|
| 成交量 | 手 | ÷10000=万手 |
| 成交额/市值/主力资金 | 元 | ÷100000000=亿元 |
| 港股金额 | 港元 | ÷100000000=亿港元 |
| 美股金额 | 美元 | ÷100000000=亿美元 |
| 卖空数量 | 股 | ÷1000000=百万股 |

---

## 四点五、ETF 数据字段

### ETF 详情（`etf`）

| 字段 | 说明 |
|------|------|
| `etfType` | ETF类别 |
| `establishDate` | 成立日期 |
| `manageInstitution` | 管理人 |
| `trusteeInstitution` | 托管人 |
| `trackIndexCode/Name` | 跟踪指数代码/名称 |
| `isTPlus0` | 是否支持T+0 |
| `subscriptionFee` | 新发认购费率(%) |
| `managementFee` | 管理费率(%) |
| `custodyFee` | 托管费率(%) |
| `serviceFee` | 销售服务费(%) |
| `nav` | 单位净值 |
| `disc` | 溢折率(%) |
| `size` | 规模 |
| `shares` | 份额 |
| `sharesChg` | 净申购份额 |
| `sharesChgRatio` | 净申购比例(%) |
| `discountRatioCurve` | 溢折率(曲线) |
| `avgDiscountRatioCurve` | 同指数平均溢折率 |
| `indexDailyChange` | 跟踪指数当日涨跌幅(%) |
| `index1YReturn` | 跟踪指数近1年年化收益(%) |
| `ytdReturn` | 今年以来收益率(%) |
| `return1M/3M/6M/1Y/3Y` | 近1月/3月/6月/1年/3年收益率(%) |
| `ytdMaxDrawdown` | 今年以来最大回撤(%) |
| `maxDrawdown1M/3M/6M/1Y/3Y` | 近N月最大回撤(%) |
| `topStockChanges` | 重仓股票涨跌幅(JSON数组) |

### topStockChanges 解析字段

| 字段 | 说明 |
|------|------|
| `code` | 股票代码 |
| `name` | 股票名称 |
| `ratio` | 占比(%) |
| `rate` | 涨跌幅(%) |
| `change` | 较上期占比变化 |

---

## 四点六、公司回购字段

### 回购数据（`buyback`）

**港股字段**：
| 字段 | 说明 |
|------|------|
| `BuybackShares` | 回购股份(股) |
| `BuybackMoney` | 回购金额(港元) |
| `BuybackPrice` | 回购均价(港元) |
| `BuybackCumMoney` | 本轮回购累计金额(港元) |

**A股字段**（BuybackAttach 数组）：
| 字段 | 说明 |
|------|------|
| `BuybackFunds` | 本次回购资金(元) |
| `BuybackSum` | 本次回购数量(股) |
| `BuybackPrice` | 本次回购均价(元) |

> 回购数据按日期降序排列，仅返回有回购记录的交易日

---

### 风险事件（`risk`）

#### 特别处理（ST）

| 字段 | 说明 |
|------|------|
| `type` | 特别处理类型（ST/\*ST/SST/撤销ST） |
| `explain` | 事项描述 |
| `date` | 信息发布日期 |
| `riskLevel` | 风险等级：high（高风险）、medium（中风险）、low（低风险） |

#### 股权质押

| 字段 | 说明 |
|------|------|
| `date` | 股权质押披露截止日期 |
| `floatPledgedVolume` | 无限售股份质押数量（万股） |
| `nonFloatPledgedVolume` | 有限售股份质押数量（万股） |
| `pledgeNum` | 质押笔数 |
| `pledgeRatio` | 质押比例 |
| `totalPledge` | 质押数量（万股） |
| `riskLevel` | 风险等级：high（质押比例≥50%）、medium（30%-50%）、low（<30%） |

#### 解禁信息

| 字段 | 说明 |
|------|------|
| `initialInfoPublDate` | 解禁信息首次发布日期 |
| `infoPublDate` | 解禁信息最新发布日期 |
| `estimateActual` | 解禁日期类型 |
| `shareHolderName` | 解禁股东名 |
| `changeReason` | 解禁原因 |
| `restrictedCondition` | 限售条件说明 |
| `newAFloatListed` | 新增可售A股 |
| `actualFloatListedShares` | 实际上市流通数量 |
| `riskLevel` | 风险等级：high、medium、low |

#### 诉讼仲裁

| 字段 | 说明 |
|------|------|
| `date` | 诉讼仲裁最新公告日期 |
| `actionDesc` | 行为描述 |
| `subjectMatterStat` | 案由简称 |
| `latestSuitSum` | 涉诉金额（元） |
| `eventSubject` | 事件主体 |
| `eventSubjectRole` | 事件主体在诉讼中的角色 |
| `plaintiff` | 诉讼仲裁原告 |
| `defendant` | 诉讼仲裁被告 |
| `plaintiffAssociation` | 原告与上市公司关联关系 |
| `defendantAssociation` | 被告与上市公司关联关系 |
| `caseStatus` | 仲裁状态 |
| `firstInstanceStatus` | 一审状态 |
| `secondInstanceStatus` | 二审状态 |
| `sppStatus` | 最高院监督状态 |
| `adjudgementStatus` | 判决执行状态 |
| `riskLevel` | 风险等级：high（涉诉金额>1亿或作为被告）、medium（>1000万）、low |

#### 增发信息

| 字段 | 说明 |
|------|------|
| `issueType` | 增发类别 |
| `eventProcedure` | 事件进程 |
| `advanceDate` | 预案公告日期 |
| `smDeciPublDate` | 决案公告日期 |
| `intentLetterPublDate` | 意向书发布日期 |
| `prospectusPublDate` | 新股说明书发布日期 |
| `sacApprovalPublDate` | 国资委通过日期 |
| `csrcApprovalPublDate` | 证监会批准日期 |
| `advanceValidStartDate` | 预案有效期起始日期 |
| `advanceValidEndDate` | 预案有效期截止日期 |
| `newSharesListDate` | 增发新股上市日期 |
| `stockType` | 增发A股类型 |
| `issuePurpose` | 增发目的 |
| `issueObject` | 发行对象 |
| `issuePriceCeiling` | 发行价上限（元） |
| `issuePriceFloor` | 发行价下限（元） |
| `issuePrice` | 每股发行价（元） |
| `issueVol` | 发行量（万股） |
| `seoProceeds` | 增发新股募集资金总额（元） |
| `seoNetProceeds` | 增发新股募集资金净额（元） |

> **注意**：风险事件只提供客观数据展示，不进行主观评分或风险等级判定。用户需根据实际情况自行判断风险程度。

---

## 五、分析模板

### 成交量分析

1. `kline <CODE> day 20` → 从表格中提取 `volume` 列
2. 计算：平均值、最大/最小值、前10日均值 vs 后10日均值
3. 识别：放量日（>均值×1.5）、缩量日（<均值×0.5）

### 资金流向分析

**A股**：`asfund <CODE>` → 提取 `MainNetFlow`/`JumboNetFlow`/`BlockNetFlow` → 转换单位（元→亿元）→ 统计净流入/流出天数

**港股**：`hkfund <CODE>` → 提取 `TotalNetFlow`/`MainNetFlow`/`ShortRatio`/`LgtHoldInfo` → 分析主力趋势、卖空占比、南下资金变化

**美股**：`usfund <CODE>` → `ShortRatio`>10%需关注，`ShortRecoverDays`>5天需关注

**指数/板块**：`market <CODE>` → 提取 `mainNetFlow`/`jumboNetFlow`/`blockNetFlow` → 转换单位 → 判断主力方向

### 技术指标分析

**MACD**：DIF与DEA交叉（金叉=买信号/死叉=卖信号）、MACD柱正负变化、DIF/DEA相对0轴位置

**KDJ**：K与D交叉、J值>80超买/<20超卖

**RSI**：RSI_6>70超买/<30超卖，RSI_6与RSI_12背离

**均线**：多头排列（MA5>MA10>MA20>MA60）、MA60/120/250作为支撑/压力位

### 筹码趋势分析（历史区间）

- 盈利率上升 = 获利盘增加（股价上涨）
- 平均成本抬升 = 筹码成本中枢上移（主力可能建仓）
- 集中度下降 = 筹码趋于集中（主力吸筹控盘）
- 集中度上升 = 筹码趋于分散（可能派发）

### 机构评级分析（港股/美股）

1. 评级共识度：`(ratingBuyCnt + ratingIncCnt) / ratingCnt`
2. 目标均价 vs 当前价 → 上涨/下跌空间
3. 港股：`earningsForecast` EPS × 目标PE → 合理估值区间

### A股一致预期分析

1. 目标价 vs 当前价 → 上涨空间
2. 多年度EPS增速 → 盈利增长确定性
3. PE走势 → 估值是否逐年降低（估值消化）
4. `institutionCnt` → 共识覆盖度

### 宏观经济数据分析

**可用指标**：

| 指标代码 | 名称 | 分组 | 查询方式 |
|----------|------|------|----------|
| `gdp` | GDP数量指标 | GDP | `--year` |
| `cpi_ppi` | GDP价格指标(CPI/PPI) | GDP | `--year` |
| `pmi` | GDP供给指标(PMI) | GDP | `--year` / `--start` `--end` |
| `profit` | GDP供给指标(工业企业利润) | GDP | `--year` |
| `value_added` | GDP供给指标(工业增加值) | GDP | `--year` |
| `consumption` | GDP需求指标(消费) | GDP | `--year` |
| `investment` | GDP需求指标(投资) | GDP | `--year` |
| `financing` | 货币需求指标 | 货币 | `--year` |
| `fundquantity` | 货币供给指标(数量) | 货币 | `--year` |
| `fundcost` | 货币供给指标(利率) | 货币 | `--year` |
| `core_indicatros_cur` | 最新核心宏观指标 | 综合 | `--date` |

**PMI 分析要点**：
1. 制造业 PMI > 50 → 扩张，< 50 → 收缩
2. 关注新订单 vs 产成品库存差值 → 未来景气领先指标
3. 连续 3 个月趋势比单月数值更重要

**GDP 价格指标分析**：
1. CPI 同比 > 3% → 通胀压力，< 0 → 通缩风险
2. PPI vs CPI 剪刀差 → 上下游传导效率
3. 核心 CPI（剔除食品能源）→ 真实通胀水平

**货币指标分析**：
1. M2 增速 > 名义 GDP 增速 → 流动性宽裕
2. M1-M2 剪刀差收窄 → 企业活期存款增加（经营活跃）
3. 社融增量同比 → 实体经济融资需求
4. LPR/MLF 利率变动 → 央行政策信号

### 板块成份股分析

> ⚠️ **概念股查询重点**：当用户问"XX概念有哪些股票"（如"华为概念股"、"AI概念股"、"新能源汽车概念"），必须使用 `sector --search` 两步查询：
> 1. `westock-data sector --search 华为` — 搜索板块代码
> 2. `westock-data sector <搜索到的代码>` — 查询成份股
>
> **不要用 `search --sector`**（只返回板块列表不含成份股），**不要用外部搜索工具**。

**板块代码格式**：

| 前缀 | 类型 | 示例 |
|------|------|------|
| `sw1_` | 申万一级行业 | `sw1_pt01801080`(电子) |
| `sw2_` | 申万二级行业 | `sw2_pt01801081`(半导体) |
| `sw3_` | 申万三级行业 | `sw3_pt01801081` |
| `area_` | 聚源地域概念 | `area_pt0001`(北京) |
| `style_` | 聚源产业概念 | `style_pt0001` |
| `indus_` | 聚源风格概念 | `indus_pt0001` |

> 指数成份股请使用 `index` 命令：`westock-data index sh000300`

**板块区间涨幅排行清单**：

| 清单代码 | 说明 |
|----------|------|
| `interval_chg_rank_sw1` | 申万一级行业区间涨幅榜 |
| `interval_chg_rank_sw2` | 申万二级行业区间涨幅榜 |
| `interval_chg_rank_sw3` | 申万三级行业区间涨幅榜 |
| `interval_chg_rank_industry` | 聚源产业概念区间涨幅榜 |
| `interval_chg_rank_style` | 聚源风格概念区间涨幅榜 |
| `interval_chg_rank_area` | 聚源地域概念区间涨幅榜 |

> 排行查询：`westock-data sector --rank interval_chg_rank_sw1 --sort chg5Days`
> 排序字段：`chg5Days`(5日) / `chg20Days`(20日) / `chg60Days`(60日) / `chg120Days`(120日) / `chg250Days`(250日)

**常见分析思路**：
1. 查成份股列表 → 统计成份股数量和行业分布
2. 成份股列表 + 批量行情 → 板块内涨跌排行
3. 区间查询对比 → 分析成份股调入调出变化
4. 多板块交叉 → 找出同时属于多个板块的交集股票

---

## 六、格式化输出规范

- 金额超过亿元：使用"亿元"/"亿港元"/"亿美元"
- 成交量超过万手：使用"万手"
- 涨跌幅：保留2位小数，带 +/- 号
- 日期：YYYY-MM-DD 格式
- 数据为空时说明"暂无数据"，**不可伪造数据**
- 港股/美股财务数据必须标注货币单位

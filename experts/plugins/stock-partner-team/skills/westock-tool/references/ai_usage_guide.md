# WeStock Tool - AI 深度参考指南

> **定位**：本文档提供选股工具的详细返回数据格式、分析模板，以及完整的策略/标签代码列表。命令列表和基本用法请参见 [SKILL_workbuddy.md](../SKILL_workbuddy.md)。
> 完整字段列表请参见 [fields-guide.md](./fields-guide.md)。

---

## 一、返回数据格式

### 格式化输出（默认）

输出 Markdown 表格，每行一只股票，列含股票代码、名称、收盘价、涨跌幅及表达式涉及的指标字段：

```
| code | name | ClosePrice | ChangePCT | PE_TTM | ROETTM |
| --- | --- | --- | --- | --- | --- |
| sh600519 | 贵州茅台 | 1690.00 | 1.25 | 28.50 | 32.15 |
| sz000001 | 平安银行 | 12.50 | -0.32 | 5.80 | 16.20 |
...
```

### 原始 JSON（`--raw`）

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "total": 156,
    "returned": 20,
    "items": [
      {
        "SecuCode": "sh600519",
        "SecuName": "贵州茅台",
        "ClosePrice": 1690.00,
        "ChangePCT": 1.25,
        "PE_TTM": 28.50,
        "ROETTM": 32.15,
        "TotalMV": 2123000000000,
        "TurnoverRate": 0.35
      }
    ]
  }
}
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| `code` | 状态码，`0` 表示成功 |
| `data.total` | 符合条件的股票总数 |
| `data.returned` | 实际返回数量 |
| `data.items` | 股票列表，始终包含 `SecuCode`/`SecuName`/`ClosePrice`/`ChangePCT`，动态包含表达式中的字段 |

### 港股/美股字段差异

> 详见 [SKILL_workbuddy.md](../SKILL_workbuddy.md) 「常用字段速查」，沪深市值 `TotalMV` 单位为"元"，港美为"亿元"。

---

## 二、分析模板

### 3.1 价值选股

```bash
# 低PE（PE < 15）
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15])" --date 2026-03-12 --limit 20 --orderby PE_TTM:asc

# 高股息（股息率 > 5%）
westock-tool filter "DividendRatioTTM > 5" --date 2026-03-12 --limit 20 --orderby DividendRatioTTM:desc

# PEG策略（净利润增速 > 25%，PEG < 1）
westock-tool filter "intersect([PE_TTM > 0, NetProfitGrowRate > 25, PE_TTM / NetProfitGrowRate < 1])" --date 2026-03-12 --limit 20

# 低估值高ROE（PE < 15，ROE > 15%）
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15, ROETTM > 15])" --date 2026-03-12 --limit 20 --orderby ROETTM:desc

# 破净股（PB < 1）
westock-tool filter "intersect([PB > 0, PB < 1])" --date 2026-03-12 --limit 20 --orderby PB:asc
```

**分析要点**：PE_TTM 分布（中位数/均值）、ROETTM 排名、结合市值和行业分类汇总

### 3.2 技术面选股

```bash
# 均线多头排列（MA5 > MA10 > MA20 > MA60）
westock-tool filter "intersect([MA_5 > MA_10, MA_10 > MA_20, MA_20 > MA_60])" --date 2026-03-12 --limit 20

# MACD金叉（DIF > DEA）
westock-tool filter "DIF > DEA" --date 2026-03-12 --limit 20

# KDJ超卖（KDJ_J < 15）
westock-tool filter "KDJ_J < 15" --date 2026-03-12 --limit 20 --orderby KDJ_J:asc

# RSI超卖（RSI_6 < 25）
westock-tool filter "RSI_6 < 25" --date 2026-03-12 --limit 20 --orderby RSI_6:asc

# 神奇九转绿9信号
westock-tool filter "NineTurn_9 = 1" --date 2026-03-12 --limit 20

# 布林带突破上轨
westock-tool filter "ClosePrice > BollingerUpper" --date 2026-03-12 --limit 20
```

**分析要点**：均线间距（趋势强度）、配合换手率（TurnoverRate）验证、配合 MACD 交叉确认

### 3.3 资金面选股

```bash
# 主力净流入 > 1亿
westock-tool filter "MainNetFlow > 100000000" --date 2026-03-12 --limit 20 --orderby MainNetFlow:desc

# 主力持续流入（5/10/20日均为正）
westock-tool filter "intersect([MainNetFlow5D > 0, MainNetFlow10D > 0, MainNetFlow20D > 0])" --date 2026-03-12 --limit 20

# 主力5日流入 > 5亿
westock-tool filter "MainNetFlow5D > 500000000" --date 2026-03-12 --limit 20 --orderby MainNetFlow5D:desc

# 高换手率（> 5%）
westock-tool filter "TurnoverRate > 5" --date 2026-03-12 --limit 20 --orderby TurnoverRate:desc
```

**分析要点**：资金流入持续性、配合涨跌幅判断是否拉升期、筛选"主力流入但涨幅不大"的潜力股

### 3.4 财务分析选股

```bash
# 高ROE（ROE > 20%）
westock-tool filter "ROETTM > 20" --date 2026-03-12 --limit 20 --orderby ROETTM:desc

# 高成长（营收增速 > 30%，净利润增速 > 40%）
westock-tool filter "intersect([RevenueGrowRate > 30, NetProfitGrowRate > 40])" --date 2026-03-12 --limit 20 --orderby NetProfitGrowRate:desc

# 低负债（资产负债率 < 40%）
westock-tool filter "DebtRatio < 40" --date 2026-03-12 --limit 20 --orderby DebtRatio:asc

# 正经营现金流
westock-tool filter "OCFPS > 0" --date 2026-03-12 --limit 20

# 高ROE低负债（ROE > 15%，负债率 < 50%）
westock-tool filter "intersect([ROETTM > 15, DebtRatio < 50])" --date 2026-03-12 --limit 20 --orderby ROETTM:desc
```

### 3.5 组合策略选股

```bash
# 高股息+低估值（股息率 > 4%，PE < 12，PB < 1.5）
westock-tool filter "intersect([DividendRatioTTM > 4, PE_TTM > 0, PE_TTM < 12, PB > 0, PB < 1.5])" --date 2026-03-12 --limit 20 --orderby DividendRatioTTM:desc

# 白马成长（高ROE + 稳定增长）
westock-tool filter "intersect([ROETTM > 15, RevenueGrowRate > 15, NetProfitGrowRate > 15])" --date 2026-03-12 --limit 20 --orderby ROETTM:desc

# 困境反转（近期跌幅大但开始反弹）
westock-tool filter "intersect([Chg20D < -20, Chg5D > 0, Chg5D < 10])" --date 2026-03-12 --limit 20 --orderby Chg5D:desc

# 小盘价值（市值20-100亿，PE < 20）
westock-tool filter "intersect([TotalMV > 2000000000, TotalMV < 10000000000, PE_TTM > 0, PE_TTM < 20])" --date 2026-03-12 --limit 20 --orderby PE_TTM:asc

# 技术面+基本面组合（均线多头 + 低PE + 高ROE）
westock-tool filter "intersect([MA_5 > MA_10, MA_10 > MA_20, PE_TTM > 0, PE_TTM < 25, ROETTM > 12])" --date 2026-03-12 --limit 20 --orderby ROETTM:desc

# 次新股高成长（上市1年内 + 高增长）
westock-tool filter "intersect([ListDate > 20250317, RevenueGrowRate > 30])" --date 2026-03-12 --limit 20
```

### 3.6 机构评级选股（港股/美股）

```bash
# 港股高机构评级（买入评级 >= 8家）
westock-tool filter "BuyRatingNum >= 8" --date 2026-03-12 --limit 20 --orderby BuyRatingNum:desc --market hk

# 港股目标价上行空间（> 30%）
westock-tool filter "TargetPriceUpside > 30" --date 2026-03-12 --limit 20 --orderby TargetPriceUpside:desc --market hk

# 美股高机构评级
westock-tool filter "BuyRatingNum >= 8" --date 2026-03-12 --limit 20 --orderby BuyRatingNum:desc --market us

# 港股低估值 + 高评级
westock-tool filter "intersect([PeTTM > 0, PeTTM < 15, BuyRatingNum >= 5])" --date 2026-03-12 --limit 20 --market hk
```

### 3.7 按板块筛选

使用 `--universe` 限定选股范围，板块代码通过 `westock-data search <关键词> sector` 获取（去掉 `pt` 前缀）：

```bash
# 在华为概念板块中筛选低PE股票
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 25])" --date 2026-03-12 --limit 20 --orderby PE_TTM:asc --universe 02021291

# 在人工智能板块中筛选高ROE股票
westock-tool filter "ROETTM > 15" --date 2026-03-12 --limit 20 --orderby ROETTM:desc --universe 02003800
```

**常见板块代码**（可通过 westock-data 搜索获取最新代码）：

| 板块名称 | 代码 | 板块名称 | 代码 |
|---------|------|---------|------|
| 华为概念 | 02021291 | 人工智能 | 02003800 |
| 华为昇腾 | 02GN2032 | 人形机器人 | 02GN2238 |
| 华为鸿蒙 | 02101423 | 低空经济 | 02GN2294 |
| 华为算力 | 02GN2266 | 半导体 | 02003010 |
| AI大模型 | 02GN2228 | 数据要素 | 02GN2200 |
| AI算力芯片 | 02GN2222 | 算力租赁 | 02GN2234 |

### 3.8 港股低估值高股息

```bash
# 港股高股息低估值（股息率 > 6%，PE < 8，PB < 0.8）
westock-tool filter "intersect([PeTTM > 0, PeTTM < 8, DivTTM > 6, PbLF > 0, PbLF < 0.8])" --date 2026-03-12 --limit 20 --orderby DivTTM:desc --market hk

# 港股低估值蓝筹（PE < 10，市值 > 500亿）
westock-tool filter "intersect([PeTTM > 0, PeTTM < 10, TotalMV > 500])" --date 2026-03-12 --limit 20 --orderby TotalMV:desc --market hk

# 美股低估值高股息
westock-tool filter "intersect([PeTTM > 0, PeTTM < 15, DivTTM > 3])" --date 2026-03-12 --limit 20 --orderby DivTTM:desc --market us
```

> ⚠️ 港股/美股市值单位为"亿元"，沪深为"元"，构建条件时注意换算

### 3.9 标签选股

标签选股适用于快速按分类获取股票列表，无需手写表达式。常见场景：

```bash
# 查看央企公司
westock-tool label shareholder_central_state --date 2026-04-10

# 查看国企 + 央企（多标签）
westock-tool label shareholder_central_state,shareholder_local_state --date 2026-04-10 --limit 50

# 查看千元股
westock-tool label price_up1000 --date 2026-04-10

# 查看超大盘股
westock-tool label marketcap_super_big --date 2026-04-10

# 查看近期次新股
westock-tool label listeddate_3mons --date 2026-04-10

# 查看 ST 股票（风险提示）
westock-tool label risk_st --date 2026-04-10

# 查看破净股（使用 filter 表达式）
westock-tool filter "intersect([PB > 0, PB < 1])" --date 2026-04-10 --orderby PB:asc

# 查看高ROE股票（使用 filter 表达式）
westock-tool filter "ROETTM > 15" --date 2026-04-10 --limit 50 --orderby ROETTM:desc

# 查看业绩预增股（使用 filter 表达式）
westock-tool filter "NPParentCompanyYOY > 50" --date 2026-04-10 --orderby NPParentCompanyYOY:desc
```

**分析要点**：
- 标签选股返回的是符合该分类的股票列表，适合快速了解某类股票的整体情况
- 可以多个标签组合查询，了解交叉分类的股票
- 标签选股结果可以进一步用 `westock-data` 查询个股详情进行深度分析
- 标签选股仅支持 A 股

**标签 + 条件选股联动**：

```bash
# 先用标签找出央企股票，再用 filter 在其中筛选低估值高股息
westock-tool label shareholder_central_state --date 2026-04-10 --limit 100
# → 从结果中提取股票代码列表
# → westock-data quote <央企代码列表>  # 查看行情进一步筛选
```

---

## 四、错误处理

- 检查返回 JSON 的 `code` 字段，`0` 表示成功，非 `0` 时查看 `msg` 获取原因
- 常见错误：字段名混用（如沪深用了 `PeTTM`）、港股/美股未指定 `--market`、表达式语法错误

---

**记住**：选股查询是 Skill 的职责，数据分析是 AI 的职责！

---

## 五、预设选股函数完整列表

> `--list-presets` 返回纯文本函数名列表，不含参数说明。完整详情如下：

### 估值分析类

| 函数名 | 说明 | 内置默认值 |
|--------|------|------|
| `LowPE` | 低PE筛选 | `maxPE`=20 |
| `LowPB` | 破净股筛选(PB<1) | `maxPB`=1 |
| `HighDividend` | 高股息筛选 | `minDividend`=3% |
| `ValuationPercentile` | 估值百分位低位 | `maxPercentile`=30 |
| `PEG` | PEG策略(PEG<1) | `maxPEG`=1, `minGrowth`=20% |

### 技术指标类

| 函数名 | 说明 | 内置默认值 |
|--------|------|------|
| `BullishMA` | 均线多头排列 | - |
| `MACDGoldenCross` | MACD金叉 | - |
| `KDJOversold` | KDJ超卖 | `maxJ`=20 |
| `RSIOversold` | RSI超卖 | `maxRSI`=30 |
| `BollingerBreakout` | 布林带突破上轨 | - |
| `NineTurnGreen9` | 神奇九转绿9信号 | - |

### 财务分析类

| 函数名 | 说明 | 内置默认值 |
|--------|------|------|
| `HighROE` | 高ROE筛选 | `minROE`=15% |
| `HighGrowth` | 高成长筛选 | `minRevenueGrowth`=20%, `minProfitGrowth`=30% |
| `LowDebt` | 低负债筛选 | `maxDebtRatio`=50% |
| `PositiveCashFlow` | 正现金流筛选 | - |

### 资金流向类

| 函数名 | 说明 | 内置默认值 |
|--------|------|------|
| `MainInflow` | 主力资金流入 | `minInflow`=1亿 |
| `SustainedInflow` | 主力持续流入(5/10/20日) | - |
| `HighShortRatio` | 高卖空比例 | `minShortRatio`=10% |

### 机构评级类（港股/美股）

| 函数名 | 说明 | 内置默认值 |
|--------|------|------|
| `HighRating` | 高机构评级 | `minBuyRating`=5 |
| `TargetPriceUpside` | 目标价上行空间 | `minUpside`=20% |

### 组合策略类

| 函数名 | 说明 | 内置默认值 |
|--------|------|------|
| `HighDividendLowValuation` | 高股息+低估值 | `minDividend`, `maxPE`, `maxPB` |
| `WhiteHorseGrowth` | 白马成长(高ROE+稳定增长) | - |
| `Turnaround` | 困境反转 | `minTurnaround`=50% |
| `SmallCapValue` | 小盘价值(20-100亿市值) | - |
| `TechFundamentalCombo` | 技术面+基本面组合 | - |

> ⚠️ 预设函数的参数均为内置默认值，不支持通过 CLI 传入自定义参数。如需自定义条件，请使用 filter 表达式语法。

---

## 六、策略选股完整列表

| 分类 | 策略代码 | 名称 |
|------|---------|------|
| 基本面 | `big_cap` | 行业高增长 |
| 基本面 | `pb_roe` | 高盈利价值 |
| 基本面 | `high_dividend` | 高股息 |
| 基本面 | `food_beverage` | 低估食品饮料 |
| 基本面 | `household_appliances` | 优质家电 |
| 基本面 | `profit_preannounce` | 业绩预增 |
| K线形态 | `dawn_breaks` | 曙光初现 |
| K线形态 | `up_down_up` | 两阳夹一阴 |
| K线形态 | `morning_star` | 早晨之星 |
| K线形态 | `red_three_solider` | 红三兵 |
| K线形态 | `zthmq` | 涨停回马枪 |
| K线形态 | `rise_big_up` | 跳空向上 |
| K线形态 | `hibiscus_out_of_water` | 出水芙蓉 |
| K线形态 | `over_drop_rebound` | 超跌反弹 |
| K线形态 | `long_red_show_road` | 长阳指路 |
| K线形态 | `xianrenzhilu` | 仙人指路 |
| K线形态 | `open_high_close_low` | 高开低走 |
| 指标信号 | `macd_golden` | MACD金叉 |
| 指标信号 | `kdj_golden` | KDJ金叉 |
| 指标信号 | `bias_golden` | BIAS金叉 |
| 指标信号 | `rsi_golden` | RSI金叉 |
| 指标信号 | `rsi_oversold` | RSI超卖 |
| 指标信号 | `bias_oversold` | BIAS超卖 |
| 指标信号 | `wr_oversold` | WR超卖 |
| 指标信号 | `kdj_super_golden` | 黄金KDJ |
| 指标信号 | `macd_bottom_deviate` | MACD底背离 |
| 指标信号 | `macd_red_wave` | MACD红二波 |
| 指标信号 | `kdj_bottom_deviate` | KDJ底背离 |
| 指标信号 | `bias_bottom_deviate` | BIAS底背离 |
| 指标信号 | `rsi_bottom_deviate` | RSI底背离 |
| 指标信号 | `sar_buy_signal` | SAR买入信号 |
| 均线/布林 | `one_rise_three_ma` | 一阳三线 |
| 均线/布林 | `ma_long` | 均线多头发散 |
| 均线/布林 | `ma_long_boll_bt_mid` | 均线多头+布林中轨突破 |
| 均线/布林 | `boll_bt_upper` | 布林带上轨突破 |
| 均线/布林 | `boll_bt_mid` | 布林带中轨突破 |
| 均线/布林 | `ma_stick` | 均线粘连 |
| 资金面 | `abnormal_trade_at_dayend` | 尾盘掘金 |
| 资金面 | `margin_trade` | 融资追涨 |

---

## 七、标签选股完整列表

| 分类 | 标签代码 | 名称 |
|------|---------|------|
| 股东属性 | `shareholder_central_state` | 央企公司 |
| 股东属性 | `shareholder_local_state` | 国企公司 |
| 股东属性 | `shareholder_private` | 民企公司 |
| 股东属性 | `shareholder_qfii` | 含外资 |
| 风险标签 | `risk_st` | ST与*ST股 |
| 风险标签 | `risk_delisting` | 退市整理期股票 |
| 风险标签 | `risk_remove_st` | 摘星脱帽股 |
| 风险标签 | `risk_broken_ipo` | 破发股 |
| 估值水平 | `valuation_abs_high` | 估值绝对高位股 |
| 估值水平 | `valuation_abs_low` | 估值绝对低位股 |
| 估值水平 | `valuation_rel_high` | 估值相对高位股 |
| 估值水平 | `valuation_negpe` | 亏损股 |
| 资产结构 | `fin_asset_high_cash` | 资产结构多现金 |
| 资产结构 | `fin_asset_high_inventory` | 资产结构多库存 |
| 资产结构 | `fin_asset_high_receivable` | 资产结构多应收 |
| 资产结构 | `fin_asset_high_longequity` | 资产结构多长股投 |
| 资产结构 | `fin_asset_high_investprop` | 资产结构多投资性房地产 |
| 资产结构 | `fin_asset_high_fixedasset` | 资产结构多固定资产 |
| 资产结构 | `fin_asset_high_bubble1` | 资产结构多泡沫资产1 |
| 资产结构 | `fin_asset_high_bubble2` | 资产结构多泡沫资产2 |
| 负债结构 | `fin_liability_high_shortdebt` | 负债结构多短债 |
| 负债结构 | `fin_liability_high_estimateliab` | 负债结构多预计负债 |
| 负债结构 | `fin_liability_high_advance` | 负债结构多预收 |
| 利润结构 | `fin_profit_high_cost_sales` | 成本结构多销售费用 |
| 利润结构 | `fin_profit_high_cost_admin` | 成本结构多管理费用 |
| 利润结构 | `fin_profit_high_cost_dev` | 成本结构多研发费用 |
| 利润结构 | `fin_profit_high_cost_financing` | 成本结构多财务费用 |
| 利润结构 | `fin_profit_high_assetimpair` | 利润结构多资产减值 |
| 利润结构 | `fin_profit_high_creditimpair` | 利润结构多信用减值 |
| 利润结构 | `fin_profit_high_assetsell` | 利润结构多资产处置 |
| 利润结构 | `fin_profit_high_discontinue` | 利润结构多终止经营净利润 |
| 利润结构 | `fin_profit_high_oci` | 利润结构多其他综合收益 |
| 利润结构 | `fin_profit_high_nonopincome` | 利润结构多营业外收入 |
| 现金流结构 | `fin_cash_high_cash` | 现金流结构多现金 |
| 现金流结构 | `fin_cash_high_cfo` | 现金流结构多经营现金 |
| 现金流结构 | `fin_cash_high_cfi` | 现金流结构多投资现金 |
| 现金流结构 | `fin_cash_high_cff` | 现金流结构多筹资现金 |
| 现金流结构 | `fin_cash_neg_cfo` | 现金流结构负经营现金 |
| 现金流结构 | `fin_cash_neg_cfi` | 现金流结构负投资现金 |
| 现金流结构 | `fin_cash_neg_cff` | 现金流结构负筹资现金 |
| 财务排名 | `fin_profitablity_high_rk_epsttm` | 盈利能力EPSttm高排序 |
| 财务排名 | `fin_profitablity_high_rk_roettm` | 盈利能力ROEttm高排序 |
| 财务排名 | `fin_profitablity_high_rk_roattm` | 盈利能力ROAttm高排序 |
| 财务排名 | `fin_profitablity_high_rk_gpttm` | 盈利能力毛利率ttm高排序 |
| 财务排名 | `fin_profitablity_high_rk_npttm` | 盈利能力净利率ttm高排序 |
| 财务排名 | `fin_operating_high_rk_receivable_turn` | 营运能力应收周转高排序 |
| 财务排名 | `fin_operating_high_rk_inventory_turn` | 营运能力存货周转高排序 |
| 财务排名 | `fin_operating_high_rk_asset_turn` | 营运能力资产周转高排序 |
| 财务排名 | `fin_growth_high_rk_rev_growth` | 成长能力营收增速高排序 |
| 财务排名 | `fin_growth_high_rk_profit_growth` | 成长能力利润增速高排序 |
| 财务排名 | `fin_growth_high_rk_asset_growth` | 成长能力资产增速高排序 |
| 财务排名 | `fin_liquidity_high_rk_current_ratio` | 偿债能力流动比率高排序 |
| 财务排名 | `fin_liquidity_high_rk_liability_ratio` | 偿债能力负债率高排序 |
| 财务排名 | `fin_liquidity_high_rk_interest_cover` | 偿债能力利息保障倍数高排序 |
| 财务排名 | `fin_profitablity_low_rk_epsttm` | 盈利能力EPSttm低排序 |
| 财务排名 | `fin_profitablity_low_rk_roettm` | 盈利能力ROEttm低排序 |
| 财务排名 | `fin_profitablity_low_rk_roattm` | 盈利能力ROAttm低排序 |
| 财务排名 | `fin_profitablity_low_rk_gpttm` | 盈利能力毛利率ttm低排序 |
| 财务排名 | `fin_profitablity_low_rk_npttm` | 盈利能力净利率ttm低排序 |
| 财务排名 | `fin_operating_low_rk_receivable_turn` | 营运能力应收周转低排序 |
| 财务排名 | `fin_operating_low_rk_inventory_turn` | 营运能力存货周转低排序 |
| 财务排名 | `fin_operating_low_rk_asset_turn` | 营运能力资产周转低排序 |
| 财务排名 | `fin_growth_low_rk_rev_growth` | 成长能力营收增速低排序 |
| 财务排名 | `fin_growth_low_rk_profit_growth` | 成长能力利润增速低排序 |
| 财务排名 | `fin_growth_low_rk_asset_growth` | 成长能力资产增速低排序 |
| 财务排名 | `fin_liquidity_low_rk_current_ratio` | 偿债能力流动比率低排序 |
| 财务排名 | `fin_liquidity_low_rk_liability_ratio` | 偿债能力负债率低排序 |
| 财务排名 | `fin_liquidity_low_rk_interest_cover` | 偿债能力利息保障倍数低排序 |
| 财务特征 | `fin_high_gpttm` | 高销售毛利率ttm |
| 财务特征 | `fin_high_npttm` | 高销售净利率ttm |
| 财务特征 | `fin_neg_rev_growth` | 营收负增长 |
| 财务特征 | `fin_neg_profit_growth` | 利润负增长 |
| 财务特征 | `fin_neg_asset_growth` | 资产负增长 |
| 财务特征 | `fin_unhealthy_growth` | 增收不增利 |
| 财务特征 | `fin_forecast_dec` | 业绩预亏预降股 |
| 财务特征 | `fin_forecast_slower_dec` | 业绩减亏减降股 |
| 财务特征 | `fin_forecast_slower_inc` | 业绩减增股 |
| 上市时间 | `listeddate_5days` | 新股5日内 |
| 上市时间 | `listeddate_3mons` | 近端次新股 |
| 上市时间 | `listeddate_1year` | 远端次新股 |
| 上市时间 | `listeddate_3year` | 上市1年以上3年以内 |
| 上市时间 | `listeddate_3yearplus` | 上市3年以上 |
| 价格与市值 | `price_below1` | 1元股 |
| 价格与市值 | `price_between_1_10` | 1到10元股 |
| 价格与市值 | `price_between_10_100` | 10到100元股 |
| 价格与市值 | `price_between_100_500` | 100到500元股 |
| 价格与市值 | `price_between_500_1000` | 500到1000元股 |
| 价格与市值 | `price_up1000` | 千元股 |
| 价格与市值 | `marketcap_below10` | 10亿以下股 |
| 价格与市值 | `marketcap_between_10_50` | 10到50亿股 |
| 价格与市值 | `marketcap_between_50_100` | 50到100亿股 |
| 价格与市值 | `marketcap_between_100_1000` | 100到1000亿股 |
| 价格与市值 | `marketcap_between_1000_10000` | 1000到10000亿股 |
| 价格与市值 | `marketcap_up10000` | 10000亿以上股 |
| 价格与市值 | `marketcap_super_big` | 超大盘 |
| 价格与市值 | `marketcap_super_small` | 超小盘 |

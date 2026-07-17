# WeStock Data - AI 深度参考指南

> **定位**：本文档提供详细的数据格式参考、分析模板。命令列表和基本用法请参见 [SKILL.md](../SKILL.md)。
> 完整分析场景示例请参见 [scenarios-guide.md](./scenarios-guide.md)。

---

## 一、返回数据结构

### StockSkillResult（单股查询）

```json
// 成功
{ "success": true, "data": { "...实际数据..." } }

// 失败
{ "success": false, "error": { "code": "SKILL_001", "message": "股票代码无效" } }
```

### BatchResult（批量查询）

```json
{
  "success": true,
  "status": "partial",
  "data": [
    { "symbol": "sh600000", "data": { "...原始查询结果..." } },
    { "symbol": "sz000001", "data": { "...原始查询结果..." } }
  ],
  "errors": [{ "symbol": "hk99999", "code": "SKILL_004", "message": "未找到匹配数据" }],
  "metadata": { "total": 3, "successCount": 2, "errorCount": 1, "dataTime": "2026-03-10T12:00:00.000Z" }
}
```

**处理要点**：
1. 先检查 `success`（有无成功记录），再检查 `status`（`success`/`partial`/`error`）
2. 遍历 `data[]` 按 `symbol` 匹配各股数据
3. 遍历 `errors[]` 了解失败原因（`SKILL_003`=接口异常，`SKILL_004`=数据不存在）
4. 优先使用批量查询，避免多次调用

---

## 二、各命令数据格式

### K线（`kline`）

```json
{
  "data": {
    "code": "sh600519", "name": "贵州茅台",
    "nodes": [
      { "date": "2026-03-05", "open": "1680.00", "last": "1690.00", "high": "1695.00",
        "low": "1675.00", "volume": "125000", "amount": "2112500000", "exchange": "0.89" }
    ]
  }
}
```

> K线字段为**字符串**，计算前需转换为数字

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

#### 美股（`usfund`）

| 字段 | 单位 | 说明 |
|------|------|------|
| `ShortRatio` | % | 卖空比例 |
| `ShortShares` | 股 | 卖空股数 |
| `ShortRecoverDays` | 天 | 回补天数 |

### 机构评级（`rating`）

**A股**：返回评级统计（买入/增持/中性/减持/卖出）+ 近期研报列表

**港股/美股**（`InvestRatingData`）：

```json
{
  "forecastInstitutions": 45, "targetPriceAvg": 480.5,
  "targetPriceMax": 560.0, "targetPriceMin": 380.0,
  "ratingBuyCnt": 30, "ratingIncCnt": 8, "ratingHoldCnt": 5,
  "ratingDecCnt": 1, "ratingSellCnt": 1, "ratingCnt": 45,
  "earningsForecast": [{ "year": 2026, "revenue": 750000, "netProfit": 200000, "eps": 20.5 }]
}
```

> ⚠️ 港股/美股评级字段（ratingBuyCnt等）MCP服务暂不返回，当前仅港股 `earningsForecast` 可用

### A股一致预期（`consensus`，`ConsensusForecastData`）

```json
{
  "targetPrice": 2100.0,
  "forecasts": [{
    "year": 2026, "revenue": 16800000, "netProfit": 8500000,
    "eps": 67.8, "pe": 24.5, "pb": 8.2, "ps": 15.6,
    "revenueYoy": 12.5, "netProfitYoy": 15.8, "institutionCnt": 32
  }]
}
```

**分析要点**：目标价 vs 当前价（上涨空间）、EPS增速（盈利确定性）、PE走势（估值消化）、机构数（共识可信度）

### 技术指标（`technical`）

#### 截面查询

```json
{
  "sh600000": {
    "date": "2026-03-10", "closePrice": 8.50,
    "ma": { "MA_5": 8.45, "MA_10": 8.42, "MA_20": 8.38, "MA_60": 8.30, "MA_250": 8.10, "EMA_12": 8.43 },
    "macd": { "DIF": 0.03, "DEA": 0.01, "MACD": 0.04 },
    "kdj": { "KDJ_K": 65.2, "KDJ_D": 58.1, "KDJ_J": 79.4 },
    "rsi": { "RSI_6": 55.3, "RSI_12": 52.1, "RSI_24": 50.8 },
    "boll": { "BOLL_UPPER": 8.72, "BOLL_MID": 8.42, "BOLL_LOWER": 8.12 },
    "bias": { "BIAS_6": 0.95, "BIAS_12": 0.72 },
    "wr": { "WR_6": -35.2, "WR_10": -42.1 },
    "dmi": { "SAR": 8.35, "PDI": 22.5, "MDI": 18.3, "ADX": 20.1 }
  }
}
```

#### 历史区间查询（`TechnicalIndicatorHistoryData`）

返回 `{ "code": "...", "name": "...", "items": [{ "date": "...", "closePrice": ..., "ma": {...}, "macd": {...}, ... }] }`

### 筹码成本（`chip`）

#### 截面

```json
{
  "sh600519": {
    "date": "2026-03-10", "closePrice": 1690.00,
    "chipProfitRate": 85.32,       // 盈利率(%)
    "chipAvgCost": 1580.50,        // 平均成本
    "chipConcentration90": 12.5,   // 90%集中度(%) 越低越集中
    "chipConcentration70": 8.3
  }
}
```

#### 历史区间（`ChipHistoryData`）

返回 `{ "code": "...", "name": "...", "items": [{ "date": "...", "closePrice": ..., "chipProfitRate": ..., ... }] }`

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

#### 历史区间（`MarketHistoryData`）

返回 `{ "code": "...", "name": "...", "items": [{ "date": "...", "closePrice": ..., "changePct": ..., "mainNetFlow": ..., ... }] }`，按日期升序排列

### 市场资讯（`marketnews`，`MarketNewsResult`）

```json
{
  "market": "hs",
  "indexes": ["sh000001", "sz399001", "sz399006"],
  "news": [{ "id": "...", "title": "...", "time": "2026-03-11 13:46", "source": "新浪财经", "url": "..." }],
  "totalFetched": 60, "deduplicated": 15
}
```

**预设市场**：`hs`(沪深)、`sh`(沪市)、`sz`(深市)、`hk`(港股)、`us`(美股)，或自定义逗号分隔指数代码

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

## 五、分析模板

### 成交量分析

1. `kline <CODE> day 20` → 提取 `volume`（字符串转数字）
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

---

## 六、格式化输出规范

- 金额超过亿元：使用"亿元"/"亿港元"/"亿美元"
- 成交量超过万手：使用"万手"
- 涨跌幅：保留2位小数，带 +/- 号
- 日期：YYYY-MM-DD 格式
- 数据为空时说明"暂无数据"，**不可伪造数据**
- 港股/美股财务数据必须标注货币单位

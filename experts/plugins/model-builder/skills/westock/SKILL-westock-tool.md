---
name: westock-tool
description: 条件选股/筛选股票工具 - 当用户需要按条件筛选股票时使用（如"找股价大于100的股票"、"PE低于20的股票"、"高股息低估值股票"等）。支持按价格、市盈率、市净率、ROE、涨跌幅、成交量、市值、资金流向等指标筛选，覆盖沪深/港股/美股。注意：本工具只做"选股筛选"，查询个股详情（行情、K线、财务、资金等）请用 westock-data
---

# WeStock Tool

**作用**：将自然语言选股需求转换为结构化查询条件，通过选股引擎批量筛选并返回结果。

> **与 westock-data 的分工**：
> - **westock-tool**（本工具）：**筛选/选股** — "找出满足条件的股票列表"
> - **westock-data**：**查询个股详情** — "查某只股票的行情/K线/财务/资金等数据"

**数据源**：腾讯自选股选股数据接口 | **支持市场**：A股（沪深）、港股、美股

**环境要求**：Node.js >= v18（脚本为单文件打包，无需 npm install）

如未安装，根据系统自动安装：

```bash
# 检测
node --version 2>/dev/null || echo "未安装"

# macOS / Linux：通过 nvm 安装（无需 sudo）
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
  && export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" \
  && nvm install --lts && nvm use --lts
```

```powershell
# Windows PowerShell
if (-not (Get-Command node -EA SilentlyContinue)) { winget install OpenJS.NodeJS.LTS }
```

**运行方式**：
```bash
node <skill-path>/scripts/index.js filter "ClosePrice >= 100"
```

---

## 条件选股（filter）

```bash
# 基本用法
westock-tool filter "ClosePrice >= 100"
westock-tool filter "ClosePrice >= 100" 2026-03-12
westock-tool filter "ClosePrice >= 100" 2026-03-12 20

# AND 组合条件
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 20, ROETTM > 15])"

# OR 组合条件
westock-tool filter "union([ChangePCT > 5, Chg5D > 10])"

# 指定排序（按 ROE 降序）
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15, ROETTM > 15])" 2026-03-12 20 ROETTM desc

# 港股选股（--market hk）
westock-tool filter "intersect([PeTTm > 0, PeTtm < 10, DivTTM > 5])" --market hk

# 美股选股（--market us）
westock-tool filter "intersect([PeTtm > 0, PeTtm < 30, TotalMV > 1000])" --market us

# 按板块筛选（--universe）
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 20])" 2026-03-12 20 --universe 11010001

# 输出原始 JSON
westock-tool filter "ClosePrice >= 100" --raw
```

**参数说明**：

| 参数 | 是否必选 | 说明 |
|------|---------|------|
| 表达式 | ✅ | 选股表达式，详见下方「表达式语法」 |
| 日期 | 可选 | `YYYY-MM-DD`，默认今天 |
| 数量 | 可选 | 最大返回数量，默认 20 |
| 排序字段 | 可选 | 按指定字段排序 |
| 排序方向 | 可选 | `asc`/`desc`，默认 `desc` |
| `--market` | 可选 | `hk`=港股，`us`=美股，不指定默认沪深 |
| `--universe` | 可选 | 概念板块代码，限定选股范围 |

---

## 预设选股函数

常见选股场景可直接使用预设函数，无需手写表达式：

**CLI 调用方式**：

```bash
# 使用预设函数（--preset）
westock-tool filter --preset MACDGoldenCross 2026-03-24 30
westock-tool filter --preset LowPE 2026-03-12 20
westock-tool filter --preset HighDividend 2026-03-12 20 --market hk

# 查看所有可用预设函数
westock-tool filter --list-presets
```

**参数说明**：

| 参数 | 是否必选 | 说明 |
|------|---------|------|
| `--preset` | 可选 | 预设函数名（见下表） |
| 日期 | 可选 | `YYYY-MM-DD`，默认今天 |
| 数量 | 可选 | 最大返回数量，默认 20 |
| `--market` | 可选 | `hk`=港股，`us`=美股 |
| `--universe` | 可选 | 概念板块代码 |

#### 估值分析类

| 函数名 | 说明 | 参数 |
|--------|------|------|
| `filterLowPE` | 低PE筛选 | `maxPE`(默认20) |
| `filterLowPB` | 破净股筛选(PB<1) | `maxPB`(默认1) |
| `filterHighDividend` | 高股息筛选 | `minDividend`(默认3%) |
| `filterValuationPercentile` | 估值百分位低位 | `maxPercentile`(默认30) |
| `filterPEG` | PEG策略(PEG<1) | `maxPEG`(默认1), `minGrowth`(默认20%) |

#### 技术指标类

| 函数名 | 说明 | 参数 |
|--------|------|------|
| `filterBullishMA` | 均线多头排列 | - |
| `filterMACDGoldenCross` | MACD金叉 | - |
| `filterKDJOversold` | KDJ超卖 | `maxJ`(默认20) |
| `filterRSIOversold` | RSI超卖 | `maxRSI`(默认30) |
| `filterBollingerBreakout` | 布林带突破上轨 | - |
| `filterNineTurnGreen9` | 神奇九转绿9信号 | - |

#### 财务分析类

| 函数名 | 说明 | 参数 |
|--------|------|------|
| `filterHighROE` | 高ROE筛选 | `minROE`(默认15%) |
| `filterHighGrowth` | 高成长筛选 | `minRevenueGrowth`(默认20%), `minProfitGrowth`(默认30%) |
| `filterLowDebt` | 低负债筛选 | `maxDebtRatio`(默认50%) |
| `filterPositiveCashFlow` | 正现金流筛选 | - |

#### 资金流向类

| 函数名 | 说明 | 参数 |
|--------|------|------|
| `filterMainInflow` | 主力资金流入 | `minInflow`(默认1亿) |
| `filterSustainedInflow` | 主力持续流入(5/10/20日) | - |
| `filterHighShortRatio` | 高卖空比例 | `minShortRatio`(默认10%) |

#### 机构评级类（港股/美股）

| 函数名 | 说明 | 参数 |
|--------|------|------|
| `filterHighRating` | 高机构评级 | `minBuyRating`(默认5) |
| `filterTargetPriceUpside` | 目标价上行空间 | `minUpside`(默认20%) |

#### 组合策略类

| 函数名 | 说明 | 参数 |
|--------|------|------|
| `filterHighDividendLowValuation` | 高股息+低估值 | `minDividend`, `maxPE`, `maxPB` |
| `filterWhiteHorseGrowth` | 白马成长(高ROE+稳定增长) | - |
| `filterTurnaround` | 困境反转 | `minTurnaround`(默认50%) |
| `filterSmallCapValue` | 小盘价值(20-100亿市值) | - |
| `filterTechFundamentalCombo` | 技术面+基本面组合 | - |

**所有预设函数通用参数**：`date`（选股日期）、`universe`（板块代码）、`limit`（返回数量，默认20）

---

## 表达式语法

| 语法 | 说明 | 示例 |
|------|------|------|
| `字段 比较符 值` | 单条件 | `ClosePrice >= 100` |
| `intersect([条件1, 条件2])` | AND 组合 | `intersect([ClosePrice >= 100, PE_TTM < 20])` |
| `union([条件1, 条件2])` | OR 组合 | `union([ChangePCT > 5, Chg5D > 10])` |

---

## 使用规范

- ✅ 使用 `westock-tool` CLI 命令执行选股查询，AI 在内存中解析 JSON 并分析
- ❌ 不创建临时脚本文件，不将数据分析逻辑写成独立脚本
- ⚠️ **港股必须指定 `--market hk`，美股必须指定 `--market us`**
- ⚠️ 筛选 PE/PB 时排除负值（亏损股），如 `intersect([PE_TTM > 0, PE_TTM < 20])`
- ⚠️ 沪深和港股/美股的估值字段名不同，切勿混用
- ⚠️ 沪深市值单位为"元"，港股/美股为"亿元"，构建条件时注意换算

---

## 股票代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 沪市/科创板 | sh + 6位数字 | `sh600519`、`sh688981` |
| 深市 | sz + 6位数字 | `sz000001` |
| 港股 | hk + 5位数字 | `hk00700` |
| 美股 | us + 代码 | `usAAPL` |

---

## 常用字段速查

> ⚠️ 沪深 `TotalMV` 单位为"元"，港股/美股为"亿元"

| 类别 | 沪深(HS) | 港股(HK) | 美股(US) |
|------|----------|----------|----------|
| 市盈率TTM | PE_TTM | PeTtm | PeTtm |
| 市净率 | PB | PbLF | PbLF |
| 股息率TTM | DividendRatioTTM | DivTTM | DivTTM |
| 市销率TTM | PS_TTM | PsTtm ⚠️ | - |
| 市现率TTM | PCF_TTM | PcfTtm ⚠️ | - |
| 收盘价 | ClosePrice | ClosePrice | ClosePrice |
| 涨跌幅 | ChangePCT | ChangePCT | ChangePCT |
| 总市值 | TotalMV (元) | TotalMV (亿元) | TotalMV (亿元) |
| 换手率 | TurnoverRate | TurnoverRate | TurnoverRate |
| ROE(TTM) | ROETTM | RoeWeighted | ROE |
| 主力净流入 | MainNetFlow | MainNetFlow | - |

> ⚠️ 港股 PsTtm/PcfTtm 仅选股查询支持，快照查询返回 0

**完整字段速查表（含行情、财务、技术指标等全部字段）参见 [references/fields-guide.md](./references/fields-guide.md)**

**详细返回格式、分析模板参见 [references/ai_usage_guide.md](./references/ai_usage_guide.md)**

---

## 常见场景速查

```
价格筛选：filter "intersect([ClosePrice >= 50, ClosePrice <= 200])"
低估值蓝筹：filter "intersect([PE_TTM > 0, PE_TTM < 15, ROETTM > 15])" ... ROETTM desc
技术面选股：filter "intersect([MA_5 > MA_10, MA_10 > MA_20, MA_20 > MA_60])"
主力流入：filter "MainNetFlow > 100000000" ... MainNetFlow desc
港股高股息：filter "intersect([PeTtm > 0, PeTtm < 10, DivTTM > 5])" --market hk
按板块筛选：search <关键词> sector → 获取板块代码 → filter ... --universe <代码>
联动分析：filter 选股 → 取前N只代码 → westock-data quote/finance 查详情
```

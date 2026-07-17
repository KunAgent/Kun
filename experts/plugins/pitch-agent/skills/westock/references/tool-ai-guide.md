# WeStock Tool - AI 深度参考指南

> **定位**：本文档提供选股工具的详细返回数据格式和分析模板。命令列表和基本用法请参见 [SKILL.md](../SKILL.md)。
> 完整字段列表请参见 [fields-guide.md](./fields-guide.md)。

---

## 一、返回数据格式

### 格式化输出（默认）

```
选股结果（沪深A股）
条件: intersect([PE_TTM > 0, PE_TTM < 15, ROETTM > 15])
日期: 2026-03-12 | 数量: 20 | 排序: ROETTM desc

序号  代码        名称       收盘价    涨跌幅    PE(TTM)   ROE(TTM)
1     sh600519   贵州茅台   1690.00   +1.25%    28.50     32.15%
2     sz000001   平安银行   12.50     -0.32%    5.80      16.20%
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

> 详见 [SKILL.md](../SKILL.md) 「常用字段速查」，沪深市值 `TotalMV` 单位为"元"，港美为"亿元"。

---

## 二、分析模板

### 3.1 价值选股

```bash
# 低PE（PE < 15）
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15])" 2026-03-12 20 PE_TTM asc

# 高股息（股息率 > 5%）
westock-tool filter "DividendRatioTTM > 5" 2026-03-12 20 DividendRatioTTM desc

# PEG策略（净利润增速 > 25%，PEG < 1）
westock-tool filter "intersect([PE_TTM > 0, NetProfitGrowRate > 25, PE_TTM / NetProfitGrowRate < 1])" 2026-03-12 20

# 低估值高ROE（PE < 15，ROE > 15%）
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15, ROETTM > 15])" 2026-03-12 20 ROETTM desc

# 破净股（PB < 1）
westock-tool filter "intersect([PB > 0, PB < 1])" 2026-03-12 20 PB asc
```

**分析要点**：PE_TTM 分布（中位数/均值）、ROETTM 排名、结合市值和行业分类汇总

### 3.2 技术面选股

```bash
# 均线多头排列（MA5 > MA10 > MA20 > MA60）
westock-tool filter "intersect([MA_5 > MA_10, MA_10 > MA_20, MA_20 > MA_60])" 2026-03-12 20

# MACD金叉（DIF > DEA）
westock-tool filter "DIF > DEA" 2026-03-12 20

# KDJ超卖（KDJ_J < 15）
westock-tool filter "KDJ_J < 15" 2026-03-12 20 KDJ_J asc

# RSI超卖（RSI_6 < 25）
westock-tool filter "RSI_6 < 25" 2026-03-12 20 RSI_6 asc

# 神奇九转绿9信号
westock-tool filter "NineTurn_9 = 1" 2026-03-12 20

# 布林带突破上轨
westock-tool filter "ClosePrice > BollingerUpper" 2026-03-12 20
```

**分析要点**：均线间距（趋势强度）、配合换手率（TurnoverRate）验证、配合 MACD 交叉确认

### 3.3 资金面选股

```bash
# 主力净流入 > 1亿
westock-tool filter "MainNetFlow > 100000000" 2026-03-12 20 MainNetFlow desc

# 主力持续流入（5/10/20日均为正）
westock-tool filter "intersect([MainNetFlow5D > 0, MainNetFlow10D > 0, MainNetFlow20D > 0])" 2026-03-12 20

# 主力5日流入 > 5亿
westock-tool filter "MainNetFlow5D > 500000000" 2026-03-12 20 MainNetFlow5D desc

# 高换手率（> 5%）
westock-tool filter "TurnoverRate > 5" 2026-03-12 20 TurnoverRate desc
```

**分析要点**：资金流入持续性、配合涨跌幅判断是否拉升期、筛选"主力流入但涨幅不大"的潜力股

### 3.4 财务分析选股

```bash
# 高ROE（ROE > 20%）
westock-tool filter "ROETTM > 20" 2026-03-12 20 ROETTM desc

# 高成长（营收增速 > 30%，净利润增速 > 40%）
westock-tool filter "intersect([RevenueGrowRate > 30, NetProfitGrowRate > 40])" 2026-03-12 20 NetProfitGrowRate desc

# 低负债（资产负债率 < 40%）
westock-tool filter "DebtRatio < 40" 2026-03-12 20 DebtRatio asc

# 正经营现金流
westock-tool filter "OCFPS > 0" 2026-03-12 20

# 高ROE低负债（ROE > 15%，负债率 < 50%）
westock-tool filter "intersect([ROETTM > 15, DebtRatio < 50])" 2026-03-12 20 ROETTM desc
```

### 3.5 组合策略选股

```bash
# 高股息+低估值（股息率 > 4%，PE < 12，PB < 1.5）
westock-tool filter "intersect([DividendRatioTTM > 4, PE_TTM > 0, PE_TTM < 12, PB > 0, PB < 1.5])" 2026-03-12 20 DividendRatioTTM desc

# 白马成长（高ROE + 稳定增长）
westock-tool filter "intersect([ROETTM > 15, RevenueGrowRate > 15, NetProfitGrowRate > 15])" 2026-03-12 20 ROETTM desc

# 困境反转（近期跌幅大但开始反弹）
westock-tool filter "intersect([Chg20D < -20, Chg5D > 0, Chg5D < 10])" 2026-03-12 20 Chg5D desc

# 小盘价值（市值20-100亿，PE < 20）
westock-tool filter "intersect([TotalMV > 2000000000, TotalMV < 10000000000, PE_TTM > 0, PE_TTM < 20])" 2026-03-12 20 PE_TTM asc

# 技术面+基本面组合（均线多头 + 低PE + 高ROE）
westock-tool filter "intersect([MA_5 > MA_10, MA_10 > MA_20, PE_TTM > 0, PE_TTM < 25, ROETTM > 12])" 2026-03-12 20 ROETTM desc

# 次新股高成长（上市1年内 + 高增长）
westock-tool filter "intersect([ListDate > 20250317, RevenueGrowRate > 30])" 2026-03-12 20
```

### 3.6 机构评级选股（港股/美股）

```bash
# 港股高机构评级（买入评级 >= 8家）
westock-tool filter "BuyRatingNum >= 8" 2026-03-12 20 BuyRatingNum desc --market hk

# 港股目标价上行空间（> 30%）
westock-tool filter "TargetPriceUpside > 30" 2026-03-12 20 TargetPriceUpside desc --market hk

# 美股高机构评级
westock-tool filter "BuyRatingNum >= 8" 2026-03-12 20 BuyRatingNum desc --market us

# 港股低估值 + 高评级
westock-tool filter "intersect([PeTtm > 0, PeTtm < 15, BuyRatingNum >= 5])" 2026-03-12 20 --market hk
```

### 3.7 按板块筛选

使用 `--universe` 限定选股范围，板块代码通过 `westock-data search <关键词> sector` 获取（去掉 `pt` 前缀）：

```bash
# 在华为概念板块中筛选低PE股票
westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 25])" 2026-03-12 20 PE_TTM asc --universe 02021291

# 在人工智能板块中筛选高ROE股票
westock-tool filter "ROETTM > 15" 2026-03-12 20 ROETTM desc --universe 02003800
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
westock-tool filter "intersect([PeTtm > 0, PeTtm < 8, DivTTM > 6, PbLF > 0, PbLF < 0.8])" 2026-03-12 20 DivTTM desc --market hk

# 港股低估值蓝筹（PE < 10，市值 > 500亿）
westock-tool filter "intersect([PeTtm > 0, PeTtm < 10, TotalMV > 500])" 2026-03-12 20 TotalMV desc --market hk

# 美股低估值高股息
westock-tool filter "intersect([PeTtm > 0, PeTtm < 15, DivTTM > 3])" 2026-03-12 20 DivTTM desc --market us
```

> ⚠️ 港股/美股市值单位为"亿元"，沪深为"元"，构建条件时注意换算

---

## 四、错误处理

- 检查返回 JSON 的 `code` 字段，`0` 表示成功，非 `0` 时查看 `msg` 获取原因
- 常见错误：字段名混用（如沪深用了 `PeTtm`）、港股/美股未指定 `--market`、表达式语法错误

---

**记住**：选股查询是 Skill 的职责，数据分析是 AI 的职责！

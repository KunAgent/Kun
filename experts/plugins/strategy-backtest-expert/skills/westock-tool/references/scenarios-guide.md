# WeStock Tool - 常见选股场景详解

> **定位**：本文档是 SKILL_workbuddy.md 的 **L3 层补充材料**，提供完整的选股场景示例和详细操作步骤。
>
> **使用方式**：AI 在遇到不确定的选股场景时按需加载本文档。命令列表和基本用法请参见
> [SKILL_workbuddy.md](../SKILL_workbuddy.md)，完整字段列表请参见 [fields-guide.md](./fields-guide.md)。

---

## 一、价值投资场景

### 场景 1：寻找低估值蓝筹

```
用户："帮我找PE低于15、ROE高于15%的白马股"
→ westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15, ROETTM > 15])" --date 2026-04-10 --orderby ROETTM:desc
→ 解读：PE为正说明盈利，低PE代表估值便宜，高ROE代表盈利能力强
→ 建议补充：查看行业分布，关注PE是否因周期低谷导致偏低
```

### 场景 2：高股息红利组合

```
用户："找股息率超过5%的高分红股票"
→ westock-tool filter "intersect([DividendRatioTTM > 5, PE_TTM > 0, PE_TTM < 20])" --limit 30
→ 解读：结合PE过滤掉异常值（如亏损或微利企业）
→ 进阶：使用预设 filterHighDividendLowValuation 同时叠加PB约束
```

### 场景 3：PEG成长股估值

```
用户："找PEG小于1的成长股"
→ westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 40, NPParentCompanyYOY > 20, PE_TTM / NPParentCompanyYOY < 1])"
→ 解读：PEG<1意味着估值相对盈利增速便宜
→ 注意：需确保利润增长可持续，建议结合季报数据验证
```

---

## 二、技术面选股场景

### 场景 4：均线多头排列（趋势向上）

```
用户："找均线多头排列的强势股"
→ westock-tool filter "intersect([MA_5 > MA_10, MA_10 > MA_20, MA_20 > MA_60])" --limit 30
→ 解读：短期均线在上表明多头占优，适合趋势跟踪
→ 建议：叠加成交量放大 (TurnoverValue > 某阈值) 确认有效性
```

### 场景 5：MACD + KDJ 共振

```
用户："找MACD金叉且KDJ超卖反弹的股票"
→ westock-tool filter "intersect([DIF > DEA, MACD > 0, KDJ_J < 30])"
→ 解读：MACD金叉确认中期趋势转多，KDJ超卖区表明短期回调到位
→ 注意：此策略在沪深和港股有效，美股暂不支持技术指标筛选
```

### 场景 6：布林带突破 + RSI 确认

```
用户："找突破布林上轨且RSI没有严重超买的股票"
→ westock-tool filter "intersect([ClosePrice > BOLL_UPPER, RSI_6 < 80])"
→ 解读：突破上轨为强势信号，RSI<80排除极端超买
```

---

## 三、资金面选股场景

### 场景 7：主力资金大幅流入

```
用户："找今天主力资金净流入超过1亿的股票"
→ westock-tool filter "MainNetFlow > 100000000" --date 2026-04-10 --orderby MainNetFlow:desc
→ 解读：主力大额流入可能预示机构建仓
→ 注意：仅沪深市场支持，港股用 TotalNetFlow，美股不支持
```

### 场景 8：持续资金关注

```
用户："找近期持续有资金流入的股票"
→ westock-tool filter "intersect([MainNetFlow5D > 0, MainNetFlow10D > 0, MainNetFlow20D > 0])"
→ 解读：5日/10日/20日均为正流入，说明机构持续加仓
→ 注意：仅沪深市场支持此组合
```

---

## 四、港股/美股场景

### 场景 9：港股低估值高股息

```
用户："找港股中股息率高、估值低的央企"
→ westock-tool filter "intersect([PeTTM > 0, PeTTM < 10, DivTTM > 5])" --market hk --limit 30
→ 注意字段差异：港股用 PeTTM/PbLF/DivTTM，非 PE_TTM/PB/DividendRatioTTM
```

### 场景 10：美股大盘股筛选

```
用户："找美股中市值大于1000亿、PE低于30的科技股"
→ westock-tool filter "intersect([TotalMV > 1000, PeTTM > 0, PeTTM < 30])" --market us
→ 注意：美股 TotalMV 单位为"亿"，与沪深的"元"不同
→ 注意：美股不支持技术指标和资金流向筛选
```

---

## 五、策略选股场景

### 场景 11：使用预置策略

```
用户："用MACD金叉策略帮我选股"
→ westock-tool strategy macd_golden --date 2026-04-10
→ 返回当日满足 MACD 金叉条件的股票列表
```

### 场景 12：多策略对比

```
用户："对比高股息和KDJ金叉两种策略的选股结果"
→ westock-tool strategy high_dividend --date 2026-04-10
→ westock-tool strategy kdj_golden --date 2026-04-10
→ 对比两组结果中的重叠标的和差异
```

### 场景 13：策略回溯

```
用户："看看MACD金叉策略过去一周每天选了哪些股票"
→ westock-tool strategy macd_golden --start 2026-04-03 --end 2026-04-10
→ 返回区间内每天的策略选股结果
```

---

## 六、标签选股场景

### 场景 14：按股东属性筛选

```
用户："找央企控股的股票"
→ westock-tool label shareholder_central_state --date 2026-04-10
→ 返回央企控股标签下的股票列表
```

### 场景 15：高ROE筛选

```
用户："找高ROE的公司"
→ westock-tool filter "ROETTM > 15" --date 2026-04-10 --orderby ROETTM:desc
→ 返回 ROE(TTM) 高于15%的股票列表
```

### 场景 16：多标签组合

```
用户："找央企中低价的股票"
→ westock-tool label shareholder_central_state --date 2026-04-10 --limit 100
→ 从结果中筛选低估值：westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15])" --date 2026-04-10
→ 结合两组结果交叉分析
```

---

## 七、组合分析场景

### 场景 17：多维度综合选股

```
用户："帮我找基本面好、技术面向上、资金也在流入的股票"
→ 使用预设 filterTechFundamentalCombo：MACD金叉 + 均线多头 + ROE>10% + PE<30
→ 或自定义组合:
  westock-tool filter "intersect([DIF > DEA, MACD > 0, MA_5 > MA_10, ROEWeighted > 10, PE_TTM > 0, PE_TTM < 30, MainNetFlow > 0])"
```

### 场景 18：条件选股 + 数据查询联动

```
用户："帮我选出低估值高ROE的股票，并查看前3只的详细财务数据"
→ 步骤1: westock-tool filter "intersect([PE_TTM > 0, PE_TTM < 15, ROETTM > 20])" --limit 3
→ 步骤2: 取返回的3个股票代码
→ 步骤3: 使用 westock-data finance <code> summary 查看各股财务详情
→ 步骤4: 综合分析并给出推荐
```

---

## 八、注意事项

1. **市场字段差异**：沪深用 `PE_TTM`/`PB`/`DividendRatioTTM`，港美用 `PeTTM`/`PbLF`/`DivTTM`
2. **市值单位差异**：沪深 TotalMV 单位为"元"，港美 TotalMV 单位为"亿元"
3. **功能限制**：
   - 技术指标筛选（MACD/KDJ/RSI/BOLL）：沪深✅ 港股✅ 美股❌
   - 资金流向筛选（MainNetFlow等）：沪深✅ 港股部分✅ 美股❌
   - 神奇九转（NineTurn_Green9）：仅沪深
   - 策略选股和标签选股：仅沪深A股
4. **日期格式**：统一使用 `YYYY-MM-DD`，不传则默认当天
5. **数据时效**：选股数据基于收盘后更新，盘中查询可能使用前一交易日数据

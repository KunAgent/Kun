---
name: three-statement-model
description: |
  Build integrated three-statement financial models (Income Statement, Balance Sheet, Cash Flow Statement) with full linkages and circular reference handling.
  Triggers on "三表模型", "三张报表", "财务模型", "three-statement", "integrated model", "financial model", "IS/BS/CF", "利润表/资产负债表/现金流量表".
---

# Three-Statement Model（三表联动模型）

## 功能说明

构建完整的三表联动财务模型——利润表（Income Statement）、资产负债表（Balance Sheet）、现金流量表（Cash Flow Statement），三表之间通过标准会计逻辑完全链接。

## 工作流

### Step 1: 历史数据输入

- 收集 3-5 年历史财务报表
- 标准化会计科目（统一口径）
- 识别非经常性项目（Extraordinary Items）
- 计算历史 KPI 和比率趋势

### Step 2: 收入模型

- 分产品线 / 业务线 / 地区建模
- 驱动因子分析：
  - 产品类：Volume × ASP
  - 订阅类：用户数 × ARPU × 留存率
  - 服务类：项目数 × 项目均价 / 计费小时 × 费率
- 季节性调整（如适用）

### Step 3: 成本模型

**COGS / 毛利：**
- 固定成本 vs 变动成本分拆
- 规模效应假设
- 原材料/人工/制造费用分层

**运营费用：**
- R&D：占收入比例或绝对值
- S&M：分固定（品牌）和变动（获客成本）
- G&A：含人员编制计划
- D&A：从资产负债表 PP&E 计划自动计算

### Step 4: 资产负债表计划

**运营资产/负债：**
- 应收账款：DSO（应收天数）× Revenue / 365
- 存货：DIO（存货天数）× COGS / 365
- 应付账款：DPO（应付天数）× COGS / 365
- 其他应收/应付：占收入比例

**长期资产：**
- PP&E 计划：期初 + CapEx - Depreciation = 期末
- 无形资产：期初 + 资本化 - Amortization = 期末
- 商誉：除非减值否则不变

**债务计划：**
- 各笔债务的到期计划
- 利息计算（均值法或期初法）
- 循环贷款（Revolver）自动调节

**股东权益：**
- 期初 + Net Income - Dividends + Stock Issuance - Buyback = 期末
- 库存股和股权激励

### Step 5: 现金流量表

**经营活动：**
- 净利润
- 加回非现金项目（D&A、Stock Comp、Deferred Tax）
- Working Capital 变动

**投资活动：**
- CapEx（PP&E 购置）
- 收购/出售子公司
- 投资证券买卖

**融资活动：**
- 债务借入/偿还
- 股票发行/回购
- 股息支付

**现金余额链接：**
- 期初现金 + 经营 + 投资 + 融资 = 期末现金
- 期末现金链接回资产负债表

### Step 6: 循环引用处理

- 利息支出依赖平均债务余额
- 债务余额依赖现金流（偿还/借入）
- 现金流依赖利息支出
- 解决方案：迭代计算 / 手动断开（Copy-Paste Macro）/ 或 Revolver 作为平衡项

### Step 7: 检验与平衡

- **BS 平衡检查**：Assets = Liabilities + Equity（每期）
- **CF 检查**：期末现金 = BS 上的现金
- **科目勾稽**：D&A 在三表之间一致
- **增长合理性**：各科目增长率无异常跳变
- **杠杆合理性**：Debt/EBITDA 在合理区间

## 输出规范

- **主交付物**：完整三表模型（含假设页、IS、BS、CF、支持计划）
- **假设汇总页**：所有关键驱动因子集中展示
- **KPI Dashboard**：Revenue Growth / Margins / ROIC / Leverage / FCF Yield
- **平衡检查行**：每期显示 BS 是否平衡

## 注意事项

- 所有假设须集中在一个假设页，便于场景切换
- 三表必须完全链接，不允许硬编码数字（Hard Codes 标注为蓝色字体）
- 建模惯例：输入用蓝色，公式用黑色，链接用绿色
- 循环引用必须有明确的处理方案说明
- 模型须通过"断开所有输入设为0，三表仍平衡"测试
- 预测期通常 5 年，超过 5 年须说明合理性

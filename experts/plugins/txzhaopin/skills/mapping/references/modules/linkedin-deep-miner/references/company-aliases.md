# 金融机构名变体映射表

> 本文档定义金融行业主要机构的中英文别名、缩写、子公司变体。  
> Stage 1（意图解析）和 Stage 2（查询展开）会加载本文件，自动展开公司名变体。  
> 维护原则：每个机构至少包含 4 类名称变体（英文全称/英文简称/中文/缩写）。

---

## 一、外资投行（Bulge Bracket）

### Goldman Sachs
- 主名：`Goldman Sachs`
- 别名：`Goldman`, `GS`, `高盛`, `高盛集团`
- 子公司：
  - `Goldman Sachs (Asia)` / `高盛亚洲`
  - `Goldman Sachs Gao Hua` / `高盛高华`（中国合资）
  - `Goldman Sachs International` / `GSI`（伦敦实体）
- 部门关键词：
  - IBD: `Investment Banking Division`, `IBD`, `投行部`
  - Markets: `Securities Division`, `Global Markets`
  - AM: `Asset Management`, `GSAM`

### Morgan Stanley
- 主名：`Morgan Stanley`
- 别名：`MS`, `摩根士丹利`, `大摩`, `小摩士丹利`（区分 JPM）
- 子公司：
  - `Morgan Stanley Asia` / `摩根士丹利亚洲`
  - `Morgan Stanley Huaxin` / `摩根士丹利华鑫`
- 部门关键词：
  - IBD: `Investment Banking`, `IBD`
  - Wealth: `Morgan Stanley Wealth Management`

### JPMorgan / J.P. Morgan
- 主名：`J.P. Morgan`
- 别名：`JPMorgan`, `JPM`, `JP Morgan`, `摩根大通`, `小摩`
- 子公司：
  - `J.P. Morgan Chase`
  - `J.P. Morgan Asia Pacific`
- 部门关键词：
  - IBD: `Corporate & Investment Bank`, `CIB`
  - PB: `Private Bank`

### Bank of America Merrill Lynch (BofA / BAML)
- 主名：`Bank of America`
- 别名：`BofA`, `BAML`, `Merrill Lynch`, `美林`, `美银`
- 部门关键词：
  - IBD: `BofA Securities`, `Global Investment Banking`

### Citi (Citigroup)
- 主名：`Citi`
- 别名：`Citigroup`, `花旗`, `花旗集团`, `花旗银行`
- 部门关键词：
  - IBD: `Banking`, `Capital Markets and Advisory (BCMA)`

### UBS
- 主名：`UBS`
- 别名：`瑞银`, `瑞士银行`
- 子公司：`UBS AG`, `UBS Securities`
- 注：2023 年收购 Credit Suisse，部分 ex-CS banker 现在 UBS

### Credit Suisse
- 主名：`Credit Suisse`
- 别名：`CS`, `瑞信`, `瑞士信贷`
- 状态：已被 UBS 收购，搜索时可加 `"ex-Credit Suisse"`

### Deutsche Bank
- 主名：`Deutsche Bank`
- 别名：`DB`, `德银`, `德意志银行`

### Barclays
- 主名：`Barclays`
- 别名：`巴克莱`

### HSBC
- 主名：`HSBC`
- 别名：`汇丰`, `汇丰银行`
- 子公司：`HSBC Asia`, `恒生银行` (Hang Seng Bank)

---

## 二、中资投行/券商

### 中金公司
- 主名：`CICC`
- 别名：`China International Capital Corporation`, `中金`, `中金公司`
- 香港实体：`CICC HK`, `中金香港`

### 中信证券 / CITIC Securities
- 主名：`CITIC Securities`
- 别名：`中信`, `中信证券`, `中信里昂` (CLSA)
- 子公司：
  - `CLSA` (CITIC 旗下香港平台)
  - `中信建投` (CSC，独立但常被混淆)

### 华泰证券 / Huatai Securities
- 主名：`Huatai Securities`
- 别名：`Huatai`, `华泰`, `华泰联合`
- 子公司：`Huatai International` / `华泰国际`

### 海通证券 / Haitong Securities
- 主名：`Haitong Securities`
- 别名：`Haitong`, `海通`, `海通国际`

### 国泰君安 / Guotai Junan
- 主名：`Guotai Junan`
- 别名：`国泰君安`, `国君`, `Guotai Junan International`

### 招商证券 / China Merchants Securities
- 主名：`China Merchants Securities`
- 别名：`招证`, `招商证券`, `CMS`

---

## 三、PE/VC（外资）

### KKR
- 主名：`KKR`
- 别名：`Kohlberg Kravis Roberts`, `KKR & Co`

### Blackstone
- 主名：`Blackstone`
- 别名：`黑石`, `Blackstone Group`

### Carlyle
- 主名：`Carlyle`
- 别名：`凯雷`, `Carlyle Group`

### Bain Capital
- 主名：`Bain Capital`
- 别名：`贝恩资本`, `贝恩`（注意：与贝恩咨询 Bain & Company 区分）

### TPG
- 主名：`TPG`
- 别名：`TPG Capital`, `德州太平洋`

### General Atlantic
- 主名：`General Atlantic`
- 别名：`GA`, `泛大西洋投资`

### Warburg Pincus
- 主名：`Warburg Pincus`
- 别名：`华平投资`, `华平`

### Sequoia
- 主名：`Sequoia`
- 别名：`Sequoia Capital`, `红杉`, `红杉资本`
- 子公司：
  - `红杉中国` / `Sequoia China`（2023 拆分独立为 `HongShan` / 红杉中国）
  - `Sequoia Capital India` / `Peak XV` （2023 拆分独立）

---

## 四、PE/VC（中资）

### 高瓴 / Hillhouse
- 主名：`Hillhouse Capital`
- 别名：`Hillhouse`, `高瓴`, `高瓴资本`

### 红杉中国 / HongShan
- 主名：`HongShan` (2023 后)
- 别名：`红杉中国`, `Sequoia China`（旧称）

### 云锋 / 云峰
- 主名：`Yunfeng Capital`
- 别名：`云锋基金`, `云峰`, `云峰金融`
- 注：常被错写为"云峰"，正式名为"云锋"

### 君联 / Legend Capital
- 主名：`Legend Capital`
- 别名：`君联资本`, `君联`

### 启明创投 / Qiming
- 主名：`Qiming Venture Partners`
- 别名：`启明创投`, `启明`

### 中信资本 / CITIC Capital
- 主名：`CITIC Capital`
- 别名：`中信资本`

### CPE 源峰
- 主名：`CPE`
- 别名：`CPE源峰`, `CITIC Private Equity Funds`

### 软银愿景 / SoftBank Vision Fund
- 主名：`SoftBank Vision Fund`
- 别名：`SVF`, `软银愿景基金`, `软银`

---

## 五、对冲基金

### Bridgewater
- 主名：`Bridgewater Associates`
- 别名：`桥水`, `桥水基金`

### Citadel
- 主名：`Citadel`
- 别名：`城堡投资`, `Citadel Securities`

### Millennium
- 主名：`Millennium Management`
- 别名：`千禧管理`, `Millennium`

### Two Sigma
- 主名：`Two Sigma`

### DE Shaw
- 主名：`D.E. Shaw`

### Point72
- 主名：`Point72`
- 别名：`SAC Capital`（已改名）

---

## 六、咨询（金融业务相关）

### McKinsey
- 主名：`McKinsey & Company`
- 别名：`McKinsey`, `麦肯锡`

### BCG
- 主名：`Boston Consulting Group`
- 别名：`BCG`, `波士顿咨询`

### Bain & Company
- 主名：`Bain & Company`
- 别名：`Bain`, `贝恩咨询`, `贝恩公司`（与 Bain Capital 区分）

### Oliver Wyman
- 主名：`Oliver Wyman`
- 别名：`奥纬咨询`

---

## 七、识别规则

### 优先级
当用户输入模糊时（如只说 "JPM"），按以下优先级匹配：
1. 完全匹配主名 / 标准缩写
2. 中文别名匹配
3. 模糊匹配（编辑距离 ≤ 2）

### 歧义处理
当多个机构有相似缩写时（如 "BAML" vs "BoA"），向用户确认：
- "BAML" 通常指 Bank of America Merrill Lynch（投行端）
- "BoA" 也可指零售银行端

### 子公司归属
搜索时建议同时覆盖：
- 母公司全称
- 子公司全称（如 GS HK = Goldman Sachs Asia）
- 历史名称（如 Sequoia China → HongShan，搜索时两个都试）

### Stage 2 自动展开示例
```
用户输入：挖 GS 香港 TMT 的 ED
↓
公司变体展开（同时搜索）：
1. "Goldman Sachs"
2. "Goldman"
3. "GS"
4. "高盛"
↓ 进入 Stage 2 query 生成
```

---

## 八、维护说明

新增机构时需要补充：
1. **主名**（最规范的英文写法）
2. **至少 3 个别名**（缩写、中文、常见误写）
3. **子公司变体**（如有亚太/中国/香港分公司）
4. **关键部门词**（如适用，标注 IBD/Markets/PE 等部门别名）

机构发生重大变动时（合并、分拆、改名）需要标注：
- 改名后增加 `状态：` 字段标注变化
- 旧名作为别名保留，方便搜索历史 profile

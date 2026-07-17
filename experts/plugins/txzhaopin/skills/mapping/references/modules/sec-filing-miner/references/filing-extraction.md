# SEC 文件中介机构信息提取规则

定义如何从 SEC EDGAR 文件中精准提取中介机构和关键人员信息。

---

## 一、SEC 招股书核心章节定位

F-1 / S-1 / 424B 等招股书的中介团队信息集中在以下章节：

| 章节 (英文) | 中文 | 提取价值 | 典型位置 |
|-----------|------|---------|---------|
| **Cover Page** | 封面 | ⭐⭐⭐ Lead Bookrunners / Joint Bookrunners | 第 1-2 页 |
| **Prospectus Summary** | 招股书摘要 | ⭐⭐ 简介 | 前 30 页 |
| **MANAGEMENT** | 管理层 | ⭐⭐⭐⭐ 董事+高管姓名 | 中段 |
| **PRINCIPAL SHAREHOLDERS** | 主要股东 | ⭐⭐ 大股东 | 中段 |
| **UNDERWRITING** | 包销 | ⭐⭐⭐⭐⭐ **完整承销团 + 角色** | 倒数 30-50 页 |
| **PLAN OF DISTRIBUTION** | 配售方案 | ⭐⭐⭐⭐⭐ （有时替代 UNDERWRITING）| 倒数 30-50 页 |
| **EXPERTS** | 专家 | ⭐⭐⭐⭐ 审计师 + 行业顾问 | 倒数 20-30 页 |
| **LEGAL MATTERS** | 法律事项 | ⭐⭐⭐⭐⭐ 律所明确披露 | 倒数 20-30 页 |
| **WHERE YOU CAN FIND ADDITIONAL INFORMATION** | 信息来源 | ⭐ 兜底 | 末尾 |

### 关键 Exhibit（独立文件，需单独抓取）

| Exhibit | 含义 | 提取价值 | 关键内容 |
|---------|------|---------|---------|
| **EX-1.1** | Underwriting Agreement（承销协议） | ⭐⭐⭐⭐⭐ | 完整承销团签字 |
| **EX-5.1** | Legal Opinion - Issuer Counsel | ⭐⭐⭐⭐⭐ | **签字律所合伙人姓名** |
| **EX-8.1** | Tax Opinion | ⭐⭐⭐⭐ | 税务律所签字 |
| **EX-10.1+** | 各类合同附件 | ⭐⭐⭐ 关键股东协议、雇佣合同等 |
| **EX-21.1** | Subsidiaries List | ⭐⭐ 子公司架构 |
| **EX-23.1** | Consent of Auditor | ⭐⭐⭐⭐ **审计师所签字** |
| **EX-99.X** | 其他附件 | ⭐⭐ 行业咨询师同意函等 |

---

## 二、关键角色识别表（与 HKEX 不同处）

### 2.1 投行类角色

| 英文角色 | 中文角色 | 描述 | 提取优先级 |
|---------|---------|------|----------|
| **Lead Bookrunner / Sole Bookrunner** | 主承销商 / 独家簿记管理人 | 类似 HKEX Sole Sponsor，最高责任 | ⭐⭐⭐⭐⭐ |
| **Joint Bookrunners** | 联席簿记管理人 | 通常 3-5 家 | ⭐⭐⭐⭐⭐ |
| **Joint Lead Underwriters** | 联席主承销商 | 旧称（已较少用） | ⭐⭐⭐⭐ |
| **Co-Managers** | 副承销商 | 通常 5-10 家 | ⭐⭐⭐ |
| **Representatives** | 代表（of the Underwriters） | 重要但不一定列出，通常是 Lead Bookrunner | ⭐⭐⭐⭐ |
| **Stabilizing Agent** | 稳定价格代理 | 通常 = Lead Bookrunner | ⭐⭐ |

### 2.2 法律顾问类角色

| 英文角色 | 描述 | 提取价值 |
|---------|------|---------|
| **Counsel to the Company / Issuer (as to U.S. Federal Law)** | 发行人美国法律顾问 | ⭐⭐⭐⭐⭐ |
| **Counsel to the Company (as to Cayman Islands Law)** | 发行人开曼法律顾问 | ⭐⭐⭐⭐ |
| **Counsel to the Company (as to PRC Law)** | 发行人中国法律顾问 | ⭐⭐⭐⭐⭐ |
| **Counsel to the Underwriters (as to U.S. Federal Law)** | 承销商美国法律顾问 | ⭐⭐⭐⭐⭐ |
| **Counsel to the Underwriters (as to PRC Law)** | 承销商中国法律顾问 | ⭐⭐⭐⭐ |
| **Special Tax Counsel** | 税务专项律师 | ⭐⭐⭐ |

### 2.3 会计师/审计师类角色

| 英文角色 | 描述 | 提取价值 |
|---------|------|---------|
| **Independent Registered Public Accounting Firm** | 独立注册会计师 | ⭐⭐⭐⭐⭐ 必披露 |
| **Reporting Accountants** | 申报会计师（同上） | ⭐⭐⭐⭐⭐ |

### 2.4 其他角色

| 英文角色 | 描述 | 提取价值 |
|---------|------|---------|
| **Industry Consultant** | 行业顾问 | ⭐⭐⭐ |
| **Compensation Consultant** | 薪酬顾问 | ⭐⭐ |
| **Transfer Agent and Registrar** | 过户代理人 | ⭐ |
| **Depositary（ADR）** | 存托银行 | ⭐ |
| **Trustee** | 信托人 | ⭐ |

---

## 三、提取 Prompt 模板

### 3.1 标准提取 Prompt

```
你是 SEC F-1 / S-1 招股书结构化提取专家。从下面这段 SEC 文件章节中，提取所有中介机构和关键人员姓名：

【输入】
{filing_section_text}

【输出 JSON Schema】
{
  "issuer": {
    "name_en": "...",
    "ticker": "...",
    "exchange": "NYSE / Nasdaq / NYSE American",
    "incorporation": "Cayman Islands / Delaware / Bermuda",
    "industry": "...",
    "is_china_concept": true/false   // 是否中概股
  },
  "underwriters": [
    {
      "firm_name": "Goldman Sachs (Asia) L.L.C.",
      "role": "Lead Bookrunner / Joint Bookrunner / Co-Manager / Representative",
      "is_lead": true/false
    }
  ],
  "legal_counsel_to_company": [
    {"firm_name": "Skadden, Arps, Slate, Meagher & Flom LLP", "scope": "as to U.S. Federal Law"},
    {"firm_name": "Maples and Calder", "scope": "as to Cayman Islands Law"},
    {"firm_name": "Fangda Partners", "scope": "as to PRC Law"}
  ],
  "legal_counsel_to_underwriters": [
    {"firm_name": "Davis Polk & Wardwell LLP", "scope": "as to U.S. Federal Law"},
    {"firm_name": "JunHe LLP", "scope": "as to PRC Law"}
  ],
  "auditor": {
    "firm": "PricewaterhouseCoopers Zhong Tian LLP",
    "city": "Beijing"
  },
  "industry_consultant": [
    {"firm": "Frost & Sullivan"}
  ],
  "directors_and_officers": [
    {"name": "...", "title": "Chairman / CEO / CFO", "is_independent": true/false}
  ]
}

【重要规则】
- 所有机构名称用 SEC 文件中**完整法定名称**（如 "Goldman Sachs (Asia) L.L.C." 而不是 "Goldman Sachs"）
- "scope" 字段必须明确：as to U.S. Federal Law / Cayman Islands Law / PRC Law / Hong Kong Law
- 如果文件中只列承销商但未指定"Representatives"，将第一家归为 `is_lead: true`
- 中概股发行人通常是 "Cayman Islands incorporation"
- 没找到的字段留空数组 / null，不要捏造
```

### 3.2 Exhibit 5.1 签字提取 Prompt

```
你是 SEC Exhibit 5.1 法律意见书签字提取专家。这类文件由发行人法律顾问出具，结尾会有合伙人签字。

【输入】
{ex_5_1_text}

【输出 JSON】
{
  "law_firm": "Skadden, Arps, Slate, Meagher & Flom LLP",
  "office_location": "Hong Kong / Palo Alto / New York",
  "opinion_date": "2024-XX-XX",
  "issuer_name": "...",
  "signatory_name": "Will H. Cai",
  "signatory_title": "Partner",
  "letterhead_excerpt": "..."  // 可选：信头中的全部办公室地址
}

【签字识别规则】
- 通常以 "Very truly yours,\n\nSkadden, Arps..." 形式出现
- 签字人姓名在律所名下方，以 "/s/ Will H. Cai" 或全名签注
- 提取时不要包含 "/s/" 前缀
- 如果是法律事务所而非个人签字 → signatory_name 留空
```

### 3.3 EX-23.1 审计师同意函 Prompt

```
你是 SEC Exhibit 23.1 审计师同意函提取专家。

【输入】
{ex_23_1_text}

【输出 JSON】
{
  "auditor_firm": "PricewaterhouseCoopers Zhong Tian LLP",
  "city": "Beijing",
  "consent_date": "...",
  "issuer_name": "...",
  "engagement_partner": "..."  // 通常隐藏，如有就提取
}
```

### 3.4 UNDERWRITING 章节专项 Prompt

```
你是 SEC F-1 / S-1 UNDERWRITING 章节解析专家。该章节通常含承销团完整名单和包销份额表。

【输入】
{underwriting_section_text}

【输出 JSON】
{
  "lead_bookrunners": ["Goldman Sachs (Asia) L.L.C.", "Morgan Stanley & Co. LLC"],
  "joint_bookrunners": [...],
  "co_managers": [...],
  "underwriter_allocations": [
    {"firm": "Goldman Sachs", "shares": "5,000,000", "percentage": "25%"},
    ...
  ],
  "stabilizing_agent": "Goldman Sachs (Asia) L.L.C.",
  "underwriting_discount_per_share": "$1.50",
  "over_allotment_option_size": "750,000 shares"
}
```

---

## 四、机构归一化表（继承自 hkex-prospectus-miner，新增美股专属）

### 4.1 投行（美股专有）

```yaml
"Jefferies":
  variants: ["Jefferies", "Jefferies Group LLC", "Jefferies LLC"]

"Cowen":
  variants: ["Cowen", "Cowen and Company"]

"Evercore":
  variants: ["Evercore", "Evercore ISI", "Evercore Group"]

"Lazard":
  variants: ["Lazard", "Lazard Frères & Co."]

"Centerview":
  variants: ["Centerview Partners"]

"Tiger Brokers":
  variants: ["Tiger Brokers", "UP Fintech", "老虎证券"]

"Futu":
  variants: ["Futu Inc.", "Futu Holdings", "富途", "Futu International"]
```

### 4.2 律所（美股专有）

```yaml
"Simpson Thacher":
  variants: ["Simpson Thacher", "Simpson Thacher & Bartlett LLP"]

"Cleary Gottlieb":
  variants: ["Cleary Gottlieb", "Cleary Gottlieb Steen & Hamilton LLP", "Cleary Gottlieb Steen & Hamilton"]

"Latham":
  variants: ["Latham", "Latham & Watkins LLP"]

"Kirkland":
  variants: ["Kirkland", "Kirkland & Ellis LLP"]

"Wilson Sonsini":
  variants: ["Wilson Sonsini", "Wilson Sonsini Goodrich & Rosati"]

"Cravath":
  variants: ["Cravath", "Cravath, Swaine & Moore LLP"]

"Shearman":
  variants: ["Shearman", "Shearman & Sterling LLP"]

"Maples":
  variants: ["Maples and Calder", "Maples Group", "Maples and Calder (Hong Kong) LLP"]

"Conyers":
  variants: ["Conyers", "Conyers Dill & Pearman"]

"Walkers":
  variants: ["Walkers", "Walkers Global"]
```

### 4.3 会计师（PCAOB 注册）

```yaml
"PwC China":
  variants: ["PricewaterhouseCoopers Zhong Tian LLP", "罗兵咸永道中天", "普华永道中天"]

"Deloitte China":
  variants: ["Deloitte Touche Tohmatsu Certified Public Accountants LLP", "德勤华永"]

"KPMG China":
  variants: ["KPMG Huazhen LLP", "毕马威华振"]

"EY China":
  variants: ["Ernst & Young Hua Ming LLP", "安永华明"]

"Marcum":
  variants: ["Marcum LLP", "Marcum"]   # 中概股小型 IPO 常用

"Friedman":
  variants: ["Friedman LLP"]    # 中概股小型 IPO 常用
```

---

## 五、特殊处理

### 5.1 中概股 VIE 架构识别

中概股招股书会披露 VIE（可变利益实体）结构：
- 注册地（Cayman Islands）
- WFOE（外商独资企业，在中国）
- 国内运营实体

提取时识别 VIE 结构 + 中国运营实体名称。

### 5.2 SPAC 合并文件 (S-4 / F-4)

SPAC 上市的"反向合并"路径，文件类型是 S-4 / F-4：
- "Sponsor"（SPAC 发起人，类似投行 sponsor）
- "Target Company"（被合并公司）
- "PIPE investors"（机构投资者）

### 5.3 双重上市 (Dual Listing)

中概股回流港股同时美股二次上市：
- F-1（美股注册声明）
- 同时港股提交招股书

两个 Skill（hkex + sec）需要识别同一公司，去重 deal 记录。

### 5.4 Form 类型识别

| Form 后缀 | 含义 |
|----------|------|
| `/A` | Amendment（修订版）|
| `/MA` | Material Amendment（重大修订）|
| `424B1` | 价格未定的招股书 |
| `424B2` | 已有定价的初步招股书 |
| `424B3` | 已有定价的修订版 |
| `424B4` | 最终招股书（含定价）|
| `424B5` | 增发招股书 |

**抓取建议**：F-1 / F-1/A 优先抓最近一个 + 424B4（最终版）。

---

## 六、常见错误模式

### 6.1 不要犯的错

❌ **把 SEC F-1 的 "Sponsor" 当作类似 HKEX Sponsor**
   → 美股 F-1 没有 Sponsor 概念。"Sponsor" 在美股 = SPAC 发起人

❌ **混淆 "Lead Bookrunner" 和 "Sponsor"**
   → 美股最高责任 = Lead Bookrunner / Representative

❌ **从 EX-1.1 推断 Lead Bookrunner**
   → 应从 Cover Page 和 UNDERWRITING 章节直接提取

❌ **忽略 Cayman Islands Law / PRC Law 律所**
   → 中概股必有，遗漏会导致律所映射不全

### 6.2 HTML 解析特殊情况

⚠️ **EDGAR 文件可能是 HTML / TXT / PDF**
   - HTML：90% 情况，直接 web_fetch 即可
   - TXT：~5%（老 filings），结构松散，LLM 解析仍能用
   - PDF：~5%，复用 pdfplumber

⚠️ **章节标题在 SEC HTML 中通常是 `<font>` 或 `<b>` 标签**
   - 不像现代 HTML 那样 `<h2>`，但内容能拿到

⚠️ **SEC HTML 文件可能很大**（>5 MB）
   - 直接 web_fetch 可能截断
   - 解决：抓 cover page + UNDERWRITING + EXPERTS 章节即可

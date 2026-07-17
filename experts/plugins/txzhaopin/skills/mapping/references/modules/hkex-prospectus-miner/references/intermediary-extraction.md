# 招股书中介机构信息提取规则

本文档定义如何从港股招股书 PDF 文本中精准提取中介机构和关键人员信息。

---

## 一、招股书核心章节定位

港股招股书的中介团队信息集中在以下几个章节：

| 章节 (英文) | 章节 (中文) | 提取价值 | 在招股书的位置 |
|-----------|----------|---------|--------------|
| **Cover Page** | 封面 | ⭐⭐⭐ 保荐人/整体协调人 | 第 1 页 |
| **Definitions** | 释义 | ⭐⭐ 公司全名 / 简称 | 第 5-15 页 |
| **Directors and Parties Involved in the Listing** | 董事及参与上市各方 | ⭐⭐⭐⭐ 完整中介团队 | 第 30-50 页（关键） |
| **Corporate Information** | 公司资料 | ⭐⭐ 注册办公室、香港主要营业地 | 第 50-60 页 |
| **Future Plans and Use of Proceeds** | 未来计划及募集资金用途 | ⭐ - | 中段 |
| **Underwriting** | 包销 | ⭐⭐⭐ 全体承销团 | 后段 |
| **Statutory and General Information / Appendix** | 法定及一般资料附录 | ⭐⭐⭐⭐ **专业人士同意书 + 签字人姓名** | 倒数 30-50 页（最关键） |

**最重要的两个章节**：
1. **"Directors and Parties Involved in the Listing"** — 中介团队**机构**列表
2. **附录里的 "Consents of Experts" / "专业人士同意书"** — 中介团队**签字人姓名**

---

## 二、关键角色识别表

### 2.1 投行类角色

| 英文角色 | 中文角色 | 描述 | 提取优先级 |
|---------|---------|------|----------|
| **Sole Sponsor** | 独家保荐人 | 最高责任主体，1 家 | ⭐⭐⭐⭐⭐ |
| **Joint Sponsors** | 联席保荐人 | 2-3 家 | ⭐⭐⭐⭐⭐ |
| **Sponsor Principals** | 保荐代表人 | **关键披露人名**（每家 2 位） | ⭐⭐⭐⭐⭐ |
| **Overall Coordinators (OC)** | 整体协调人 | 港交所 2024.8 起新角色 | ⭐⭐⭐⭐ |
| **Capital Market Intermediaries (CMI)** | 资本市场中介人 | OC 之外的承销商 | ⭐⭐⭐ |
| **Joint Global Coordinators** | 联席全球协调人 | 旧框架角色（已被 OC 部分取代） | ⭐⭐⭐ |
| **Joint Bookrunners** | 联席账簿管理人 | 通常 5-10 家 | ⭐⭐⭐ |
| **Joint Lead Managers** | 联席牵头经办人 | 较低层级 | ⭐⭐ |
| **Co-Lead Managers** | 联席副经办人 | 最底层承销商 | ⭐ |
| **Stabilising Manager** | 稳定价格经办人 | 通常 1 家 | ⭐⭐ |
| **Industry Consultant** | 行业顾问 | 第三方咨询机构（如弗若斯特沙利文） | ⭐⭐ |

### 2.2 法律顾问类角色

| 英文角色 | 中文角色 | 提取价值 |
|---------|---------|---------|
| **Legal Advisers to the Company as to HK Law** | 公司香港法律顾问 | ⭐⭐⭐⭐ |
| **Legal Advisers to the Company as to PRC Law** | 公司中国法律顾问 | ⭐⭐⭐⭐ |
| **Legal Advisers to the Company as to U.S. Law** | 公司美国法律顾问 | ⭐⭐⭐ |
| **Legal Advisers to the Sponsors as to HK Law** | 保荐人香港法律顾问 | ⭐⭐⭐⭐ |
| **Legal Advisers to the Sponsors as to PRC Law** | 保荐人中国法律顾问 | ⭐⭐⭐ |
| **Legal Advisers to the Sponsors as to U.S. Law** | 保荐人美国法律顾问 | ⭐⭐⭐ |
| **Legal Advisers to the Underwriters** | 承销商法律顾问 | ⭐⭐⭐ |

### 2.3 会计师类角色

| 英文角色 | 中文角色 | 提取价值 |
|---------|---------|---------|
| **Reporting Accountants** | 申报会计师 | ⭐⭐⭐⭐⭐ 必披露 |
| **Auditors** | 审计师 | ⭐⭐⭐⭐ |
| **Engagement Partner** | 项目合伙人 | ⭐⭐⭐⭐⭐ 关键人员 |

### 2.4 其他角色

| 英文角色 | 中文角色 | 提取价值 |
|---------|---------|---------|
| Compliance Adviser | 合规顾问 | ⭐⭐ |
| Receiving Bank | 接收银行 | ⭐ |
| Hong Kong Share Registrar | 香港股份过户登记处 | ⭐ |
| Trustee | 信托人 | ⭐ |
| Industry Consultant | 行业顾问 | ⭐⭐ |
| Property Valuer | 物业估值师 | ⭐ |

---

## 三、提取 Prompt 模板

### 3.1 标准提取 Prompt

```
你是港股招股书结构化提取专家。我会给你招股书 PDF 中的「Directors and Parties Involved in the Listing」章节内容，请提取所有中介机构和关键人员姓名。

【输入】
{prospectus_section_text}

【输出 JSON Schema】
{
  "issuer": {
    "name_zh": "...",
    "name_en": "...",
    "stock_code_intended": "...",
    "industry": "...",
    "incorporation": "Cayman Islands / BVI / 中国"
  },
  "sponsors": [
    {
      "firm_name_en": "Goldman Sachs (Asia) L.L.C.",
      "firm_name_zh": "高盛（亚洲）有限责任公司",
      "role": "Sole Sponsor",
      "principals": []  // 此章节通常无姓名，看附录
    }
  ],
  "overall_coordinators": [...],
  "joint_bookrunners": [...],
  "joint_lead_managers": [...],
  "co_lead_managers": [...],
  "legal_counsel": [
    {
      "firm_name_en": "Linklaters",
      "firm_name_zh": "年利达律师事务所",
      "role": "Legal Advisers to the Company as to HK Law",
      "partners": []  // 此章节通常无姓名
    }
  ],
  "auditor": {
    "firm_en": "PricewaterhouseCoopers",
    "firm_zh": "罗兵咸永道",
    "role": "Reporting Accountants"
  },
  "industry_consultant": [...],
  "compliance_adviser": [...],
  "receiving_banks": [...],
  "hk_share_registrar": "...",
  "directors": {
    "executive": [{"name": "...", "role": "Chairman / CEO"}],
    "non_executive": [...],
    "independent_non_executive": [...]
  }
}

【重要规则】
- 所有机构名称都保留**英中两种**（招股书一般两种都列出）
- "principals" 和 "partners" 字段在此章节通常是空，**留空数组**即可，不要捏造
- 如果某个角色在此章节没找到 → 该字段留空数组 []
- 招股书可能用"主承销商" / "Lead Managers"等不同措辞 → 按上文映射表归一化
```

### 3.2 签字人姓名提取 Prompt（针对附录）

```
你是港股招股书结构化提取专家。我会给你招股书附录中「Consents of Experts」/「专业人士同意书」章节内容，请提取所有签字人姓名。

【输入】
{appendix_consents_text}

【输出 JSON】
{
  "expert_signatures": [
    {
      "firm_name_en": "PricewaterhouseCoopers",
      "firm_role": "Reporting Accountants",
      "signatory_name": "John Smith",  // 必须有姓名
      "signatory_title": "Engagement Partner",  // 如有
      "consent_date": "2025-06-01"
    }
  ]
}

【重要规则】
- 只提取**有明确姓名披露**的；只有机构名的不要列入
- 招股书的同意书部分通常会签注："I / We, [姓名], a member / partner of [机构名] hereby consent..."
- 中文招股书的同意书：「本所」「合伙人」「项目负责人 [姓名]」等
- 不要捏造姓名
```

### 3.3 保荐代表人提取 Prompt

```
保荐代表人（Sponsor Principals）通常在招股书的：
1. **保荐人意见函附录**
2. **WAIVERS FROM STRICT COMPLIANCE 章节** (有时会列)

【输入】
{sponsor_section_text}

【输出 JSON】
{
  "sponsor_principals": [
    {
      "firm_name": "Goldman Sachs (Asia) L.L.C.",
      "principal_name_en": "John Smith",
      "principal_name_zh": "施约翰",
      "title": "Managing Director",
      "department": "Investment Banking - TMT"
    }
  ]
}
```

---

## 四、机构名称归一化表

```yaml
# 投行（外资）
"Goldman Sachs":
  variants: ["Goldman Sachs", "Goldman Sachs (Asia) L.L.C.", "高盛", "高盛（亚洲）", "GS"]
  canonical_zh: "高盛"
  canonical_en: "Goldman Sachs"

"Morgan Stanley":
  variants: ["Morgan Stanley", "Morgan Stanley Asia Limited", "摩根士丹利", "大摩", "MS"]
  canonical_zh: "摩根士丹利"
  canonical_en: "Morgan Stanley"

"J.P. Morgan":
  variants: ["J.P. Morgan", "JPMorgan", "JPM", "摩根大通", "小摩"]

"UBS":
  variants: ["UBS", "UBS AG", "瑞银", "瑞银证券亚洲"]

"BofA":
  variants: ["BofA Securities", "Bank of America", "美银证券", "BAML", "Merrill Lynch"]

"Citi":
  variants: ["Citigroup", "Citi", "花旗", "Citigroup Global Markets"]

"HSBC":
  variants: ["HSBC", "汇丰", "HSBC Limited"]

"DB":
  variants: ["Deutsche Bank", "德意志银行", "DB"]

# 投行（中资）
"中信证券":
  variants: ["CITIC Securities", "中信证券", "CITIC Securities Co., Ltd.", "中信证券股份有限公司"]
  canonical_zh: "中信证券"

"中金":
  variants: ["China International Capital Corporation", "CICC", "中金公司", "中国国际金融"]
  canonical_zh: "中金"

"华泰国际":
  variants: ["Huatai International", "Huatai Securities", "华泰国际", "华泰金融控股"]

"海通国际":
  variants: ["Haitong International", "海通国际", "Haitong"]

"招商证券":
  variants: ["China Merchants Securities", "招商证券", "CMS"]

"国泰海通":  # 2024 合并
  variants: ["Guotai Junan", "Guotai Junan International", "国泰海通", "国泰君安国际"]

# 律所
"Linklaters":
  variants: ["Linklaters", "年利达律师事务所", "年利达"]

"Davis Polk":
  variants: ["Davis Polk", "Davis Polk & Wardwell", "戴维波克"]

"Freshfields":
  variants: ["Freshfields", "Freshfields Bruckhaus Deringer", "富而德律师事务所", "富而德"]

"Sullivan & Cromwell":
  variants: ["Sullivan & Cromwell", "S&C", "苏利文"]

"Skadden":
  variants: ["Skadden", "Skadden, Arps", "世达律师事务所", "世达"]

"Slaughter and May":
  variants: ["Slaughter and May", "司力达律师楼", "司力达"]

# 会计师
"PwC":
  variants: ["PricewaterhouseCoopers", "PwC", "罗兵咸永道", "普华永道"]
  canonical_zh: "普华永道"

"Deloitte":
  variants: ["Deloitte", "Deloitte Touche Tohmatsu", "德勤", "德勤·关黄陈方"]
  canonical_zh: "德勤"

"KPMG":
  variants: ["KPMG", "毕马威", "毕马威会计师事务所"]

"EY":
  variants: ["EY", "Ernst & Young", "安永", "安永会计师事务所"]
```

---

## 五、人员姓名特殊处理

### 5.1 中英文姓名映射

招股书常见同时出现中英文姓名：
```
姓名: Tai Wing Lap (戴永立)  / Andy Tai
       \_____ 拼音 ______/   中文名     \_英文名_/
```

提取规则：
- 优先匹配 `name_en (name_zh)` 或 `name_zh / name_en`
- 拼音和正式英文名都保留（拼音放 alias）
- 性别从港股惯例可推断（Mr./Ms./Dr.）

### 5.2 重名处理

同名不同机构 → 不合并，标注 `disambiguation: "工作机构"`

同名同机构 → 检查招股书发行年 + 项目，确定是否同一人

### 5.3 离职跟踪

招股书披露的是 **当时在该机构的人员**。如果该 banker 后来离职：
- 仍保留这个签名记录（表示该项目曾参与）
- 在 person 字段添加 `last_known_at` 等时间标记
- 与 linkedin-deep-miner 合并时通过姓名匹配确认是否同一人

---

## 六、常见错误模式

### 6.1 不要犯的错

❌ **从招股书 cover page 推断保荐代表人姓名** → cover page 只列机构
❌ **把承销团律师当成发行人律师** → "Legal Advisers to the Underwriters" ≠ "Legal Advisers to the Company"
❌ **混淆"申报会计师"和"审计师"** → 招股书的 reporting accountant 通常等同审计师，但偶有不同
❌ **忽略 Joint Sponsors 中的中资机构** → 中资投行最近几年抢占了大量保荐人份额
❌ **把"Compliance Adviser"误识为"Legal Counsel"** → Compliance Adviser 是上市后专属角色

### 6.2 PDF 解析特殊情况

⚠️ **图片格式 PDF**（2010 年前的招股书） → 抽取失败，标记到 open_questions
⚠️ **超长 PDF (>500 页)** → web_fetch 可能截断，需要多次分段请求
⚠️ **中英文版本**（同一招股书有 EN + 中文两版） → 优先使用英文版（结构化更稳定），中文版只用于姓名校对

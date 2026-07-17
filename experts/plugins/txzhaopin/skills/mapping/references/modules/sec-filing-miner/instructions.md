---
name: sec-filing-miner
description: "SEC EDGAR 美股招股书人才挖掘器。从 SEC EDGAR 的美股 IPO/再融资/年报文件（F-1, S-1, 424B, 20-F, DEF 14A）挖掘承销团队、律所合伙人、审计师、董事高管。针对中概股美股 IPO / 美股二次上市 / 美股再融资的投行人员挖掘。触发短语：SEC filing、EDGAR、美股 IPO 团队、承销商、underwriters、F-1 招股书、S-1 招股书、挖 SEC、sec-filing-miner、prospectus US、Schedule 14A。"
---

# SEC Filing Miner v1.0

SEC EDGAR → 美股 IPO 投行/律所/会计师团队挖掘 Skill。

**核心定位**：从 SEC EDGAR（美国证监会公开披露平台）挖掘**法定披露**的中介机构团队。中概股美股 IPO / 美股科技公司 IPO 的最高质量人员挖掘渠道。

---

## 一、适用场景

✅ **适合用此 Skill**：
- 挖某投行在某段时期的美股 IPO 承销团队
- 挖中概股 IPO（如 Coupang / DiDi / Lufax / RLX 等）的中介团队
- 挖律所（Skadden / Davis Polk / Sullivan & Cromwell）的美股 IPO 项目合伙人
- 挖某 banker 是否参与过具体美股 deal（履历验证）
- 美股二次上市（如 阿里 / 京东 等中概股回港同时美股发行）的中介

❌ **不适合用此 Skill**：
- 港股 IPO（→ `hkex-prospectus-miner`）
- 未上市公司团队（→ `linkedin-deep-miner`）
- 一级市场 deal team（→ `deal-news-miner`）

---

## 二、关键数据源

| 数据源 | URL | 说明 |
|-------|-----|------|
| **SEC EDGAR 主搜索** | `https://www.sec.gov/cgi-bin/browse-edgar` | 按发行人/CIK 搜索 |
| **EDGAR 全文检索** | `https://efts.sec.gov/LATEST/search-index?q=...` | 按关键词搜索文件 |
| **EDGAR 高级搜索** | `https://efts.sec.gov/LATEST/search-index?q=&dateRange=custom&forms=F-1` | 按表单类型 + 时间筛选 |
| **公司提交历史** | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}` | 按 CIK 拉所有提交 |
| **Google 索引** | `site:sec.gov inurl:Archives "Goldman Sachs" "underwriters"` | 备选 dorking |

---

## 三、核心 SEC 表单类型

| 表单 | 用途 | 提取价值 |
|------|------|---------|
| **F-1** | 外国发行人首次公开发行（中概股最常用） | ⭐⭐⭐⭐⭐ 完整中介团队 |
| **F-1/A** | F-1 修订版 | ⭐⭐⭐⭐ 持续更新版 |
| **S-1** | 美国本土公司首次公开发行 | ⭐⭐⭐⭐⭐ 完整中介团队 |
| **S-1/A** | S-1 修订版 | ⭐⭐⭐⭐ |
| **424B1/B3/B4/B5** | 最终招股书（fully priced prospectus） | ⭐⭐⭐⭐⭐ **必看，含最终价格+定稿团队** |
| **F-3 / S-3** | Shelf 注册（再融资） | ⭐⭐⭐ 持续承销关系 |
| **20-F** | 外国发行人年报 | ⭐⭐⭐ 含审计师 + 高管 |
| **10-K** | 美国本土公司年报 | ⭐⭐⭐ |
| **DEF 14A** | 委托书（高管薪酬披露） | ⭐⭐⭐⭐ 高管姓名 + 董事 |
| **6-K** | 外国发行人重要事项报告 | ⭐⭐ 各类公告 |
| **EX-1.1** | 承销协议附件 | ⭐⭐⭐⭐⭐ **关键：完整承销团 + 法务签字** |
| **EX-5.1 / EX-8.1** | 法律意见书附件 | ⭐⭐⭐⭐⭐ **律所合伙人签字** |
| **EX-23.1** | 审计师同意函附件 | ⭐⭐⭐⭐ 审计师签字 |

---

## 四、5 阶段工作流

### Stage 1: 意图解析

```json
{
  "target_type": "investment_bank | law_firm | accounting_firm | issuer | industry",
  "target_company": "Goldman Sachs / Morgan Stanley / Davis Polk",
  "target_aliases": [...],
  "industry_filter": "Tech / Healthcare / Consumer / Financial / All",
  "issuer_geography": "China / US / Europe / All",
  "form_types": ["F-1", "S-1", "424B", "20-F"],
  "time_range_start": "YYYY-MM",
  "time_range_end": "YYYY-MM",
  "max_filings": 20
}
```

**示例**：
- "扒高盛 2024 年中概股 IPO 承销团队" → target=GS / forms=F-1,424B / geography=China
- "Skadden 在美股 IPO 的合伙人" → target=Skadden / role=Legal Counsel
- "PwC 担任审计师的中概股美股 IPO" → target=PwC / type=accounting_firm

### Stage 2: SEC EDGAR 检索

**主路径**（推荐）：直接 EDGAR 全文搜索 API

```
https://efts.sec.gov/LATEST/search-index?q=%22Goldman+Sachs%22+%22underwriters%22&forms=F-1&dateRange=custom&startdt=2024-01-01&enddt=2024-12-31
```

**降级路径**：Google Dorking

```
site:sec.gov inurl:Archives "Goldman Sachs" "underwriters" "F-1"
site:sec.gov filetype:htm "Davis Polk" "Underwriters Counsel"
```

### Stage 3: HTML/PDF 抽取

**与 hkex-prospectus-miner 的关键差异**：SEC 文件**通常是 HTML 格式**（EDGAR 优先），不是 PDF。

#### 3.1 HTML 抽取（首选）

```python
# F-1 / S-1 文件的 HTML 版本
url = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{filename}.htm"

# 直接 web_fetch HTML，效率远高于 PDF
result = web_fetch(url, fetchInfo="提取 'UNDERWRITING' / 'PLAN OF DISTRIBUTION' / 'EXPERTS' / 'LEGAL MATTERS' 章节")
```

EDGAR HTML 文件优势：
- ✅ 结构化标签清晰（不像 PDF 是 FlateDecode 流）
- ✅ 章节标题用 `<h2>` / `<h3>` / `<b>` 标记
- ✅ web_fetch 直接可读

#### 3.2 PDF 抽取（备选）

如果 HTML 不可用（EDGAR 极少数情况），复用 hkex-prospectus-miner 的 PDF 解析能力：

```bash
python3 ../hkex-prospectus-miner/scripts/fetch_and_extract_pdf.py \
  --url "https://www.sec.gov/Archives/.../prospectus.pdf" \
  --output ./sec_temp \
  --sections "UNDERWRITING,PLAN OF DISTRIBUTION,EXPERTS,LEGAL MATTERS"
```

#### 3.3 关键章节定位

| 章节 (英文) | 提取价值 |
|-----------|---------|
| **UNDERWRITING** | ⭐⭐⭐⭐⭐ 全体承销团 + 委托关系 |
| **PLAN OF DISTRIBUTION** | ⭐⭐⭐⭐⭐ 配售方案（替代 UNDERWRITING） |
| **EXPERTS** | ⭐⭐⭐⭐ 审计师 + 行业顾问 |
| **LEGAL MATTERS** | ⭐⭐⭐⭐⭐ 律所明确披露 + 部分签字人姓名 |
| **MANAGEMENT** | ⭐⭐⭐⭐ 高管 + 董事 |
| **PRINCIPAL SHAREHOLDERS** | ⭐⭐ 大股东 |
| **附件 EX-1.1** | ⭐⭐⭐⭐⭐ Underwriting Agreement 完整签字 |
| **附件 EX-5.1 / EX-8.1** | ⭐⭐⭐⭐⭐ 律所合伙人签字 |
| **附件 EX-23.1** | ⭐⭐⭐⭐ 审计师签字 |

### Stage 4: 团队解析与去重

按 `references/filing-extraction.md` 规则，应用 LLM Prompt 提取：

```json
{
  "issuer": {"name_en": "...", "ticker": "...", "incorporation": "Cayman Islands", "industry": "..."},
  "underwriters": [
    {"firm_name": "Goldman Sachs (Asia) L.L.C.", "role": "Lead Bookrunner / Joint Bookrunner / Co-Manager"}
  ],
  "legal_counsel_to_company": [
    {"firm_name": "Skadden, Arps, Slate, Meagher & Flom LLP", "scope": "as to U.S. federal law"}
  ],
  "legal_counsel_to_underwriters": [
    {"firm_name": "Davis Polk & Wardwell LLP", "scope": "as to U.S. federal law"}
  ],
  "auditor": {"firm": "PricewaterhouseCoopers", "engagement_partner": "..."},
  "directors_and_officers": [...],
  "experts_signatures": [
    {"firm": "Skadden", "signatory": "Will H. Cai", "title": "Partner", "exhibit": "EX-5.1"}
  ]
}
```

**多 filing 去重**：同一人在多个 filing 出现 → 累积 `deal_history`，置信度升级。

### Stage 5: 入库 + 渲染

**核心规则**（详见 `references/output-contract.md`）：

- 复用 `hkex-prospectus-miner` 创建的机构 JSON（如 `gs-ibd.json`）
- 在 `confirmed_deals_and_rankings` 字段追加美股 deal 记录，**用 `source` 字段区分**：
  ```json
  {"deal": "Lufax Holding US IPO", "source": "sec-filing-miner", ...}
  {"deal": "牧原股份 港股 IPO", "source": "hkex-prospectus-miner", ...}
  ```
- 一个 banker 同时参与 港股 + 美股 IPO → `deal_history` 字段记录全部，最终 confidence = `very_high`

---

## 五、合规与边界

✅ **完全合规**：
- SEC EDGAR 是**美国法定信息披露平台**
- 所有文件均为**强制公开**且 SEC 鼓励程序化访问
- SEC 提供官方 API（无反爬）

⚠️ **必须遵守**：
- 请求头必须含 `User-Agent: Your Name (your@email.com)`（SEC 明确要求）
- 请求频率 ≤ 10 req/sec（SEC fair access policy）

---

## 六、与其他 Skill 的协作

```
[hkex-prospectus-miner 挖到] David Hoyer 是 5 个 HK IPO 的 Joint Bookrunner
                            ↓
[sec-filing-miner 挖到] David Hoyer 也是 3 个 中概股美股 IPO 的 Co-Manager
                            ↓ 跨 deal 履历合并
[org-knowledge-base 渲染] David Hoyer 节点：
   ⭐⭐⭐⭐⭐ HK IPO 5 单 + US IPO 3 单 = 完整跨市场履历
```

---

## 七、技术架构

- **HTML 抽取**：`web_fetch` 直接抓 EDGAR HTML（首选，效率高）
- **PDF 抽取**：复用 `hkex-prospectus-miner/scripts/fetch_and_extract_pdf.py`
- **EDGAR 全文 API**：`web_fetch` + JSON 解析

---

## 八、参考文档

- `references/edgar-search-strategies.md` — EDGAR 检索策略库
- `references/filing-extraction.md` — SEC 文件中介机构提取规则
- `references/output-contract.md` — 与 org-knowledge-base 数据契约
- `scripts/workflow-orchestration.md` — 5 阶段工具调用编排

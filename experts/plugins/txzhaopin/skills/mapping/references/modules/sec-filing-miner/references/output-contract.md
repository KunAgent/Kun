## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# SEC Filing → org-knowledge-base 数据契约

定义 sec-filing-miner 输出 → `org-knowledge-base` 入库规则。**与 hkex-prospectus-miner 共用同一套机构 JSON**，通过 `source` 字段区分数据来源。

---

## 一、机构维度组织（与 HKEX 完全一致）

| 类型 | JSON 命名 | 例子 |
|------|----------|------|
| 投行 | `{firm-id}.json` | `gs-ibd.json` / `cicc.json` / `tiger-brokers.json` |
| 律所 | `{firm-id}.json` | `skadden.json` / `davis-polk.json` / `simpson-thacher.json` |
| 会计师 | `{firm-id}.json` | `pwc.json` / `deloitte.json` |
| 发行人(可选) | `deal-{ticker}-{name}.json` | 例如 `deal-DIDI-didi.json` |

**关键设计**：sec-filing-miner 与 hkex-prospectus-miner 共用文件！例如：
- 高盛在港股 IPO 是 Joint Sponsor → 写入 `gs-ibd.json` 的 confirmed_deals_and_rankings（source = "hkex"）
- 高盛在美股 IPO 是 Lead Bookrunner → **同样**写入 `gs-ibd.json`（source = "sec"）
- → 一个 banker 跨港美股两边的履历都在同一文件，自然汇总

---

## 二、扩展字段（在 hkex 契约基础上）

### 2.1 `confirmed_deals_and_rankings`（共用）

```json
{
  "deal": "Coupang Inc. US IPO",
  "deal_type": "US IPO",   // 区分港股 / 美股 / SPAC / 二次上市
  "exchange": "NYSE",
  "ticker": "CPNG",
  "issuer_industry": "Tech / E-commerce",
  "ms_role": "Joint Bookrunner / Co-Manager",
  "underwriters": ["Goldman Sachs", "Allen & Company", "JPMorgan", "Citi"],
  "is_lead": false,          // 该机构是否 Lead Bookrunner
  "team_members": ["person-xxx"],
  "deal_size_usd": "4.55B",
  "date": "2021-03-11",
  "form_types_filed": ["F-1", "424B4"],
  "filing_url": "https://www.sec.gov/Archives/edgar/data/...",
  "source": "sec-filing-miner v1.0",   // ← 关键区分字段
  "extracted_at": "..."
}
```

### 2.2 `personnel[].deal_history`（共用）

每位 banker / lawyer / accountant 累积参与的 deal：

```json
{
  "id": "person-david-hoyer",
  "deal_history": [
    {"deal": "牧原股份", "role": "Joint Sponsor", "market": "HK", "date": "2026-01", "source": "hkex"},
    {"deal": "Coupang", "role": "Joint Bookrunner", "market": "US", "date": "2021-03", "source": "sec"},
    {"deal": "DiDi", "role": "Co-Manager", "market": "US", "date": "2021-06", "source": "sec"}
  ]
}
```

### 2.3 confidence 升级机制（增强版）

| 数据来源 | confidence |
|---------|-----------|
| HKEX 招股书签字披露（法定） | very_high ⭐⭐⭐⭐⭐ |
| **SEC F-1/EX-5.1 律所合伙人签字** | **very_high** ⭐⭐⭐⭐⭐ |
| **SEC EX-23.1 审计师签字** | **very_high** ⭐⭐⭐⭐⭐ |
| HKEX/SEC 机构层 + LinkedIn 交叉 | high ⭐⭐⭐⭐ |
| 单源招股书 | medium-high ⭐⭐⭐ |

### 2.4 新增字段：`market_coverage`

每个 banker 累积参与的市场：

```json
{
  "id": "person-david-hoyer",
  "market_coverage": ["HK", "US"],   // 港美股都做
  "deal_count_by_market": {"HK": 5, "US": 3}
}
```

---

## 三、字段映射

| SEC Filing 字段 | org-knowledge-base 字段 |
|----------------|----------------------|
| `underwriters[].firm_name` | `confirmed_deals_and_rankings[].underwriters[]` |
| `legal_counsel_to_company[].firm_name` | 写入对应 律所 JSON `confirmed_deals_and_rankings` |
| `auditor.firm` | 写入 `pwc.json` / `deloitte.json` 等 |
| `experts_signatures[].signatory` | `personnel[].name` (signatory_name) |
| `experts_signatures[].title` | `personnel[].title` |
| `experts_signatures[].exhibit` | `personnel[].source_urls[]` |
| `directors_and_officers[]` | 写入 `deal-{ticker}.json` 或暂存 `notes` |

---

## 四、增量合并规则

### 4.1 跨 Skill 的 deal 去重

可能场景：同一公司港美股双重上市，两个 Skill 都识别到。处理：

```
1. 按 issuer 名（normalize 后）+ exchange 字段判断
2. HK + US 双重上市 → 创建两条独立 deal（市场不同）
3. 同 exchange + 同 issuer + 时间相近 → 视为同一 deal，合并
```

### 4.2 跨 Skill 的人员合并

```python
def merge_person(existing_p, new_p, source):
    # 同名同公司 → 合并 deal_history
    if name_match(new_p["name"], existing_p["name"]) and \
       firm_match(new_p["firm"], existing_p["firm"]):
        for deal in new_p["deal_history"]:
            existing_p["deal_history"].append({**deal, "source": source})

        # 更新 market_coverage
        market = "US" if source == "sec" else "HK"
        if market not in existing_p.get("market_coverage", []):
            existing_p.setdefault("market_coverage", []).append(market)

        # 升级 confidence
        if source in ["sec", "hkex"]:
            existing_p["confidence"] = "very_high"

        return existing_p
    return None  # 不合并，按新人录入
```

---

## 五、输出报告样例

```markdown
## SEC Filing 挖掘结果（与 HKEX 数据合并）

**目标**: 高盛 2024 年中概股美股 IPO 承销团队
**检索 filings**: 18 份 F-1 / F-1A / 424B
**解析成功**: 15 份 / 3 份失败
**新增/更新**: 5 deals 新增 / 3 deals 已存在更新 / 7 人员升级 confidence

**关键发现**:
- 高盛 2024 年承销 7 个中概股美股 IPO（4 Lead Bookrunner + 3 Co-Manager）
- 与 HKEX 数据交叉：David Hoyer 同时参与 5 HK IPO + 2 US IPO → 跨市场覆盖
- 新发现 Skadden 合伙人 Will H. Cai（5 个中概股 EX-5.1 签字 → 高频中概股 counsel）

**已生成/更新**:
- gs-ibd.json (新增 5 deals + 升级 7 人员 confidence)
- skadden.json (新建，含 1 位合伙人 + 5 deals)
- pwc.json (新增 3 deals)
- deal-CPNG-coupang.json (新建，可选)

**Open Questions**:
- 3 份 F-1 PDF 解析失败 → 已记录到 open_questions
- 2 个未识别中介机构 → 等待人工归一化
```

---

## 六、HTML 渲染要求

调用 `org-knowledge-base/scripts/generate-chart.md` 模板，**新增市场覆盖徽章**：

```
人员节点
├── 姓名 + 职级
├── ⭐⭐⭐⭐⭐ confidence
└── 🇭🇰5 + 🇺🇸3 = 跨市场覆盖徽章
```

deal 列表按市场分组显示：
```
机构节点
├── HK Deals (5)
│   ├── 牧原股份 (Joint Sponsor)
│   ├── Bloks Group (Joint Sponsor)
│   └── ...
└── US Deals (3)
    ├── Coupang (Joint Bookrunner)
    └── ...
```

---

## 七、错误降级

| 场景 | 处理 |
|------|------|
| EDGAR API 返回 403 | 检查 User-Agent 合规，重试 |
| EDGAR API 返回 429 | 指数退避：5/15/45 秒 |
| HTML 文件 > 10 MB（罕见） | 改抓特定章节锚点链接 |
| Exhibit URL 拼接错误 | 从 filing index page (-index.htm) 获取真实链接 |
| LLM 解析返回空 | 重试一次，仍空则跳过 |

---

## 八、与未来 Skill 的兼容性预留

### 8.1 与 deal-news-miner 协调

未来 deal-news-miner 也写入相同 confirmed_deals_and_rankings 字段，按 source 区分：
```
"source": "hkex-prospectus-miner"   # 法定披露 → very_high confidence
"source": "sec-filing-miner"        # 法定披露 → very_high confidence
"source": "deal-news-miner"         # 媒体披露 → medium confidence
```

### 8.2 与 mapping-universal 协调

总调度器根据用户 query 自动派发：
- "扒高盛 HK IPO" → hkex-prospectus-miner
- "扒高盛 US IPO" → sec-filing-miner
- "扒高盛 IPO 团队（不限市场）" → 两者并行执行 + 合并报告

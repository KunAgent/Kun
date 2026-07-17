---
name: deal-news-miner
description: "投资 Deal 新闻人才挖掘器。从中外财经媒体的 Deal 新闻、League Table、行业报告中挖掘 banker 名字。覆盖：Bloomberg、Reuters、彭博、WSJ、FT、36氪、晚点 LatePost、财新、证券时报、21世纪经济报道、IFR、Mergermarket 等。挖某投行/基金的 deal team / 补充某 banker 在某 deal 中的角色 / 识别某赛道 top rainmaker / 投资业务线 Mapping 的关键数据源。触发短语：媒体挖、新闻里找、deal news、扒 IFR、Reuters 搜、36氪 搜、晚点搜、deal-news-miner。"
---

# Deal News Miner v1.0

财经媒体 Deal 新闻 → 投行 banker 个人姓名挖掘 Skill。

**核心定位**：从中英文财经媒体的 deal 报道、人事变动新闻、行业排行榜中，挖掘**法定披露文件中拿不到的 banker 个人姓名**。这是 Senior 层 banker 个人 Mapping 的 P0 数据源。

---

## 一、适用场景

✅ **适合用此 Skill**：
- 在 deal pre-announcement / 路演阶段（招股书未公开前）就要拿到 banker 姓名
- 挖某投行 deal team 的具体执行人（招股书只列机构，媒体常 cue 个人）
- 验证某 banker 是否参与过某具体项目（履历 cross check）
- 识别某赛道的 "rainmaker"（持续被 cue 到的活跃 banker）
- 跟踪人事变动（"XX 投行 MD David Hoyer 跳槽到 YY"）
- 跨 deal team 关系挖掘（同一 deal 媒体常列出多家投行的 lead banker）

❌ **不适合用此 Skill**：
- 完整 IPO 中介团队（→ `hkex-prospectus-miner` / `sec-filing-miner` 法定披露更全）
- 候选人当前职位（→ `linkedin-deep-miner`）
- 美术人才（→ `artstation-talent-finder`）

---

## 二、关键数据源（按优先级）

### 2.1 国际财经媒体（英文，外资投行权威）

| 媒体 | URL | 特点 | 价值 |
|------|-----|------|------|
| **Bloomberg** | bloomberg.com | Banker 个人 cue 率最高 | ⭐⭐⭐⭐⭐ |
| **Reuters** | reuters.com | Deal team lead 名字常出现 | ⭐⭐⭐⭐⭐ |
| **WSJ** | wsj.com | M&A 大单 deal team | ⭐⭐⭐⭐⭐ |
| **Financial Times (FT)** | ft.com | 欧洲 + 亚洲 deal | ⭐⭐⭐⭐ |
| **IFR (Reuters)** | ifre.com | 债券/股权融资专业期刊，**banker 名字密集** | ⭐⭐⭐⭐⭐ |
| **Mergermarket** | mergermarket.com | M&A 专业（付费），通常通过 Google 索引看 snippet | ⭐⭐⭐⭐ |
| **Dealogic / Refinitiv** | dealogic.com | 量化排行榜（League Table） | ⭐⭐⭐ |
| **eFinancialCareers** | efinancialcareers.com / .hk | 投行人事变动专业媒体 | ⭐⭐⭐⭐⭐ |

### 2.2 中国财经媒体（中文，中资投行 + 一级市场权威）

| 媒体 | URL | 特点 | 价值 |
|------|-----|------|------|
| **36氪** | 36kr.com | 一级市场 deal 必看，常列具体 banker | ⭐⭐⭐⭐⭐ |
| **晚点 LatePost** | latepost.com / 微信公众号 | 深度科技 deal 报道，常采访 deal team | ⭐⭐⭐⭐⭐ |
| **财新** | caixin.com / caixinglobal.com | 一线深度报道 | ⭐⭐⭐⭐⭐ |
| **21世纪经济报道** | 21jingji.com | 投行人事专业 | ⭐⭐⭐⭐ |
| **证券时报** | stcn.com | A 股 IPO 中介详情 | ⭐⭐⭐⭐ |
| **新浪财经** | sina.com.cn / sina.cn | 综合财经 + 转载多 | ⭐⭐⭐ |
| **腾讯新闻** | qq.com / news.qq.com | 综合财经 + 内容海量 | ⭐⭐⭐ |
| **第一财经 / 界面** | yicai.com / jiemian.com | 中文一线 | ⭐⭐⭐⭐ |
| **瑞恩资本（Ryanben Capital）** | ryanbencapital.com | **港股 IPO 排行榜权威** | ⭐⭐⭐⭐⭐ |
| **智通财经** | zhitongcaijing.com | 港股新闻 + 转载 | ⭐⭐⭐⭐ |
| **格隆汇** | gelonghui.com | 港股 IPO 持续跟踪 | ⭐⭐⭐⭐ |
| **新时空研究院** | newtimespace.com | IPO 中介机构服务规模榜单 | ⭐⭐⭐⭐ |

### 2.3 知乎专栏 / 微信公众号（个人爆料 + 内部信息）

| 来源 | 特点 | 价值 |
|------|------|------|
| 知乎 投行专栏 | 离职 banker 写"XX 公司 IPO 内幕"是金矿 | ⭐⭐⭐⭐⭐ |
| 微信公众号 "瑞恩资本"/"投行客"/"IPO观察" | 名字最密集 | ⭐⭐⭐⭐⭐ |

---

## 三、5 阶段工作流

### Stage 1: 意图解析

```json
{
  "search_mode": "by_banker | by_deal | by_firm | by_industry | by_event",
  "target": "Goldman Sachs / David Hoyer / 阶跃星辰 / TMT IPO / 人事变动",
  "time_range": {"start": "2024-01", "end": "2025-12"},
  "focus_market": "HK / US / China A / Global",
  "language_preference": "zh / en / both"
}
```

**示例输入解析**：
- "媒体挖高盛 TMT 团队的 banker 姓名" → mode=by_firm + target=GS TMT
- "阶跃星辰的 deal team 是谁" → mode=by_deal + target=阶跃星辰
- "近 1 年港股 IPO 的活跃 rainmaker" → mode=by_industry + market=HK

### Stage 2: 多源并行检索

按 mode 自动派发 6-12 个查询变体（详见 `references/news-source-strategies.md`）：

```
mode = "by_firm + 高盛 TMT"
↓
查询变体：
1. "Goldman Sachs" "TMT" Hong Kong banker 2024..2025 site:bloomberg.com
2. "Goldman Sachs" "TMT" 投行 site:reuters.com
3. "高盛" TMT 投行 deal site:36kr.com
4. "高盛" TMT 银行家 site:caixin.com
5. "高盛" 香港 投行家 site:latepost.com
6. "高盛" "managing director" "TMT" site:efinancialcareers.com
7. "Goldman Sachs" "TMT" "Co-Head" site:ifre.com
8. "高盛" TMT 离职 加入 site:21jingji.com
9. "高盛" deal team site:zhihu.com
```

### Stage 3: 文章解析与人名提取

**工具**：`web_fetch` 拿全文 + LLM 提取人名

**关键挑战**：媒体文章往往**夹杂大量其他人名**（公司高管、客户、竞争对手），需要精准识别"该人名属于目标投行"。

**LLM Prompt 模板**（详见 `references/banker-name-extraction.md`）：

```
你是金融人物姓名提取专家。从下面这篇媒体文章中提取所有【在文中明确归属于目标投行的 banker 姓名】。

【目标投行】Goldman Sachs / 高盛
【文章】{article_text}

【输出 JSON】
{
  "extracted_bankers": [
    {
      "name_en": "David Hoyer",
      "name_zh": "",
      "title_in_article": "ED at Goldman Sachs TMT Hong Kong",
      "deal_or_event": "MiniMax IPO advisor",
      "context_snippet": "...原文片段，证明归属...",
      "confidence": "high / medium / low"
    }
  ],
  "deals_mentioned": [
    {"deal": "MiniMax IPO", "year": "2025", "issuer": "MiniMax"}
  ],
  "person_movements": [
    {"name": "...", "from_firm": "GS", "to_firm": "...", "date": "...", "type": "join / leave"}
  ]
}

【精确度规则】
- 必须有原文 snippet 证明该 banker 在该投行就职（不是客户/对手/家属）
- 仅有姓没有名 → confidence: low（待补全）
- "据知情人士透露" 没有具名的 → 不提取
- 离职/跳槽事件单独标注（→ person_movements 字段）
```

### Stage 4: 多源交叉验证 + 去重

**核心规则**：
- 同一 banker 在 N 个独立媒体出现 → confidence 升级（N=2 → high, N=3+ → very_high）
- 自动 cross check 与已有 JSON 数据（如 `gs-ibd.json` 已有 David Hoyer）
- 媒体爆料的离职/跳槽事件 → 单独路径写入 `update_history` + 更新 person 状态

**confidence 规则**：

| 来源 | confidence |
|------|-----------|
| Bloomberg / Reuters / IFR + LinkedIn 双源 | very_high |
| 单一国际权威媒体（Bloomberg/Reuters/WSJ/FT/IFR） | high |
| 单一中文权威媒体（36氪/晚点/财新） | high |
| 单一二线媒体（新浪/腾讯转载） | medium |
| 知乎专栏 / 微信公众号 | medium-low（需交叉） |

### Stage 5: 入库 + 渲染

**与已有 JSON 合并**（见 `references/output-contract.md`）：
- 已有人员 → 追加 `deal_history` + 升级 confidence
- 新发现人员 → 创建 personnel 记录（confidence 标注媒体来源）
- 离职跳槽事件 → 更新 person 的 `status` + 写 `update_history`

**输出报告**：
```markdown
## Deal News 挖掘结果

**目标**: 高盛 TMT 团队 - 媒体爆料
**检索文章**: 23 篇
**有效爆料**: 12 篇

**新增/更新**:
- 新发现 banker: 3 位（confidence=high，多源交叉）
- 验证已有人员: 5 位（升级 confidence）
- 人事变动: 2 起（David Hoyer 2024.6 从 BAML 跳槽到 GS / Curtis Leung 2025.11 升 MD）

**rainmaker 排行**（被多媒体 cue 频次）:
- David Hoyer: 7 次（4 deal + 3 人事新闻）
- Curtis Leung: 4 次
```

---

## 四、合规与边界

✅ **完全合规**：
- 所有引用的媒体文章均为**公开内容**
- 仅记录媒体已公开的姓名/职位
- 无反爬风险（媒体 SEO 优化）

⚠️ **注意**：
- 部分付费墙媒体（WSJ/FT/Bloomberg）只能拿到 snippet
- 中文公众号文章在搜索引擎索引下可见，无需登录

---

## 五、与其他 Skill 的协作

```
[hkex-prospectus-miner] 知道高盛是某 IPO 的 Joint Sponsor（机构层）
                                    ↓
[deal-news-miner] 媒体报道："Goldman Sachs's David Hoyer 主导该 deal"
                                    ↓ 个人姓名补全 + 招股书 cross check
[org-knowledge-base 渲染] David Hoyer：Joint Sponsor 项目 5 个 + 媒体爆料 3 个
                          confidence: very_high (法定+媒体双源)
```

---

## 六、参考文档

- `references/news-source-strategies.md` — 媒体源检索策略库（含 dorking 模板）
- `references/banker-name-extraction.md` — 人名提取规则与 LLM Prompt
- `references/output-contract.md` — 与 org-knowledge-base 数据契约
- `scripts/workflow-orchestration.md` — 5 阶段工具调用编排

# Banker 姓名提取规则

定义如何从财经媒体文章中精准识别和提取属于目标投行的 banker 姓名。

## 一、文章类型识别

| 类型 | 特征关键词 | 提取重点 |
|------|----------|---------|
| Deal 报道 | IPO / M&A / 配股 | deal team + 投行角色 |
| 人事变动 | joins / departs / promoted / 离职 / 加入 / 晋升 | from→to + 时间 |
| 行业分析/League Table | ranking / 排行 / top | banker + 项目计数 |
| 采访/专访 | told us / 受访 / 接受采访 | 完整背景 |
| 市场展望 | outlook / 展望 | banker 言论 + 头衔 |

文章长度策略：< 500 字直接提取；500-3000 字 1 次 prompt；> 3000 字分段（2000 字滑窗）合并。

## 二、归属判断（识别"该人是否真属于目标投行"）

### 2.1 强归属信号（high confidence）

```
"X is Y's [Title]"
"[Title] of Y, X"
"X, [Title] at Y"
"X 是 Y 的 [职位]"
"Y 的 [职位] X"
```

例子: `"Co-head of TMT at Goldman, David Hoyer"` → David Hoyer 是 GS 员工 ✅

### 2.2 弱归属信号（medium confidence）

- "from Y, X..." (可能在职也可能离职)
- "Y banker X" (通用归属)
- "X (Y)" (括号注公司)

### 2.3 排除陷阱

| 陷阱 | 例子 | 处理 |
|------|------|------|
| 客户高管 | "Tencent CEO Pony Ma..." | 排除 |
| 竞争对手 banker | "...while MS's John Smith..." | 单独标注 |
| 前员工 | "former Goldman banker..." | status="ex-employee" |
| 业内评论 | "analyst at JPM said..." | 排除（非 deal team） |
| 政府/学术 | "CSRC official", "professor at HKU" | 排除 |
| 同名歧义 | "David Chen" 多家都有 | disambiguation: needed |

## 三、LLM 提取 Prompt（标准）

```
你是金融媒体文章人物提取专家。从下面这篇文章中提取所有【在文中明确归属于目标投行的 banker 姓名】。

【目标投行】{target_firm}（别名：{aliases}）
【文章 URL】{article_url}
【发布日期】{publish_date}
【文章内容】{article_text}

【输出 JSON】
{
  "extracted_bankers": [
    {
      "name_en": "David Hoyer",
      "name_zh": "",
      "title_in_article": "Executive Director, TMT, Goldman Sachs HK",
      "department": "TMT / Healthcare / M&A / ECM / DCM",
      "deal_or_event": "MiniMax IPO advisor / 高盛 2024 MD 名单",
      "context_snippet": "...原文 1-2 句证明归属，<= 200 字...",
      "confidence": "very_high / high / medium / low",
      "is_current_employee": true,
      "attribution_strength": "explicit / implicit / weak"
    }
  ],
  "deals_mentioned": [
    {"deal_name": "MiniMax IPO", "issuer": "MiniMax", "year": "2025"}
  ],
  "person_movements": [
    {
      "name": "...",
      "name_zh": "...",
      "from_firm": "BAML",
      "to_firm": "Goldman Sachs",
      "date": "2024-06",
      "type": "join / leave / promotion",
      "new_title": "Co-Head of TMT"
    }
  ]
}

【精度规则】
1. 必须有原文 snippet 证明归属（不是客户/对手/家属）
2. 仅有姓没有名 → confidence: low
3. "据知情人士透露" 没具名 → 不提取
4. 离职/跳槽事件 → person_movements 字段
5. 同时提及多家投行 → 区分清楚每个人归属
6. 不要捏造姓名/职位
```

## 四、人事变动专项 Prompt（when by_event mode）

```
你是金融人事变动事件提取专家。本文是关于投行人事变动的报道。

【文章】{article_text}

【输出 JSON】
{
  "movements": [
    {
      "name_en": "David Hoyer",
      "name_zh": "",
      "event_type": "join / leave / promotion / co-head_change / restructuring",
      "from_firm": "BAML",
      "from_title": "VP, TMT",
      "to_firm": "Goldman Sachs",
      "to_title": "ED, TMT, HK",
      "effective_date": "2024-06",
      "reason": "战略调整 / 个人选择 / 公司挽留失败 ...",
      "source_quote": "...原文片段..."
    }
  ],
  "internal_promotions": [
    {
      "name": "Curtis Leung",
      "firm": "Goldman Sachs",
      "from_title": "ED",
      "to_title": "MD",
      "year": "2024",
      "context": "高盛 2024 MD 全球任命名单"
    }
  ]
}
```

## 五、中英文姓名映射

媒体常以多种形式出现，需自动归一化：

```
"Tai Wing Lap (戴永立) Andy Tai"  →  English: Andy Tai / Pinyin: Tai Wing Lap / Chinese: 戴永立
"梁睿熙 Jacky Leung"               →  Chinese: 梁睿熙 / English: Jacky Leung
"Dawei Huang 黄大为"               →  Pinyin: Dawei Huang / Chinese: 黄大为
```

**实现**：用 LLM 统一字段 `name_en`（英文/拼音）+ `name_zh`（中文名），不要分开。

## 六、多源去重规则

```python
def merge_bankers(all_extracted):
    # 主键：(name_en lower) + (firm normalized)
    seen = {}
    for b in all_extracted:
        key = (b["name_en"].lower(), normalize_firm(b["firm"]))
        if key in seen:
            existing = seen[key]
            # 合并 sources
            existing["mentions"].append({
                "url": b["source_url"],
                "date": b["article_date"],
                "snippet": b["context_snippet"]
            })
            # 升级 confidence
            n = len(existing["mentions"])
            if n >= 3: existing["confidence"] = "very_high"
            elif n == 2: existing["confidence"] = "high"
        else:
            seen[key] = {**b, "mentions": [{"url": b["source_url"], ...}]}
    return list(seen.values())
```

## 七、归属验证（防误识别）

挖出 banker 后，做最后一轮验证：

```python
def verify_attribution(banker, articles):
    """对每个 banker，检查是否真属于该投行"""
    target_firm = banker["firm"]
    snippets = [m["snippet"] for m in banker["mentions"]]

    # 至少 1 个 snippet 必须有强归属
    has_strong = any(
        is_strong_attribution(s, banker["name_en"], target_firm)
        for s in snippets
    )

    if not has_strong:
        banker["confidence"] = "low"
        banker["needs_review"] = True

    # 检查是否有"former" / "ex-" 修饰 → 可能离职
    if any("former" in s.lower() or "前" in s for s in snippets):
        banker["status"] = "possibly_ex_employee"
```

## 八、提取后的关键字段（写入 personnel）

```json
{
  "id": "person-david-hoyer",
  "name": "David Hoyer",
  "name_zh": "",
  "title": "ED, TMT, Goldman Sachs HK",
  "department_id": "group-industry",
  "team_id": "subteam-tmt-hk",
  "deal_history": [
    {"deal": "MiniMax IPO", "role": "Joint Bookrunner Lead", "year": "2025", "source": "deal-news"},
    {"deal": "阶跃星辰 IPO", "role": "Adviser", "year": "2024", "source": "deal-news"}
  ],
  "media_mentions": [
    {"date": "2024-06-15", "source": "Bloomberg", "url": "...", "snippet": "..."},
    {"date": "2024-08-22", "source": "Reuters", "url": "...", "snippet": "..."}
  ],
  "career_movements": [
    {"date": "2024-06", "from": "BAML VP", "to": "GS ED", "source": "Bloomberg"}
  ],
  "source": "deal-news-miner v1.0",
  "confidence": "high",
  "rainmaker_score": 7    // 被独立媒体 cue 总次数
}
```

## 九、错误处理

| 场景 | 处理 |
|------|------|
| 无明确归属 | 标 confidence=low，需要其他 Skill 验证 |
| 同名不同人（多个投行都有 David Chen） | 写入 open_questions |
| 仅姓不名 | confidence=low + needs_completion 标记 |
| 已离职 | 不删除，标 status=ex-employee + 升级"前同事"关系 |
| 文章没具体 deal/事件 | 不提取（不能空 mention） |

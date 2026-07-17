## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# Deal News Miner — 工作流编排详解

5 阶段工作流的精确工具调用方式 + LLM Prompt。

## Stage 1: 意图解析

```python
INTENT_PROMPT = """
分析用户请求，提取结构化字段：

【用户输入】{user_query}

【输出 JSON】
{
  "search_mode": "by_firm | by_deal | by_banker | by_industry | by_event",
  "target": "...",
  "target_aliases": {"en": [...], "zh": [...]},
  "time_range": {"start": "YYYY-MM", "end": "YYYY-MM"},
  "focus_market": "HK / US / China A / Global",
  "language_preference": "zh / en / both",
  "max_articles": 20
}

【示例】
输入："媒体挖高盛 TMT 团队的 banker 姓名"
输出：{
  "search_mode": "by_firm",
  "target": "Goldman Sachs TMT",
  "target_aliases": {"en": ["Goldman Sachs", "Goldman", "GS"], "zh": ["高盛", "高盛亚洲"]},
  "focus_market": "Global",
  "language_preference": "both",
  "max_articles": 25
}

输入："阶跃星辰的 deal team 是谁"
输出：{
  "search_mode": "by_deal",
  "target": "阶跃星辰",
  "target_aliases": {"en": ["StepFun"], "zh": ["阶跃星辰"]},
  "focus_market": "Global",
  "language_preference": "both"
}
"""
```

## Stage 2: 多源并行检索

### 2.1 调用 generate_queries（见 news-source-strategies.md）

```python
queries = generate_queries(intent)
# 通常返回 8-12 个查询变体
```

### 2.2 并行 web_search

```python
all_results = []
for q in queries[:10]:
    resp = web_search(query=q, max_results=10)
    for r in resp["results"]:
        all_results.append({
            "title": r["title"],
            "url": r["url"],
            "snippet": r["snippet"],
            "source_domain": extract_domain(r["url"]),
            "query_used": q
        })

# 去重（按 URL）
seen_urls = set()
deduped = []
for r in all_results:
    if r["url"] not in seen_urls:
        seen_urls.add(r["url"])
        deduped.append(r)
```

### 2.3 文章排序

按媒体权威度降序：

```python
SOURCE_PRIORITY = {
    "bloomberg.com": 10,
    "reuters.com": 10,
    "ifre.com": 10,
    "wsj.com": 9,
    "ft.com": 9,
    "efinancialcareers.com": 9,
    "efinancialcareers.hk": 9,
    "caixin.com": 8,
    "caixinglobal.com": 8,
    "36kr.com": 8,
    "latepost.com": 8,
    "ryanbencapital.com": 8,
    "21jingji.com": 7,
    "yicai.com": 7,
    "stcn.com": 7,
    "zhitongcaijing.com": 7,
    "gelonghui.com": 7,
    "newtimespace.com": 7,
    "sina.com.cn": 6,
    "qq.com": 5,
    "zhihu.com": 5,
    "zhuanlan.zhihu.com": 6
}

deduped.sort(key=lambda x: SOURCE_PRIORITY.get(x["source_domain"], 3), reverse=True)
```

## Stage 3: 文章解析与人名提取

### 3.1 抓全文

```python
extracted_data = []

for article in deduped[:max_articles]:
    # 优先用 snippet（如果信息已足够）
    if has_strong_signal(article["snippet"]):
        # snippet 已含人名归属，直接用
        result = llm_extract(STANDARD_PROMPT, article["snippet"], article)
    else:
        # 抓全文
        full = web_fetch(article["url"], fetchInfo="""
            提取该文章关于投行 banker 的所有内容。重点：
            1. 文中提到的所有 banker 姓名（中英文）
            2. 每个 banker 的明确归属投行
            3. 提到的具体 deal / 项目
            4. 人事变动事件（join / leave / promotion）
            5. 行业排行榜信息
            原文返回，不要摘要。
        """)
        result = llm_extract(STANDARD_PROMPT, full["data"], article)

    extracted_data.append(result)
```

### 3.2 人事变动专项

```python
if intent["search_mode"] == "by_event":
    for article in deduped[:max_articles]:
        full = web_fetch(article["url"], fetchInfo="提取人事变动事件")
        movement = llm_extract(MOVEMENT_PROMPT, full["data"], article)
        extracted_data.append(movement)
```

### 3.3 错误处理

| 错误 | 处理 |
|------|------|
| 文章 403/404 | 跳过 → 标 open_questions |
| LLM 提取空 | 重试 1 次，仍空则跳过 |
| 文章 > 5000 字 | 分段（每段 2500 字）+ 合并去重 |
| 中文文章但 LLM 出英文 | 切换 language="zh" 重新 prompt |

## Stage 4: 多源交叉验证 + 去重

### 4.1 按主键合并

```python
def merge_extracted(all_extracted):
    bankers = {}  # (name_lower, firm_id) → person record

    for ext in all_extracted:
        for b in ext["extracted_bankers"]:
            firm_id = normalize_firm_id(b["title_in_article"])
            key = (b["name_en"].lower().strip(), firm_id)

            if key in bankers:
                # 累积 mentions
                bankers[key]["mentions"].append({
                    "url": ext["article_url"],
                    "source": ext["source_domain"],
                    "date": ext["article_date"],
                    "snippet": b["context_snippet"]
                })
            else:
                bankers[key] = {
                    **b,
                    "firm_id": firm_id,
                    "mentions": [{
                        "url": ext["article_url"],
                        "source": ext["source_domain"],
                        "date": ext["article_date"],
                        "snippet": b["context_snippet"]
                    }]
                }

    # 计算 rainmaker_score
    for b in bankers.values():
        unique_sources = set(m["source"] for m in b["mentions"])
        b["rainmaker_score"] = len(unique_sources)

        # 升级 confidence
        if b["rainmaker_score"] >= 3:
            b["confidence"] = "very_high"
        elif b["rainmaker_score"] == 2:
            b["confidence"] = "high"
        else:
            b["confidence"] = b.get("confidence", "medium")

    return bankers
```

### 4.2 与已有 JSON 交叉验证

```python
def cross_check_existing(firm_id, new_bankers):
    path = f"iWiki 用户目录/01-公司组织库/{firm_id}.json"
    if not exists(path): return new_bankers

    existing_kb = json.load(open(path))
    existing_persons = existing_kb.get("personnel", [])

    for new_b in new_bankers:
        matched = None
        for existing_p in existing_persons:
            if name_match(new_b["name_en"], existing_p["name"]):
                matched = existing_p
                break

        if matched:
            # 合并：累积 media_mentions / career_movements / 升级 confidence
            new_b["status"] = "matched_with_existing"
            new_b["existing_id"] = matched["id"]

            # 升级 confidence（媒体 + 法定 = very_high）
            has_legal = matched.get("source", "").startswith(("hkex", "sec"))
            if has_legal and new_b["rainmaker_score"] >= 1:
                new_b["confidence"] = "very_high"
        else:
            new_b["status"] = "new_finding"

    return new_bankers
```

## Stage 5: 入库 + 渲染

### 5.1 写入对应 JSON

```python
def write_to_kb(firm_id, new_bankers, deals, movements):
    path = f"iWiki 用户目录/01-公司组织库/{firm_id}.json"
    kb = json.load(open(path)) if exists(path) else create_skeleton(firm_id)

    # 1. 合并 personnel
    for new_b in new_bankers:
        if new_b["status"] == "matched_with_existing":
            existing = next(p for p in kb["personnel"] if p["id"] == new_b["existing_id"])
            merge_news_into_existing(existing, new_b)
        else:
            # 创建新 person
            kb["personnel"].append({
                "id": f"person-{slugify(new_b['name_en'])}",
                "name": new_b["name_en"],
                "name_zh": new_b.get("name_zh"),
                "title": new_b["title_in_article"],
                "department_id": infer_dept(new_b["department"]),
                "media_mentions": new_b["mentions"],
                "rainmaker_score": new_b["rainmaker_score"],
                "source": "deal-news-miner v1.0",
                "confidence": new_b["confidence"],
                "added_at": now_iso()
            })

    # 2. 合并 deals（按 media 来源）
    for new_deal in deals:
        existing_deal = find_deal_by_name(kb, new_deal["name"])
        if existing_deal:
            # 合并 source 和 team_members
            existing_deal.setdefault("sources_combined", []).append({
                "type": "news",
                "url": new_deal["url"],
                "name": new_deal["source_name"]
            })
            existing_deal.setdefault("team_members", []).extend(new_deal["team_members"])
        else:
            kb["confirmed_deals_and_rankings"].append({
                **new_deal,
                "source": "deal-news-miner v1.0",
                "confidence": "medium-high"
            })

    # 3. 处理人事变动
    for mv in movements:
        # 找到对应 person，更新 career_movements
        person = find_person_by_name(kb, mv["name"])
        if person:
            person.setdefault("career_movements", []).append(mv)

            # 如果是离职 → 更新 status
            if mv["event_type"] == "leave" and mv["from_firm"] == kb["name"]:
                person["status"] = "departed"
                person["departed_to"] = mv["to_firm"]

    # 4. update_history
    kb["update_history"].append({
        "timestamp": now_iso(),
        "source": "deal-news-miner v1.0",
        "changes": (
            f"扫描 {n_articles} 篇媒体文章 → 新发现 banker {n_new} / 验证升级 {n_upgraded} / "
            f"识别人事变动 {n_movements} / rainmaker top: {top_3_rainmakers}"
        )
    })

    kb["updated_at"] = now_iso()
    json.dump(kb, open(path, "w"), ensure_ascii=False, indent=2)
```

### 5.2 输出报告

```markdown
## Deal News 挖掘结果

**目标**: {target} {time_range} ({mode} 模式)
**检索文章**: {n_articles} 篇（来自 {n_sources} 个独立来源）
**有效爆料**: {n_valid} 篇

**新增/更新人员**:
- 新发现 banker: {n_new} 位
- 验证已有人员: {n_verified} 位（升级 confidence）
- 人事变动: {n_movements} 起

**Rainmaker 排行**（被多媒体 cue 频次 Top 5）:
1. {name1}: {score1} 个独立来源
2. {name2}: {score2}
...

**新发现的 deal**:
- {deal1}: {firm} 担任 {role}，团队成员 {members}
- {deal2}: ...

**已生成/更新**:
- {firm_id}.json (新增 {n_new} 人员 + 更新 {n_updated} 人员 + 追加 {n_deals} deals)
- HTML 架构图已重生成

**Open Questions**:
- {n_failed} 篇文章无法访问
- {n_disambiguation} 个人名歧义待人工确认
```

## 性能预算

- 单次执行: 3-6 分钟（25 篇文章）
- web_search: 8-12 次
- web_fetch: 15-25 次
- LLM 解析: 20-40 次
- token 消耗: 80k-150k

## 错误降级总结

| 场景 | 降级路径 |
|------|---------|
| 全部国际媒体 403 | 改用中文媒体（caixin/36kr/latepost） |
| 全部中文媒体不可用 | 改用知乎专栏 + 微信公众号 |
| 单篇文章超长 | 分段抓 + 合并去重 |
| LLM 持续空响应 | 切换 prompt 模板（"严格模式" → "宽松模式"）|
| 整批失败 | 报告"挖掘失败"，提示用户换关键词 |

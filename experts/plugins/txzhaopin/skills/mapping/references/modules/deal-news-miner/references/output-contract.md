## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# Deal News → org-knowledge-base 数据契约

定义 deal-news-miner 输出 → `org-knowledge-base` 入库规则。**与 hkex-prospectus-miner / sec-filing-miner 共用同一套机构 JSON**。

## 一、机构维度（与已有 Skill 完全一致）

```
iWiki 用户目录/01-公司组织库/
├── gs-ibd.json        ← 三个 miner 共写（hkex + sec + news）
├── ms-ibd.json
├── citic-securities.json
├── linklaters.json
├── skadden.json
├── pwc.json
└── ...
```

## 二、扩展字段（新增）

### 2.1 `personnel[].media_mentions`（新增）

记录每位 banker 被媒体 cue 到的独立来源：

```json
{
  "id": "person-david-hoyer",
  "media_mentions": [
    {
      "date": "2024-06-15",
      "source_name": "Bloomberg",
      "source_url": "https://bloomberg.com/...",
      "context": "Goldman Sachs hires David Hoyer from BAML",
      "deal_or_event": "join_gs",
      "snippet": "...原文 1-2 句..."
    },
    {
      "date": "2024-08-22",
      "source_name": "Reuters",
      "source_url": "https://reuters.com/...",
      "context": "MiniMax IPO advisor team",
      "deal_or_event": "MiniMax IPO",
      "snippet": "..."
    }
  ]
}
```

### 2.2 `personnel[].career_movements`（新增）

人事变动追踪（媒体专属能力）：

```json
{
  "id": "person-david-hoyer",
  "career_movements": [
    {
      "date": "2024-06",
      "event_type": "join",
      "from_firm": "BAML",
      "from_title": "VP, TMT",
      "to_firm": "Goldman Sachs",
      "to_title": "ED, TMT, Hong Kong",
      "source": "Bloomberg 2024-06-15",
      "source_url": "..."
    },
    {
      "date": "2024-11",
      "event_type": "promotion",
      "firm": "Goldman Sachs",
      "from_title": "ED",
      "to_title": "MD",
      "source": "高盛 2024 MD 全球任命名单"
    }
  ]
}
```

### 2.3 `personnel[].rainmaker_score`（新增）

按媒体 cue 频次量化 banker 的"江湖地位"：

```json
{
  "id": "person-david-hoyer",
  "rainmaker_score": 7,  // 独立来源数量
  "rainmaker_breakdown": {
    "bloomberg": 2,
    "reuters": 1,
    "ifr": 2,
    "36kr": 1,
    "latepost": 1
  }
}
```

### 2.4 `confirmed_deals_and_rankings[].source` 标记

媒体来源的 deal 与法定来源**区分**：

```json
{
  "deal": "阶跃星辰 IPO",
  "ms_role": "Joint Bookrunner",
  "team_members": ["person-david-hoyer", "person-tiger-zhu"],
  "source": "deal-news-miner v1.0",
  "source_articles": [
    {"name": "Bloomberg", "url": "...", "date": "2024-08"},
    {"name": "晚点 LatePost", "url": "...", "date": "2024-09"}
  ],
  "confidence": "medium-high"  // 媒体单源 vs 法定的 very_high
}
```

## 三、confidence 升级矩阵（多源融合）

| 数据组合 | confidence |
|---------|-----------|
| 法定披露（hkex/sec） + 媒体（news） + LinkedIn | **very_high** ⭐⭐⭐⭐⭐ |
| 法定披露（hkex/sec） + 媒体（news） | very_high |
| 法定披露 only | very_high |
| 媒体（≥2 国际权威）+ LinkedIn | high |
| 媒体（≥2 国际权威） | high |
| 媒体（单一权威）+ LinkedIn | medium-high |
| 媒体单源（权威） | medium |
| 媒体单源（二线）| low |

## 四、人员合并规则（跨 Skill）

### 4.1 主键匹配

按以下顺序匹配：
1. `name_en` (lowercase) + `firm_id` 完全匹配 → 合并
2. `name_zh` 完全匹配 → 合并
3. 模糊匹配（编辑距离 < 2）→ 标 `disambiguation: needed`

### 4.2 合并字段

```python
def merge_news_into_existing(existing_p, news_p):
    # 1. 累积 media_mentions
    existing_p.setdefault("media_mentions", []).extend(news_p["media_mentions"])

    # 2. 累积 career_movements
    existing_p.setdefault("career_movements", []).extend(news_p["career_movements"])

    # 3. 更新 rainmaker_score
    existing_p["rainmaker_score"] = len(set(m["source_name"] for m in existing_p["media_mentions"]))

    # 4. 累积 deal_history
    for new_deal in news_p["deal_history"]:
        if new_deal not in existing_p.get("deal_history", []):
            existing_p.setdefault("deal_history", []).append(new_deal)

    # 5. 升级 confidence（按矩阵）
    existing_p["confidence"] = compute_confidence(
        has_legal=("hkex" in existing_p["sources"] or "sec" in existing_p["sources"]),
        has_news=True,
        has_linkedin=("linkedin" in existing_p["sources"]),
        media_source_count=existing_p["rainmaker_score"]
    )

    # 6. 处理人事变动事件
    for movement in news_p.get("career_movements", []):
        if movement["event_type"] == "leave" and movement["from_firm"] == existing_p["firm"]:
            existing_p["status"] = "departed"
            existing_p["departed_to"] = movement["to_firm"]
        elif movement["event_type"] == "join" and movement["to_firm"] == existing_p["firm"]:
            existing_p["join_date"] = movement["date"]
            existing_p["from_firm"] = movement["from_firm"]
```

## 五、deal 合并规则

### 5.1 deal 主键

`(deal_name_normalized, year)` 作为唯一标识。

### 5.2 多 source 合并

同一个 deal 在 hkex/sec/news 三个渠道都被识别 → 字段累积：

```json
{
  "deal": "MiniMax IPO",
  "year": "2025",
  "ms_role": "Joint Bookrunner",
  "team_members_from_legal": ["person-yyy"],
  "team_members_from_news": ["person-david-hoyer", "person-tiger-zhu"],
  "merged_team": ["person-yyy", "person-david-hoyer", "person-tiger-zhu"],
  "confidence_legal": "very_high",
  "confidence_news": "high",
  "sources_combined": [
    {"type": "hkex", "url": "...", "date": "..."},
    {"type": "news", "name": "Bloomberg", "url": "...", "date": "..."},
    {"type": "news", "name": "晚点", "url": "...", "date": "..."}
  ]
}
```

## 六、HTML 渲染要求

调用 `org-knowledge-base/scripts/generate-chart.md` 模板，**新增可视化元素**：

### 6.1 banker 节点显示 rainmaker 分

```
人员节点
├── 姓名 + 职级
├── ⭐⭐⭐⭐⭐ confidence (法定+媒体+LinkedIn)
├── 🔥7 rainmaker（被7个独立媒体源 cue 到）
└── 📰 hover 显示最近 3 条媒体提及
```

### 6.2 deal 节点显示融合信息

```
deal 节点
├── deal 名 + 年份
├── 📋 法定团队（hkex/sec）
└── 📰 媒体扩展团队（news 补充的人员）
```

## 七、错误降级

| 场景 | 处理 |
|------|------|
| 文章访问失败（403/404） | 跳过，记录到 open_questions |
| LLM 提取空 | 重试一次，仍空则跳过 |
| 同名歧义无法判断 | 全部入库，写 disambiguation 字段 |
| 媒体 snippet 太短 | 单独标 confidence=low |
| 跨语言名字不匹配 | 创建 alias mapping，等下一轮验证 |

## 八、与未来 Skill 的兼容性预留

### 8.1 与 alumni-network-miner 协调

未来 alumni-network-miner（校友/前同事反查）会基于：
- `career_movements` 字段 → 找出某人的"前同事链"
- `firm_id` 切换 → 反向定位"前 GS 的人现在在哪里"

### 8.2 与 mapping-universal 协调

总调度器在挖掘 senior 层 banker 时，**默认串联 hkex/sec/news 三个 Skill**：
1. hkex/sec 拿机构层 deal → 锁定"什么投行参与什么 deal"
2. news 拿个人姓名 → 补全"具体哪个 banker 主导"
3. linkedin 验证当前职位
4. 三源融合 → very_high confidence

# 媒体源检索策略库

本文档列出从中外财经媒体挖掘 banker 姓名的全部查询模板。

---

## 一、按搜索模式（mode）分类

### Mode 1: by_firm（挖某投行的 banker 团队）

#### 英文媒体

```
# Bloomberg / Reuters - 通用模式
"Goldman Sachs" "TMT" "managing director" Hong Kong site:bloomberg.com
"Goldman Sachs" "Co-Head" "Asia" 2024 site:reuters.com
"Morgan Stanley" "Lead Banker" Hong Kong IPO site:reuters.com
"JPMorgan" "Investment Banking" "head of" China 2024..2025 site:bloomberg.com

# IFR - 投行专业期刊（最高质量）
"Goldman Sachs" "Asia" "TMT" site:ifre.com
"Sponsor Principal" "Goldman Sachs" site:ifre.com

# eFinancialCareers - 投行人事新闻专业站
"Goldman Sachs" "Hong Kong" "promotion" 2024 site:efinancialcareers.com
"Managing Directors" "2024" site:efinancialcareers.hk
"Goldman Sachs" "joins" 2024 site:efinancialcareers.com
```

#### 中文媒体

```
# 36氪 + 晚点（一级市场必看）
"高盛" TMT 投行 site:36kr.com
"高盛" 投行 deal 2024..2025 site:latepost.com
"高盛" 投行家 site:latepost.com

# 财新 + 21世纪
"高盛" 香港 投行 MD site:caixin.com
"高盛" 中国 投行 site:caixinglobal.com
"高盛" 投行 高管 site:21jingji.com

# 港股 IPO 专业站（中资投行 + 港股）
"高盛" 保荐人 site:ryanbencapital.com
"高盛" IPO site:zhitongcaijing.com
"高盛" 香港 IPO site:gelonghui.com
"高盛" 投行 site:newtimespace.com

# 综合财经
"高盛" TMT 中国 site:sina.com.cn
"高盛" 投行家 site:qq.com

# 知乎（爆料密集）
"高盛" TMT 投行 site:zhuanlan.zhihu.com
"高盛 IBD" 加入 升任 site:zhihu.com
```

### Mode 2: by_deal（挖某 deal 的 banker team）

```
# 已知 deal 名 → 找媒体提到的 banker
"阶跃星辰" "高盛" 投行 deal team
"MiniMax" "Joint Global Coordinator" banker
"牧原股份" 港股 IPO 保荐 团队 site:21jingji.com

# 高额 deal 专项
"$1 billion IPO" "Goldman Sachs" "lead" 2024..2025
"百亿 IPO" 中国 投行 leading site:36kr.com

# 跨境并购
"cross-border M&A" "Goldman Sachs" "advisor" site:reuters.com
"跨境并购" 投行 高盛 site:caixin.com
```

### Mode 3: by_banker（验证某 banker 的项目履历）

```
# 已知姓名 → 找其参与的 deal
"David Hoyer" "Goldman Sachs" Hong Kong
"David Hoyer" deal IPO 2024..2025
"梁睿熙" "Jacky Leung" 高盛 IPO
"Curtis Leung" "Goldman Sachs" TMT deal

# 特别针对中国 banker 的中文搜索
"梁睿熙" 高盛 deal 项目 site:36kr.com
"梁睿熙" site:caixin.com
```

### Mode 4: by_industry / by_market（识别 rainmaker）

```
# 港股 IPO 排行榜
"香港 IPO 保荐人" 排行 2024..2025 site:ryanbencapital.com
"港股 IPO 中介" 排行 site:newtimespace.com
"Hong Kong IPO league table" 2024 site:reuters.com

# 美股中概股
"中概股 美股 IPO" 承销 排行 2024 site:36kr.com
"China IPO US" "Bookrunner" league table site:bloomberg.com

# 赛道 top deals
"AI" IPO 投行 2024..2025 site:latepost.com
"半导体" IPO 投行 site:36kr.com
"医疗" IPO 投行 香港 site:caixin.com

# Dealogic / Refinitiv 排行
"Dealogic" "Asia" "ECM" "league table" 2024
"APAC equity capital markets" ranking 2024
```

### Mode 5: by_event（人事变动事件）

```
# 跳槽 / 离职
"investment banking" "joins" "from" 2024 site:bloomberg.com
"departs" "Goldman Sachs" 2024..2025 site:reuters.com
"高盛" 离职 加入 投行 2024..2025 site:efinancialcareers.hk
"投行家" 跳槽 高盛 摩根 site:caixin.com

# 晋升 / 任命
"Goldman Sachs" "promoted" "MD" 2024
"高盛" 晋升 董事总经理 香港 2024..2025
"被任命为" 高盛 MD site:21jingji.com

# 全球 MD 晋升年度公告（每年 11 月）
"Goldman Sachs" "Managing Director" "promotion" "2024"
"高盛" "MD名单" 2024
"Goldman Sachs new partners" 2024 site:efinancialcareers.com
```

---

## 二、按媒体类型的访问技巧

### 2.1 国际付费墙媒体处理

**Bloomberg / WSJ / FT / IFR** 都有付费墙，访问技巧：

```
# 1. 直接 Google 搜索拿 snippet（免费）
site:bloomberg.com "Goldman Sachs" "David Hoyer"
→ 在 Google 结果里看 160 字符 snippet（足够提取人名）

# 2. Wayback Machine 缓存（免费）
http://web.archive.org/web/*/bloomberg.com/news/articles/...

# 3. archive.today 缓存（免费）
https://archive.is/{原文URL}

# 4. 中文转载站（免费）
中文媒体常常转载并完整翻译：site:sina.com 站点搜索
"WSJ" 转载 高盛 site:caixin.com
```

### 2.2 中文公众号文章

```
# 微信公众号文章在 Google 索引（部分）
site:mp.weixin.qq.com "高盛 投行" 2024
site:mp.weixin.qq.com "瑞恩资本" 高盛

# 第三方公众号聚合站
site:weibo.com OR site:zhihu.com "高盛投行" 2024
```

### 2.3 知乎专栏（金矿）

```
# 投行从业者爆料
site:zhuanlan.zhihu.com "高盛 IBD" "加入" OR "离职"
site:zhuanlan.zhihu.com "投行人" 高盛 经历

# "XX 公司面经"系列
site:zhuanlan.zhihu.com "高盛" "面经" 2024
```

---

## 三、查询变体生成器（伪代码）

```python
def generate_queries(intent):
    target_aliases = COMPANY_ALIASES[intent["target"]]
    year_filter = f'{intent["time_range"]["start"][:4]}..{intent["time_range"]["end"][:4]}'
    queries = []

    if intent["search_mode"] == "by_firm":
        # 国际媒体（英文）
        for alias_en in target_aliases["en"][:2]:
            queries.append(f'"{alias_en}" "managing director" {year_filter} site:bloomberg.com')
            queries.append(f'"{alias_en}" "Co-Head" Asia {year_filter} site:reuters.com')
            queries.append(f'"{alias_en}" {year_filter} site:ifre.com')
            queries.append(f'"{alias_en}" "promotion" "MD" site:efinancialcareers.com')

        # 中文媒体
        for alias_zh in target_aliases["zh"][:2]:
            queries.append(f'"{alias_zh}" 投行 site:36kr.com')
            queries.append(f'"{alias_zh}" 投行家 site:latepost.com')
            queries.append(f'"{alias_zh}" 香港 投行 MD site:caixin.com')
            queries.append(f'"{alias_zh}" IPO 保荐 site:ryanbencapital.com')

        # 知乎
        queries.append(f'"{target_aliases["zh"][0]}" IBD site:zhuanlan.zhihu.com')

    elif intent["search_mode"] == "by_deal":
        deal_name = intent["target"]
        queries.extend([
            f'"{deal_name}" 投行 deal team',
            f'"{deal_name}" "Joint Bookrunner" OR "Lead Bookrunner"',
            f'"{deal_name}" 保荐人 团队 site:21jingji.com',
            f'"{deal_name}" 投行 银行家 site:36kr.com',
            f'"{deal_name}" "advisor" "Goldman" OR "Morgan" site:reuters.com',
        ])

    elif intent["search_mode"] == "by_event":
        # 离职 / 跳槽
        queries.extend([
            f'"{target_aliases["en"][0]}" "joins" {year_filter} site:bloomberg.com',
            f'"{target_aliases["en"][0]}" "departs" OR "leaves" {year_filter} site:reuters.com',
            f'"{target_aliases["zh"][0]}" 离职 OR 跳槽 OR 加入 {year_filter} site:efinancialcareers.hk',
            f'"{target_aliases["zh"][0]}" 投行 离职 site:caixin.com',
        ])

    return queries[:12]
```

---

## 四、检索成本预算

| Mode | web_search 调用次数 | web_fetch 调用次数 | LLM 解析次数 | 总耗时 |
|------|--------------------|--------------------|-------------|------|
| by_firm | 8-12 | 10-20 | 10-20 | 3-6 分钟 |
| by_deal | 6-10 | 8-15 | 8-15 | 2-4 分钟 |
| by_banker | 4-6 | 5-10 | 5-10 | 1-2 分钟 |
| by_industry | 10-15 | 15-25 | 15-25 | 5-8 分钟 |
| by_event | 6-10 | 8-15 | 8-15 | 2-4 分钟 |

---

## 五、实战经验

### 5.1 中英文搜索的互补

**经验法则**：
- 外资投行的 banker 名字（English name）→ 优先英文媒体
- 中资投行 + 中国 banker 中文名 → 优先中文媒体
- **中国 banker 在外资投行任职** → **必须中英双搜**（如 Jacky Leung 梁睿熙）

### 5.2 deal 联想搜索

很多 banker 的姓名只在 specific deal 报道中露出。技巧：
1. 先用 `hkex-prospectus-miner` 拿到机构层 deal 列表
2. 对每个 deal 的关键 issuer 名字 → 媒体搜索 → 拿到该 deal 的 banker 姓名

### 5.3 League Table 是 rainmaker 矿

每年年初的 IPO 排行榜（瑞恩资本/新时空研究院/Dealogic）会按机构和 banker 双维度排名，**关键 rainmaker 直接被点名**。

### 5.4 招聘新闻是富矿

`eFinancialCareers` 每个季度有 "Top Hires" 类文章，密集列出 banker 跳槽：
```
"Goldman Sachs" "hires" 2024 site:efinancialcareers.com
"top movers" investment banking 2024 site:efinancialcareers.hk
```

### 5.5 发现"被遗漏的"知名 banker

很多大咖 banker 不在 LinkedIn 上活跃，但媒体常报道。验证流程：
```
1. 在 LinkedIn 没找到 → linkedin-deep-miner 标到 open_questions
2. 在 deal-news-miner 中按 by_event 搜 "joins" "departs" → 大概率能找到
```

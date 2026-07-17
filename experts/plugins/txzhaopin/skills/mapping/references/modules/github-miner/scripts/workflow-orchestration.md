## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# GitHub-Miner 工作流编排

> 5 阶段工具调用编排，含 LLM 提示词

---

## Stage 1: 意图解析

输入：用户自然语言（如"GitHub 挖腾讯开源团队"）

LLM Prompt：

```
你是 GitHub 招聘 Mapping 意图解析器。把用户输入解析为结构化查询参数：

【用户输入】
{user_query}

【输出 JSON】
{
  "search_mode": "by_org|by_repo|by_language|by_username|by_email|by_topic_expert",
  "target_company": "...（如适用）",
  "target_repo": "...（如适用）",
  "target_language": "...（如适用）",
  "target_username": "...（如适用）",
  "target_topic": "...（如适用，如 'LLM 推理优化'）",
  "geography_filter": "China|Beijing|Shanghai|Global",
  "tier_filter": "Tier 1+|Tier 2+|All",
  "max_candidates": 50
}
```

---

## Stage 2: GitHub 搜索

按 `search_mode` 派发到不同查询模板：

```python
# 伪代码
if mode == "by_org":
    web_fetch(f"https://github.com/orgs/{target_company}/people")
    web_search(f'site:github.com "@{target_company}" "Software Engineer"')
elif mode == "by_repo":
    web_fetch(f"https://github.com/{target_repo}/graphs/contributors")
elif mode == "by_language":
    web_fetch(f"https://github.com/search?q=language:{lang}+location:{geo}+followers:>500&type=Users")
elif mode == "by_username":
    web_fetch(f"https://github.com/{target_username}")
elif mode == "by_topic_expert":
    # 先搜领域核心 repo，再扫 contributors
    web_search(f'"{topic}" site:github.com "Top contributors"')
```

**并行原则**：每个 mode 同时跑 3-5 个查询变体（提升召回率）。

---

## Stage 3: Profile 验证

对每个候选 GitHub username，调用 `web_fetch`：

```
URL: https://github.com/{username}

Prompt for web_fetch:
"提取该 GitHub Profile 页面的：
- display_name（顶部 H1）
- Bio（顶部简介）
- Company 字段（含 @ 前缀判定）
- Location
- Email（如公开）
- Twitter / Personal Website
- Followers / Following / Public Repos 数字
- 注册时间（'Member since'）
- 最近 contribution 时间（contribution graph）
- Pinned Repos（含 stars 数）
- 公开 Org Memberships
- 主要使用语言（Languages 列）
返回结构化 JSON"
```

**反爬降级**：
- GitHub 偶尔会反爬，返回 HTML 含"Sign in"提示
- 此时切换到 Google snippet：`web_search(f'"{username}" site:github.com')`

---

## Stage 4: 影响力评分 + 跳槽轨迹

### 4.1 计算影响力分数

```python
import math

def score(profile):
    s_followers = math.log(profile["followers"] + 1) * 2
    s_stars = math.log(profile["stars_received_total"] + 1) * 3
    s_repos = math.log(profile["public_repos"] + 1)
    s_tenure = profile["tenure_years"] * 0.5
    return s_followers + s_stars + s_repos + s_tenure

def tier(score):
    if score > 35: return "Tier 1 (神级)"
    if score > 25: return "Tier 1 (顶级)"
    if score > 15: return "Tier 2 (资深)"
    if score > 8:  return "Tier 3 (一般)"
    return "Tier 4 (入门)"
```

### 4.2 跳槽轨迹分析（仅 Tier 2+ 触发）

通过 commit 邮箱演进推断：

```
fetch: https://github.com/search?q=author:{username}&type=commits
Prompt: "提取该用户最近 100 条 commits 的 author email 域名分布，按时间分组"
```

输出：
```json
{
  "career_path": [
    {"period": "2018-2020", "email_domain": "@gmail.com", "company": "in_school"},
    {"period": "2020-2022", "email_domain": "@bytedance.com", "company": "bytedance"},
    {"period": "2022-至今", "email_domain": "@anthropic.com", "company": "anthropic"}
  ]
}
```

---

## Stage 5: 入库 + 渲染

### 5.1 公司归一化

把所有 candidates 按 `company_normalized` 分组。

### 5.2 与已有 JSON 合并

```python
for company_id, candidates in groupby_company.items():
    json_path = f"iWiki 用户目录/01-公司组织库/{company_id}.json"
    if exists(json_path):
        existing = load_json(json_path)
    else:
        existing = empty_template(company_id)

    for c in candidates:
        # 去重：username + display_name 匹配
        existing_person = find_by_github_username(existing["personnel"], c["github_username"])
        if existing_person:
            # 合并 GitHub 数据到现有 record（保留其他来源）
            merge_github_data(existing_person, c)
        else:
            existing["personnel"].append(build_new_person(c))

    save_json(json_path, existing)
    render_html(json_path)
```

### 5.3 与 authorfilter 的 cross-match

```python
for c in candidates:
    # 在 authorfilter 已入库的人员中找匹配
    paper_match = find_in_authorfilter(c["display_name"], c["company_normalized"])
    if paper_match:
        c["paper_history"] = paper_match["paper_history"]
        c["confidence"] = "very_high"
        c["cross_skill_verified"] = True
        c["notes"] += f" / 与 authorfilter 论文 {len(paper_match['paper_history'])} 篇匹配"
```

---

## 6 大常见错误模式（实战中遇到的）

| 错误 | 原因 | 处理 |
|------|------|------|
| GitHub 反爬返回 "Sign in to continue" | 高频访问 | 切 Google snippet 模式 |
| Profile Company 字段过时（"Ex-Twitter" / 5 年没改） | 用户懒得更新 | 看最新 commit 邮箱判断 |
| 同名重复（"John Smith"）冲突 | 真名搜索 | 加 location/Org 双重过滤 |
| 中国用户隐藏 Activity（contribution 一片空白）| 隐私设置 | 用 commit 历史替代 |
| Bot 账号混入 | 自动化工具账号 | 过滤 username 含 `[bot]` / `dependabot` |
| Org Member 但人已离职 | 公司忘记 remove | 看 last commit time，> 6 个月标 stale |

---

## 报告输出格式

执行完毕后，给用户的报告：

```markdown
## GitHub 挖掘报告

**搜索模式**: by_org
**目标**: 腾讯 GitHub 开源团队
**扫描范围**: orgs/Tencent + orgs/TencentBlueKing + orgs/TencentARC + orgs/Hippy

**发现**:
- Tier 1 (顶级): 8 人
- Tier 2 (资深): 24 人
- Tier 3 (一般): 87 人
- 合计: 119 人

**已入库**:
- tencent.json 新增 119 人 → [架构图](file:///workspace/.../tencent.html)
- 其中 12 人与 authorfilter 已入库人员 cross-match 成功
- 3 人识别为已离职（commit 邮箱已切换到其他公司）

**Top 5 高影响力**:
1. xxx (Tier 1, score 38, vLLM 核心)
2. ...
```

---

## 总耗时估算

| 模式 | 平均耗时 |
|------|---------|
| by_org（中等公司 100-500 人）| 5-10 min |
| by_repo（Top 50 contributors）| 3-5 min |
| by_language（语言专家集合）| 8-12 min |
| by_username（单人深度验证）| 30 sec |
| by_email（commit 反查）| 1-2 min |

**调用预算**：单次挖掘消耗 web_fetch 10-30 次 + web_search 5-10 次。

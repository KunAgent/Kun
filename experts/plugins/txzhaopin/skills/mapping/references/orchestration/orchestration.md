# Mapping-Universal 总编排

> 6 阶段总流程的工具调用编排 + 容错策略

---

## 总流程

```
[用户输入]
    ↓
[Stage 1] 5 问问卷 / 自动 JD 解析 → intent 对象
    ↓
[Stage 2] 知识库查重（命中→直接返回 / 增量挖 / 全新挖）
    ↓
[Stage 3] 业务线分流 → Skill 调用清单 + 预算
    ↓
[Stage 4] 并行/串行调度底层 Skill
    ↓
[Stage 5] 数据归一化 + 多源合并
    ↓
[Stage 6] 5 段式 HTML 报告 + 沉淀知识库
```

---

## Stage 1: 意图解析

```python
def stage_1_parse(user_query):
    # 优先级 1：用户已经给了完整结构化输入
    if is_structured(user_query):
        return parse_structured(user_query)
    
    # 优先级 2：用户给了 JD 文本
    if is_jd_text(user_query):
        return llm_parse_jd(user_query)
    
    # 优先级 3：用户给了模糊指令 → 走 5 问问卷
    if is_ambiguous(user_query):
        return ask_5_questions()
    
    return llm_general_parse(user_query)
```

**5 问问卷格式**（一次性问完）：

```
为了精准 mapping，请回答以下 5 个问题（顺序回答即可）：

1. 目标公司？（如 GS HK / 腾讯 / 米哈游）
2. 目标部门/岗位？（如 IBD / 算法 / 美术）
3. 目标职级？（MD/VP/Director/Lead/Senior/IC）
4. 地域？（HK / 北京 / 上海 / 全球）
5. 优先级模式？
   A. 现状画像（5 min）
   B. 履历溯源（15 min）
   C. 能力深度（30 min）
   D. 全面 mapping（60 min）
```

详见 `references/intent-parsing.md`。

---

## Stage 2: 知识库查重

```python
def stage_2_kb_lookup(intent):
    company_id = intent["company_id"]
    if not company_id:
        return None
    
    json_path = f"iWiki 用户目录/01-公司组织库/{company_id}.json"
    if not os.path.exists(json_path):
        return None
    
    data = load_json(json_path)
    last_updated = parse_iso(data["updated_at"])
    days_ago = (now() - last_updated).days
    
    # 完全匹配 + 数据新鲜
    matches = filter_personnel(data, intent)
    
    if len(matches) >= 5 and days_ago < 30:
        return {"hit": "full", "data": matches, "html_url": f"charts/{company_id}.html"}
    elif len(matches) >= 2 and days_ago < 90:
        return {"hit": "partial", "data": matches, "need_refresh": True}
    else:
        return {"hit": "none"}
```

### 输出对应行为

| 命中等级 | 行为 |
|---------|------|
| `full` (≥5 人 + <30 天) | 直接返回 HTML 给用户，跳到 Stage 6 输出 |
| `partial` (2-4 人 + <90 天) | 增量挖掘，Stage 4 只挖缺的部分 |
| `none` | 走完整 6 阶段流程 |

---

## Stage 3: 业务线分流

```python
def stage_3_route(intent):
    industry = intent["industry"]
    priority_mode = intent["priority_mode"]
    
    if industry == "Finance":
        skills = ["linkedin", "hkex", "sec", "deal-news"]
    elif industry == "AI" or industry == "Tech":
        skills = ["github", "authorfilter", "linkedin", "deal-news"]
    elif industry == "Gaming":
        skills = ["artstation", "linkedin"]
    elif industry == "PM_Ops":
        skills = ["linkedin", "deal-news"]
    else:
        skills = ["linkedin"]  # 兜底
    
    # 按优先级模式裁剪
    if priority_mode == "A":
        skills = skills[:1]   # 仅 1 个
    elif priority_mode == "B":
        skills = skills[:2]   # 仅 2 个
    elif priority_mode == "C":
        skills = skills[:3]   # 3 个
    # D = 全开
    
    return skills
```

详见 `references/skill-routing.md`。

---

## Stage 4: Skill 调度

### 4.1 并行 + 串行混合

```python
def stage_4_execute(intent, skills_to_call):
    results = {}
    
    # 阶段 4.1：并行执行无依赖的 Skill
    parallel_skills = ["linkedin", "hkex", "sec", "authorfilter"]  # 互不依赖
    for skill in skills_to_call:
        if skill in parallel_skills:
            results[skill] = invoke_skill(skill, intent)
    
    # 阶段 4.2：串行执行依赖前序数据的 Skill
    if "github" in skills_to_call and "linkedin" in results:
        # 用 LinkedIn 拿到的姓名去验证 GitHub
        intent_with_names = add_names_from_linkedin(intent, results["linkedin"])
        results["github"] = invoke_skill("github", intent_with_names)
    
    if "deal-news" in skills_to_call:
        # 用之前所有 Skill 的人名去搜媒体爆料
        intent_with_all_names = combine_all_names(results)
        results["deal-news"] = invoke_skill("deal-news", intent_with_all_names)
    
    return results
```

### 4.2 失败容错

```python
def invoke_skill(skill_name, intent):
    try:
        return run_skill(skill_name, intent)
    except RateLimitError:
        return {"status": "rate_limited", "fallback": "skipped"}
    except CloudflareError:
        return {"status": "blocked", "fallback": "snippet_only"}
    except Exception as e:
        return {"status": "error", "error": str(e), "fallback": "skipped"}
```

任何 Skill 失败 → 不影响整体，记入 `open_questions`。

### 4.3 预算控制

```python
BUDGET_BY_MODE = {
    "A": {"max_skills": 1, "max_calls_per_skill": 6, "max_total_time": 5*60},
    "B": {"max_skills": 2, "max_calls_per_skill": 10, "max_total_time": 20*60},
    "C": {"max_skills": 3, "max_calls_per_skill": 15, "max_total_time": 30*60},
    "D": {"max_skills": 7, "max_calls_per_skill": 20, "max_total_time": 60*60},
}
```

超时 → 已完成的 Skill 数据照常入库；未完成的写入 `open_questions`。

---

## Stage 5: 数据归一化

### 5.1 收集所有 Skill 输出

```python
def stage_5_normalize(results):
    all_persons = []
    
    for skill_name, skill_result in results.items():
        for person in skill_result.get("personnel", []):
            person["_source_skill"] = skill_name
            all_persons.append(person)
    
    return all_persons
```

### 5.2 跨 Skill 去重 + 合并

```python
def merge_persons(all_persons):
    # 按 (normalized_name, company_id) 分组
    from collections import defaultdict
    grouped = defaultdict(list)
    for p in all_persons:
        key = (normalize_name(p["name"]), p.get("company_normalized"))
        grouped[key].append(p)
    
    merged = []
    for key, persons in grouped.items():
        if len(persons) == 1:
            merged.append(persons[0])
        else:
            # 多 Skill 共同发现 → 合并 + confidence 升级
            unified = merge_multi_source(persons)
            unified["cross_skill_verified"] = True
            unified["confidence"] = "very_high"
            merged.append(unified)
    
    return merged
```

### 5.3 字段冲突解决

详见 `references/skill-routing.md` 第 9 节。优先级：
```
法定披露 (HKEX/SEC) > Org Member (GitHub) > 媒体 (Deal News) > 论文 (Authorfilter) > LinkedIn snippet
```

---

## Stage 6: 5 段式 HTML 报告

### 6.1 段落 1：执行摘要

```markdown
# Mapping 报告：{Company} {Department}
**生成时间**: 2026-06-10 00:45
**调用 Skill**: linkedin / github / hkex / deal-news (4 个)
**总耗时**: 18 分钟
**累计候选人**: 47 人（其中 12 人 cross-skill verified）

**Top 3 Insights**:
1. 该团队近半年 3 名 MD 离职（来自 deal-news）
2. 团队 Lead 是 Raghav Maliah（来自 LinkedIn + 媒体多源验证）
3. 中坚力量集中在 5 年司龄的 ED 层
```

### 6.2 段落 2：组织架构图

复用 `org-knowledge-base` 的 HTML 模板：
- 树形结构（部门 → 团队 → 人员）
- 节点颜色按 confidence（深蓝 = very_high，浅蓝 = medium）

### 6.3 段落 3：关键人物名单

```markdown
| 姓名 | 职级 | 部门 | confidence | 联系建议 | 数据来源 |
|------|------|------|-----------|---------|---------|
| Raghav Maliah | Partner | TMT APAC | very_high | LinkedIn URL | linkedin + hkex + deal-news |
| Jacky Leung 梁睿熙 | MD | HK Coverage | very_high | LinkedIn | linkedin + 媒体 |
| ... | ... | ... | ... | ... | ... |
```

### 6.4 段落 4：置信度热力图

```markdown
**数据置信度分布**:
- ✅ very_high (cross-skill verified): 12 人 (26%)
- 🔵 high (单源法定披露): 18 人 (38%)
- 🟡 medium (LinkedIn snippet only): 17 人 (36%)
- ❓ open_questions: 5 个待跟进
  - Q1: TMT 中国区 Co-Head 是谁？
  - Q2: 黄大为 (前 MD) 离职后去哪了？
  - ...
```

### 6.5 段落 5：待办与下一步

```markdown
## 待办
- ✅ 知识库已更新：{json_path}（personnel 47 人 / deals 12 条）
- ✅ HTML 已生成：{html_url}
- ⏳ 建议手动验证：5 人（confidence = medium，需 follow-up）
- ⏰ 数据时效：30 天后建议重跑（用 mapping-universal "增量更新"）

## 下次自动加速
本次结果已沉淀。下次再问"GS HK TMT MD"，30 天内会直接命中知识库返回结果（5 秒内）。
```

---

## 容错与边界场景

### 错误场景 1：用户给的公司名识别失败

```
用户："挖一下 GS Asia"
解析 → company_id = "gs-ibd"（因为没单独的 GS Asia JSON）
处理 → 提示用户："GS Asia 数据合并到 gs-ibd.json，按地域 Asia 过滤后输出"
```

### 错误场景 2：知识库已有但需要刷新

```
用户："最新挖一下 GS HK TMT MD"
检测 → gs-ibd.json 数据 45 天前
处理 → 强制走 Stage 4，但只挖该部门子集（不重新挖全公司）
```

### 错误场景 3：底层 Skill 全失败

```
所有 Skill 都被反爬挡住
处理 → 输出"完全失败"报告，列出已尝试的查询，建议用户：
       1. 用代理重试
       2. 降级到 LinkedIn 公开 snippet
       3. 切换为人工 follow-up
```

---

## 总耗时预估

| 优先级模式 | 总耗时 | 调用预算 |
|-----------|--------|---------|
| A. 快速 | 5 min | 10 calls |
| B. 标准 | 15-20 min | 30 calls |
| C. 深度 | 30 min | 60 calls |
| D. 全面 | 45-60 min | 100+ calls |

---

## 与其他 Skill 的边界

| Skill | 责任 |
|-------|------|
| `mapping-universal`（本 Skill）| 总入口、调度、合并、报告 |
| 7 个底层挖掘 Skill | 各自垂直数据源的具体挖掘 |
| `org-knowledge-base` | 数据沉淀、查询、HTML 模板 |
| `wiki-compiler` | 用户主动喂候选人简历入库 |
| `wiki-reader` | 候选人查询（不挖，只查） |
| `wiki-evolver` | 对话中产生的碎片知识自动沉淀 |

不重叠，各司其职。

## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# LinkedIn Deep Miner 工作流编排详细规范

> 本文档是 SKILL.md 的执行细则。SKILL.md 给出框架（6 阶段），  
> 本文档给出每阶段的**具体工具调用方式、参数、提示词、输出格式**。  
> 这是让 LLM 真正"执行"而非"描述"的关键文件。

---

## 总体执行原则

### 工具调用方式约定

LinkedIn Deep Miner 在执行时按以下顺序调用工具：

| Stage | 工具 | 调用次数 | 是否并行 |
|-------|------|---------|---------|
| 1 | （纯 LLM 推理） | 0 | — |
| 2 | `getDocument` | 2-3 | 串行 |
| 3 | `web_search` | 5-10 | **必须并行** |
| 4 | （纯 LLM 解析） | 0 | — |
| 5 | `web_fetch` | 0-10 | **必须并行** |
| 6 | `getDocument` + `createDocument/saveDocument` + `preview_url` | 4-6 | 部分并行 |

### 用户交互原则

- **Stage 1 缺信息**：一次性问完所有缺失字段，不要分多轮
- **Stage 3 进度反馈**：搜索开始前告知用户"正在执行 N 个查询"
- **Stage 4 候选人摘要**：解析完成后立即输出 Top 候选人摘要
- **Stage 6 完成通知**：写入完成后自动打开 HTML

---

## Stage 1: 意图解析（Intent Parsing）

### 执行步骤

1. **接收用户输入**（自然语言）
2. **LLM 内部推理**（不调工具），按以下提示词模板提取信息：

```
你是 linkedin-deep-miner 的意图解析模块。
从用户输入中提取以下字段，构造 MiningTask JSON：

必填字段：
- target_company: 目标公司名（用户原始描述，未展开）
- target_levels: 职级数组
- location: 地域

可选字段：
- department: 部门
- industry: 行业（如能从公司名推断）

如某必填字段缺失，列出"待确认问题"，向用户简短确认。

用户输入：
{USER_INPUT}

输出 JSON：
{
  "task": {...},
  "questions_for_user": [...]  // 如有，否则为空
}
```

3. **如有 questions_for_user**：
   - 一次性向用户提问（不要分多轮）
   - 等用户回复后合并到 task 对象
   - 没有缺失字段就直接进入 Stage 2

### 输出（MiningTask 对象）

```json
{
  "target_company": "Goldman Sachs",
  "department": "TMT",
  "target_levels": ["MD", "ED"],
  "location": "Hong Kong",
  "industry": "Investment Bank",
  "_raw_user_input": "挖一下 GS 香港 TMT 的 MD 和 ED"
}
```

---

## Stage 2: 查询展开（Query Expansion）

### 执行步骤

#### Step 2.1：加载映射文件
```
getDocument({SKILL_DIR}/references/company-aliases.md)
getDocument({SKILL_DIR}/references/dorking-templates.md)
```

#### Step 2.2：展开公司变体
LLM 根据 company-aliases.md 中的内容，展开公司名：
```
"Goldman Sachs" 展开为：
- "Goldman Sachs"（主名）
- "Goldman"（简称）
- "高盛"（中文）
- "GS"（缩写，谨慎使用）
```

#### Step 2.3：展开职级变体
基于 org-knowledge-base 的 `references/title-mapping.md`：
```
"MD" 展开为：["Managing Director", "MD", "董事总经理"]
"ED" 展开为：["Executive Director", "ED", "执行董事"]
```

#### Step 2.4：展开地域变体
```
"Hong Kong" → ["Hong Kong", "HK", "香港"]
"北京" → ["Beijing", "北京"]
```

#### Step 2.5：组合生成查询数组
按以下优先级组合（Top 10 上限）：

```
策略 A 必出（4 条）：
1. site:linkedin.com/in "Goldman Sachs" "TMT" "Managing Director" "Hong Kong"
2. site:linkedin.com/in "Goldman Sachs" "TMT" "Executive Director" "Hong Kong"
3. site:linkedin.com/in "Goldman Sachs" "Technology" "MD" "HK"
4. site:linkedin.com/in "高盛" "TMT" "董事总经理" "香港"

策略 B 投行场景（2 条）：
5. site:linkedin.com/in "Goldman Sachs" "advised" "IPO" "Hong Kong"
6. site:linkedin.com/in "Goldman Sachs" "joint global coordinator" "Hong Kong"

策略 C 校友（2 条，金融常见）：
7. site:linkedin.com/in "Goldman Sachs" "Hong Kong" "LSE"
8. site:linkedin.com/in "Goldman Sachs" "Hong Kong" "HKU"

总计：8 条 query
```

### 输出（queries 数组）
```json
[
  {"id": "Q1", "query": "...", "strategy": "A"},
  {"id": "Q2", "query": "...", "strategy": "A"},
  ...
]
```

---

## Stage 3: 并行搜索（Parallel Search）

### 关键约束
**所有 web_search 调用必须在同一轮 tool_use 块内并行发起**，不能串行（否则太慢）。

### 执行模板

在一个 assistant turn 内同时发起所有调用：

```
<function_calls>
  <invoke name="web_search">
    <parameter name="query">site:linkedin.com/in "Goldman Sachs" "TMT" "Managing Director" "Hong Kong"</parameter>
    <parameter name="max_results">10</parameter>
  </invoke>
  <invoke name="web_search">
    <parameter name="query">site:linkedin.com/in "Goldman Sachs" "TMT" "Executive Director" "Hong Kong"</parameter>
    <parameter name="max_results">10</parameter>
  </invoke>
  ... (其余 6-8 个 query)
</function_calls>
```

### 用户进度反馈（在并行调用之前）

```
🔍 LinkedIn 挖掘任务启动
- 目标：Goldman Sachs / TMT / Hong Kong / MD+ED
- 查询变体：8 个
- 预估时间：1-2 分钟
- 正在并行搜索...
```

### 错误处理

| 场景 | 处理 |
|------|------|
| 单个 query 0 结果 | 标记，但继续处理其他 |
| 全部 query 0 结果 | 兜底：去掉地域约束重试 |
| 工具调用失败 | 报告错误，重试一次 |
| 超过 10 分钟未完成 | 终止，报告部分结果 |

---

## Stage 4: 候选人提取与去重

### 执行步骤（纯 LLM 处理）

#### Step 4.1：从搜索结果解析

对每条搜索结果，提取以下信息：

**LinkedIn 标题格式分析**：
```
"David Hoyer - Executive Director - Goldman Sachs | LinkedIn"
        ↑              ↑                    ↑
       name          title              company

"David Hoyer | LinkedIn" （较短格式，需要从 URL/snippet 推断职位）

"Hoyer, David - Goldman Sachs" （某些区域格式）
```

**URL 解析**：
```
https://www.linkedin.com/in/david-hoyer-12345?... 
                            ↑
                       linkedin_slug
```

**Snippet 关键信息提取**：
- 当前职位：通常在标题或 snippet 开头
- 工作经历：snippet 中的 "...prior to..." / "Previously..." / "ex-..."
- 教育：snippet 中的学校名称（用 company-aliases.md 中的学校列表过滤）
- 地域：snippet 中的城市/国家
- 时间标记："Present", "current", 年份等

#### Step 4.2：提取提示词模板

```
你正在从 web_search 返回的结果中提取 LinkedIn 候选人信息。
按以下规则解析每条结果：

输入（一条搜索结果）：
{
  "title": "David Hoyer - Executive Director - Goldman Sachs | LinkedIn",
  "url": "https://www.linkedin.com/in/david-hoyer-12345",
  "snippet": "...LSE graduate, joined GS HK in 2018, prior to that at Citi..."
}

输出（LinkedIn Candidate 对象）：
{
  "linkedin_slug": "david-hoyer-12345",
  "name": "David Hoyer",
  "current_title": "Executive Director",
  "title_abbr": "ED",
  "current_company": "Goldman Sachs",
  "department": null,  // snippet 中未明确，留空
  "location": null,
  "education_hint": "LSE",
  "previous_company_hint": "Citi",
  ...
}

提取规则：
1. URL 中能解析 slug → 必填
2. 标题不符合 "{Name} - {Title} - {Company}" 格式 → 用 LLM 推断
3. snippet 包含明确公司名 + 职位 → 高置信
4. snippet 仅有名字、其他信息模糊 → 低置信
```

#### Step 4.3：去重合并

去重 key 优先级：
1. `linkedin_slug`（最可靠）
2. `name + current_company`（slug 缺失时）
3. `name + email_hash`（极少情况）

合并规则（同一人多次出现）：
- 字段非空冲突：保留 confidence 更高那条的字段
- 字段一空一非空：保留非空
- snippet：拼接（用 ` | ` 分隔）
- source_query：合并（数组）

#### Step 4.4：置信度评分

```python
def calc_confidence(candidate):
    score = 0.0
    if candidate.linkedin_slug and candidate.linkedin_slug.startswith("linkedin.com/in/"):
        score += 0.3
    if candidate.current_company == target.company and candidate.current_title in target.levels:
        score += 0.2
    if candidate.location matches target.location:
        score += 0.2
    if candidate.education_hint:
        score += 0.1
    if candidate.previous_company_hint:
        score += 0.1
    if len(candidate.source_query) > 1:  # 多个 query 命中同一人
        score += 0.1
    return min(score, 1.0)
```

### 输出（candidates 数组）

按置信度降序，并标记分级：
```json
{
  "high_confidence": [/* >= 0.85 */],
  "medium_confidence": [/* 0.6 ~ 0.85 */],
  "low_confidence": [/* 0.4 ~ 0.6 */],
  "rejected": [/* < 0.4 */]
}
```

---

## Stage 5: 深度验证（可选）

### 触发条件
- 候选人总数 ≤ 10 时执行
- 候选人总数 > 10 时跳过（避免成本爆炸），仅对 Top 5 执行

### 执行步骤

#### Step 5.1：构造验证 URL 列表

对每个 high_confidence 候选人构造 URL：
```
linkedin_url = "https://www.linkedin.com/in/" + linkedin_slug
google_cache = "https://webcache.googleusercontent.com/search?q=cache:linkedin.com/in/" + linkedin_slug
```

#### Step 5.2：并行 web_fetch（首次尝试）

```
<function_calls>
  <invoke name="web_fetch">
    <parameter name="url">https://www.linkedin.com/in/david-hoyer-12345</parameter>
    <parameter name="fetchInfo">提取该候选人的完整工作经历、教育背景、当前职位、汇报关系信息（如 "Reports to ..."、"Working with ..."）</parameter>
  </invoke>
  ... (其他 high_confidence 候选人)
</function_calls>
```

#### Step 5.3：失败降级

如某 web_fetch 返回失败/反爬页面：
```
<function_calls>
  <invoke name="web_fetch">
    <parameter name="url">https://webcache.googleusercontent.com/search?q=cache:linkedin.com/in/david-hoyer-12345</parameter>
    <parameter name="fetchInfo">...</parameter>
  </invoke>
</function_calls>
```

如 Google 缓存也失败：
```
<function_calls>
  <invoke name="web_fetch">
    <parameter name="url">https://web.archive.org/web/*/linkedin.com/in/david-hoyer-12345</parameter>
    <parameter name="fetchInfo">...</parameter>
  </invoke>
</function_calls>
```

#### Step 5.4：合并验证信息

将 fetch 到的信息回填到 candidate 对象：
- `verified = true`
- `verified_via = "linkedin" | "google_cache" | "wayback"`
- 完整 work_history、education、报告关系等

如三层都失败：
- `verified = false`
- 保留候选人但标"未验证"

---

## Stage 6: 入库 + 渲染

### 执行步骤

#### Step 6.1：加载现有数据

```
getDocument({SKILL_DIR}/references/output-contract.md)  # 字段映射规则
getDocument(用户-{user_key}/00-索引)  # 检查公司是否已存在
```

#### Step 6.2：判断公司状态

```
if company_id in 00-索引:
    getDocument(iWiki 用户目录/01-公司组织库/{company_id}.json)
    mode = "increment"
else:
    mode = "create"
```

#### Step 6.3：字段映射 + 合并

按 `output-contract.md` 的映射规则，将每个 LinkedIn Candidate 转换为 personnel 对象。

**关键合并逻辑**：
```python
for candidate in candidates:
    existing_person = find_by_name(existing_personnel, candidate.name)
    if existing_person:
        if existing_person.source != "LinkedIn 自动挖掘":
            # 保护人工录入
            merge_only_empty_fields(existing_person, candidate)
        else:
            # 更新 LinkedIn 数据
            update_with_conflict_log(existing_person, candidate)
    else:
        # 新增
        new_person = map_candidate_to_personnel(candidate)
        existing_personnel.append(new_person)
```

#### Step 6.4：处理低置信候选人

```python
for candidate in low_confidence_candidates:
    company_json["candidates_pending"].append({
        "name": candidate.name,
        "linkedin_slug": candidate.linkedin_slug,
        "current_title": candidate.current_title,
        "confidence": candidate.confidence,
        "reason": "snippet 信息不完整",
        "discovered_at": now()
    })
```

#### Step 6.5：写入文件

```
createDocument/saveDocument(iWiki 用户目录/01-公司组织库/{company_id}.json, updated_company_json)
createDocument/saveDocument(用户-{user_key}/00-索引, updated_index_json)
```

#### Step 6.6：生成 HTML 架构图

读取当前 Skill 内置的 org-knowledge-base 模板：
```
references/modules/org-knowledge-base/scripts/generate-chart.md
# 或使用 templates/mapping-report.html.tpl / templates/mapping-report-dark.html.tpl 作为报告模板
```

按模板生成 HTML，写入：
```
createDocument/saveDocument(iWiki 用户目录/01-公司组织库/{company_id} 的组织架构章节或附件, html_content)
```

#### Step 6.7：自动打开 HTML

```
preview_url(file:///iWiki 用户目录/01-公司组织库/{company_id} 的组织架构章节或附件)
```

---

## 完整执行示例（端到端）

### 用户输入
```
LinkedIn 挖一下 GS 香港 TMT 的 MD 和 ED
```

### Stage 1（无工具调用）
→ 解析为 MiningTask：
```json
{"target_company": "Goldman Sachs", "department": "TMT", "target_levels": ["MD", "ED"], "location": "Hong Kong"}
```

### Stage 2（getDocument × 2）
→ 加载 company-aliases.md + dorking-templates.md  
→ 生成 8 条 query

### Stage 3（web_search × 8 并行）
→ 返回原始搜索结果（共 60+ snippets）

### Stage 4（无工具调用）
→ 解析提取，去重合并：
- High confidence: 5 人（David Hoyer ED, ...）
- Medium: 3 人
- Low: 4 人

### Stage 5（web_fetch × 5 并行）
→ 验证 Top 5 候选人
- 4 人通过 Google 缓存验证成功
- 1 人三层降级都失败

### Stage 6（getDocument + createDocument/saveDocument × 多次）
→ 入库 + 生成 HTML + 自动打开

### 输出给用户

```markdown
## LinkedIn 挖掘报告 — Goldman Sachs / TMT / HK / MD+ED

**执行概况**
- 查询变体：8 个
- Raw 命中：63 条
- 候选人：12 人（去重后）
  - High: 5 | Medium: 3 | Low: 4
- 已验证：4 人

**Top 候选人**
| # | 姓名 | 职位 | 部门 | 置信度 | 备注 |
|---|---|---|---|---|---|
| 1 | David Hoyer | ED | TMT | 0.92 | LSE · 前 Citi · 已验证 |
| 2 | ... | MD | TMT | 0.88 | ... |
| ... |

**入库结果**
- ✅ 新增 5 人到 goldman-sachs.json
- ✅ 更新 2 人（与人工录入合并）
- ⚠️ 4 人放入 candidates_pending（待人工确认）

**架构图**：file:///path/to/goldman-sachs.html （已自动打开）
```

---

## 性能优化建议

1. **Stage 3 并行度**：不超过 10 个 web_search 同时发起
2. **Stage 5 并行度**：不超过 5 个 web_fetch 同时发起
3. **Token 预算**：单次执行预留 30k tokens 用于 Stage 4 解析
4. **缓存利用**：同一公司 24 小时内不重复跑 Stage 3，直接读上次结果

## 调试模式

如需排查问题，在 Stage 末尾输出 debug 信息：
```
[DEBUG]
- Stage 1 elapsed: 1s
- Stage 2 elapsed: 2s
- Stage 3 elapsed: 45s | queries: 8 | hits: 63
- Stage 4 elapsed: 5s | candidates: 12
- Stage 5 elapsed: 30s | verified: 4 / 5
- Stage 6 elapsed: 3s | files written: 3
- Total tokens: ~25k
```

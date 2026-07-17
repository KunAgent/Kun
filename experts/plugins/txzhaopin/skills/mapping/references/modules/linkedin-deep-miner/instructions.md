---
name: linkedin-deep-miner
description: |
  LinkedIn 深度挖掘 Skill（金融行业优先）。基于 Google/Bing Dorking 公开搜索方式，
  采用多查询变体 + 职级分层 + 校友网络 + 时间过滤 + 多源交叉的 6 阶段工作流，
  从 LinkedIn 公开 profile 中挖掘指定公司/部门/职级/地域的人才候选人。
  挖掘结果自动入库到 org-knowledge-base 知识库，并生成 HTML 组织架构图。
  
  触发场景：
  - 用户说"挖 XX 公司的 XX 团队"、"找 XX 行业的 MD/ED"
  - 用户说"LinkedIn 搜 XX"、"linkedin-deep-miner"、"linkedin 挖人"
  - 用户给出明确的目标公司 + 部门 + 职级组合
  
  不触发：
  - 用户提供完整人选信息要求录入（→ org-knowledge-base）
  - 用户查询已沉淀的公司架构（→ org-knowledge-base）
  - 简历评估、JD 撰写等其他场景

  触发短语："LinkedIn 挖"、"挖 XX 团队"、"linkedin 搜"、"linkedin-deep-miner"、
  "找 XX 公司的人"、"扒 LinkedIn"、"Google dorking"
description_zh: "LinkedIn 深度挖掘 — 基于公开数据的多策略人才搜索"
description_en: "LinkedIn Deep Miner — Multi-strategy talent search via public data"
version: "1.0.0"
---

## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# LinkedIn Deep Miner Skill

## 身份定义

你是一个专业的 LinkedIn 人才挖掘助手，专注金融行业（投行/PE/VC/对冲基金）。
你的核心能力是：通过 Google/Bing 公开搜索（不需要登录 LinkedIn），用多策略组合
搜索方法，从公开 profile 中挖掘指定目标的候选人，并将结果自动入库到组织架构知识库。

## 合规边界（必须遵守）

✅ **允许**：
- 使用 web_search 工具搜索 Google/Bing（公开搜索引擎）
- 使用 web_fetch 拉取已被搜索引擎索引的公开页面
- 解析 LinkedIn 公开 profile 的 snippet 和缓存内容

❌ **禁止**：
- 模拟登录 LinkedIn 账号
- 绕过任何反爬机制
- 抓取需要登录才能查看的内容
- 存储/分发未公开的个人信息

## 触发条件

### 自动触发
当用户输入同时满足以下条件时激活：
- 包含明确的"目标公司名"（高盛/GS/Goldman Sachs，摩根士丹利/MS 等）
- 包含明确的"部门"或"职级"（TMT/IBD，MD/ED/VP 等）
- 包含明确的"挖人意图"动词（挖、搜、找、扒、Map）

### 关键词触发
- "LinkedIn 挖 XX"、"挖 XX 团队"、"linkedin 搜"
- "linkedin-deep-miner"、"扒 LinkedIn"、"Google dorking"
- "找 XX 公司的 MD/ED/VP"

## 核心工作流（6 阶段）

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Stage 1: 意图解析（Intent Parsing）
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**输入**：用户的自然语言查询  
**输出**：结构化挖掘任务对象 `MiningTask`

**步骤**：
1. 从用户输入中提取以下字段：
   ```json
   {
     "target_company": "Goldman Sachs",
     "company_aliases": ["GS", "高盛", "Goldman"],
     "department": "TMT",
     "department_keywords": ["Tech", "Technology", "TMT", "Tech, Media & Telecom"],
     "target_levels": ["MD", "ED"],
     "level_keywords": {
       "MD": ["Managing Director", "MD", "董事总经理"],
       "ED": ["Executive Director", "ED", "执行董事"]
     },
     "location": "Hong Kong",
     "location_keywords": ["Hong Kong", "HK", "香港"],
     "industry": "Investment Bank"
   }
   ```

2. **如有缺失字段，向用户简短确认**（一次性问完所有缺失项）：
   - 公司不明确 → "请确认目标公司是 GS 还是高华证券（高盛中国合资）？"
   - 职级不明确 → "目标层级：MD/ED/VP/Asso/AN？"
   - 地域不明确 → "区域：HK/北京/上海/全球？"

3. **加载公司别名映射**：
   - 调用 `getDocument` 读取 `references/company-aliases.md`
   - 自动展开公司名变体（"GS" → 同时匹配 "Goldman Sachs", "Goldman", "高盛"）

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Stage 2: 查询展开（Query Expansion）
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**输入**：MiningTask 对象  
**输出**：查询数组 `queries[]`（5-10 个 dorking 变体）

**步骤**：
1. 调用 `getDocument` 加载 `references/dorking-templates.md` 获取查询模板
2. 按以下策略生成查询变体：

**策略 A：基础职级矩阵（必出）**
```
对每个 (公司变体 × 部门变体 × 职级变体 × 地域变体) 组合生成查询：
site:linkedin.com/in "{company}" "{dept}" "{level}" "{location}"

示例（GS HK TMT MD）：
- site:linkedin.com/in "Goldman Sachs" "TMT" "Managing Director" "Hong Kong"
- site:linkedin.com/in "Goldman Sachs" "Technology" "MD" "HK"
- site:linkedin.com/in "高盛" "TMT" "董事总经理" "香港"
```

**策略 B：项目反查（投行场景必出）**
```
site:linkedin.com/in "{company}" "advised" "{deal_keyword}"
site:linkedin.com/in "{company}" "lead manager" "{location}"

示例：
- site:linkedin.com/in "Goldman Sachs" "advised on" "IPO" "Hong Kong"
- site:linkedin.com/in "Goldman Sachs" "joint global coordinator"
```

**策略 C：校友交叉（解决水下人选）**
```
site:linkedin.com/in "{company}" "{location}" "{top_school}"

示例：
- site:linkedin.com/in "Goldman Sachs" "Hong Kong" "LSE"
- site:linkedin.com/in "Goldman Sachs" "Hong Kong" "HKU"
```

**策略 D：时间过滤（验证在职）**
对 Top 3 候选人查询追加 Google 时间参数（近 6 个月）以验证活跃度

3. **去重 + 优先级排序**，输出最多 10 条查询（控制 token 消耗）

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Stage 3: 并行搜索（Parallel Search）
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**输入**：queries 数组  
**输出**：原始搜索结果 `raw_results[]`

**步骤**：
1. **并行调用 web_search 工具**（在同一轮 tool_use 里同时发起多个调用）：
   ```
   for each query in queries:
     web_search(query=query, max_results=10)
   ```

2. **每个 query 配置**：
   - max_results: 10（确保覆盖足够候选人）
   - language: 根据公司地域决定（HK/SG → en-US；中国 → zh-CN）

3. **错误处理**：
   - 单个 query 失败 → 记录失败原因，继续其他 query
   - 全部失败 → 报告错误并提示用户检查网络/调整关键词
   - 返回结果为空 → 触发查询变体兜底（用更宽松的 query 重试）

4. **聚合返回**：
   ```json
   {
     "total_queries": 8,
     "total_raw_hits": 73,
     "results_by_query": [
       {"query": "...", "hits": [...]}
     ]
   }
   ```

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Stage 4: 候选人提取与去重（Candidate Extraction）
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**输入**：raw_results 原始 snippet  
**输出**：候选人列表 `candidates[]`（含置信度评分）

**步骤**：
1. **从 snippet 解析结构化信息**：
   - 标题：通常格式 "{Name} - {Title} - {Company} | LinkedIn"
   - URL：linkedin.com/in/{slug}（slug 是唯一标识）
   - 描述：包含工作经历片段、教育背景、地区

2. **提取字段**（每个候选人）：
   ```json
   {
     "linkedin_slug": "david-hoyer-12345",
     "name": "David Hoyer",
     "current_title": "Executive Director",
     "title_abbr": "ED",
     "current_company": "Goldman Sachs",
     "department": "TMT",
     "location": "Hong Kong",
     "education_hint": "LSE",
     "previous_company_hint": "Citi",
     "snippet_source": "{原始 snippet}",
     "source_query": "{命中的 dorking query}",
     "confidence": 0.85
   }
   ```

3. **去重逻辑**：
   - 主键：`linkedin_slug`（最可靠）
   - 副键：`name + current_company`（slug 缺失时使用）
   - 同一人多次出现 → 合并 snippet（信息更全）

4. **置信度评分**（0~1）：
   - +0.3：URL 是 linkedin.com/in/* 标准格式
   - +0.2：snippet 明确包含目标公司+目标职级
   - +0.2：地域信息匹配
   - +0.1：教育背景提及
   - +0.1：跳槽轨迹清晰
   - +0.1：被多个 query 同时命中

5. **过滤**：
   - confidence < 0.4 → 标记为"低质量"但不丢弃
   - 仅当 snippet 完全无效信息时丢弃

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Stage 5: 深度验证（Deep Verification）— 可选阶段
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**触发条件**：候选人数 ≤ 10 时执行深度验证；> 10 时跳过（避免 token 爆炸）

**步骤**：
1. **对置信度 ≥ 0.6 的 Top N 候选人**调用 `web_fetch`：
   ```
   web_fetch(
     url="https://www.linkedin.com/in/{slug}",
     fetchInfo="提取该候选人的完整工作经历、教育背景、当前职位、汇报关系信息"
   )
   ```

2. **如 LinkedIn 直接抓取失败**（被反爬），降级到 Google 缓存：
   ```
   web_fetch(
     url="https://webcache.googleusercontent.com/search?q=cache:linkedin.com/in/{slug}",
     fetchInfo="..."
   )
   ```

3. **再次降级到 Bing 缓存或归档站**：
   ```
   web_fetch(url="https://cc.bingj.com/cache.aspx?q=...")
   web_fetch(url="https://web.archive.org/web/*/linkedin.com/in/{slug}")
   ```

4. **将抓取到的额外信息合并到候选人对象**：
   - 完整工作经历列表
   - 完整教育经历
   - 在职时间（用于验证 Active 状态）
   - 推断的汇报关系（"Reports to ...", "Working with ...", "Led by ..."）

5. **错误处理**：
   - 三层降级都失败 → 标注 `verified: false`，仍保留候选人

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Stage 6: 入库 + 渲染（Persist & Render）
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**输入**：经过验证的候选人列表  
**输出**：更新后的 JSON 知识库 + 重新生成的 HTML 架构图

**步骤**：
1. **加载数据契约**：
   - 调用 `getDocument` 读取 `references/output-contract.md`
   - 按契约将 LinkedIn 候选人字段映射到 org-knowledge-base 的 `personnel` schema

2. **检查目标公司是否已存在**：
   - 调用 `getDocument` 读取 `用户-{user_key}/00-索引`
   - 如存在 → 加载对应 `{company_id}.json` 进入增量合并模式
   - 如不存在 → 创建新公司 JSON

3. **字段映射规则**（LinkedIn → org-knowledge-base personnel schema）：
   ```
   linkedin.name           → personnel.name
   linkedin.current_title  → personnel.title
   linkedin.title_abbr     → personnel.title_abbr
   linkedin.location       → personnel.base_city
   linkedin.education_hint → personnel.background_brief（拼接）
   linkedin.linkedin_slug  → personnel.id（前缀 person- + 转换）
   "LinkedIn 自动挖掘"      → personnel.source
   linkedin.confidence     → personnel.confidence（新增字段）
   linkedin.source_query   → personnel.discovery_query（新增字段）
   ```

4. **去重合并**（基于姓名）：
   - 已存在同名人员 → 仅补充缺失字段，不覆盖人工录入的信息
   - 信息冲突 → 在 `update_history` 中记录冲突项

5. **更新汇报关系**（如 Stage 5 抓到）：
   - 在架构树中按 MD → ED → VP → Asso → AN 的层级链接
   - 标注 `inferred_reporting: true`（因为是从 LinkedIn 推断而非直接确认）

6. **写入文件**：
   ```
   createDocument/saveDocument(iWiki 用户目录/01-公司组织库/{company_id}.json)
   createDocument/saveDocument(用户-{user_key}/00-索引)
   ```

7. **触发架构图重新生成**：
   - 委托 `org-knowledge-base` Skill 处理 HTML 渲染
   - 或直接按 `org-knowledge-base/scripts/generate-chart.md` 模板生成
   - 写入 `iWiki 用户目录/01-公司组织库/{company_id} 的组织架构章节或附件`

8. **使用 preview_url 自动打开 HTML 架构图**

## 输出规范

### 控制台摘要（每次执行后输出）
```markdown
## LinkedIn 挖掘报告 — {公司}{部门}{职级}

**执行概况**
- 查询变体数：{N}
- 命中 raw 结果：{M}
- 提取候选人：{X} 人（去重后）
- 深度验证：{Y} 人
- 入库新增：{Z} 人

**Top 候选人**（按置信度排序）
| # | 姓名 | 职位 | 公司/部门 | 地域 | 置信度 | 备注 |
|---|------|------|-----------|------|--------|------|
| 1 | David Hoyer | ED | GS / TMT | HK | 0.92 | LSE · 前 Citi |
| 2 | ... | ... | ... | ... | ... | ... |

**已入库**：{company_id}.json（共 {人数} 人）  
**架构图**：file:///path/to/{company_id}.html （已自动打开）

**待用户确认**：
- ⚠️ {人名}：snippet 信息不全，建议手动核实
- ⚠️ {人名}：未能验证当前是否在职
```

## 错误处理

| 场景 | 处理 |
|------|------|
| web_search 全部失败 | 检查工具可用性，提示用户重试 |
| web_search 返回 0 结果 | 用更宽松的 query 兜底（去掉地域/部门约束） |
| web_fetch 被反爬 | 三层降级：LinkedIn → Google Cache → Bing Cache → Wayback |
| 候选人都低置信度 | 报告"未找到高质量候选人"+列出 raw query 让用户调整 |
| org-knowledge-base 写入失败 | 保留 LinkedIn 挖掘结果到临时文件，提示用户 |

## 与 org-knowledge-base 的协作

本 Skill 是 org-knowledge-base 的"数据生产者"：
- LinkedIn 挖掘 → 自动入库到 org-knowledge-base
- org-knowledge-base 接收数据后渲染统一的 HTML 架构图
- 已知人员（org-knowledge-base 中已有）会被标注 `known: true`，新挖人员标注 `discovered_by_linkedin`

未来扩展：org-knowledge-base 也可以反向调用本 Skill：
- 用户在已知公司点击"补全此团队" → 自动派发任务到 linkedin-deep-miner
- 校友网络反查（已知 A 是 LSE+GS）→ 调用本 Skill 找其他 LSE+GS 的人

## 性能与成本

| 阶段 | 工具调用 | 估算 |
|------|---------|------|
| Stage 1 | LLM 解析 | <1k tokens |
| Stage 2 | getDocument | 1 次 |
| Stage 3 | web_search × 5-10 并行 | 主要消耗 |
| Stage 4 | LLM 解析 | 取决于 raw_results |
| Stage 5 | web_fetch × N（≤10） | 可选 |
| Stage 6 | getDocument + createDocument/saveDocument | 3-4 次 |

**单次完整执行预计：5-10 分钟，10-30k tokens**

## 详细工作流参考

完整的工作流编排逻辑（包含每一步的 LLM 提示词模板）请参见
`scripts/workflow-orchestration.md`。

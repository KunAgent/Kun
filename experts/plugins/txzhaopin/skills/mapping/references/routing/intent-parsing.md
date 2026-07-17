# 意图解析规范

> 把用户自然语言 / JD 文本 → 结构化挖掘参数

---

## 一、5 问问卷模板

向用户一次性提出 5 个问题（不要逐个问）：

```
为了精准 mapping，请回答以下 5 个问题：

1. **目标公司**：要挖哪家公司？（如 GS HK / 腾讯 / 米哈游）
2. **目标部门/岗位**：哪个团队？哪个岗位？（如 IBD / 算法 / 美术 / 投资经理）
3. **目标职级**：MD/VP/Director/Lead/Senior/IC？
4. **地域**：HK / 北京 / 上海 / 全球？
5. **优先级模式**（4 选 1）：
   A. 现状画像优先（仅 linkedin，5 分钟）
   B. 履历溯源优先（linkedin + 1 个法定 Skill，15 分钟）
   C. 能力深度优先（github + authorfilter + linkedin，30 分钟）
   D. 全面 mapping（全 Skill 并行，60 分钟）
```

如果用户输入已经包含上述信息，跳过问卷。

---

## 二、JD 文本自动解析

如果用户直接贴 JD，调用 LLM 提取：

### Prompt 模板

```
你是招聘 Mapping 意图解析器。从下面的 JD 中提取结构化字段：

【JD 文本】
{jd_text}

【输出 JSON】
{
  "company_canonical": "...",        // 标准化公司名
  "company_id": "...",               // 25 公司主体表的 ID（看 references/output-contract.md）
  "company_aliases": ["..."],
  "industry": "Finance|AI|Gaming|PM|...",
  "department": "...",
  "department_keywords": ["..."],
  "title": "...",
  "level": "MD|VP|Director|Lead|Senior|IC|Intern",
  "geography": "...",
  "geo_keywords": ["..."],
  "skills_required": ["...", "..."],  // 技能关键词
  "deal_history_required": true/false, // 是否要求看过往 deal
  "academic_background_required": true/false,  // 是否需要论文
  "industry_vertical": "...",         // 子行业，如 'Investment Banking - TMT'
  "priority_mode": "A|B|C|D",         // 推荐的优先级模式
  "estimated_skills_to_call": ["linkedin", "github", ...]
}

约束：
- 找不到的字段留 null，不要捏造
- priority_mode 推断逻辑：
  - 金融 + Senior 层 → B
  - AI/算法 + Senior 层 → C
  - 美术/IC 层 → A
  - 高管挖掘 → D
```

---

## 三、行业识别（4 大类）

### 3.1 Finance（金融）

```python
finance_signals = [
    "Investment Bank", "IBD", "投行", "证券",
    "M&A", "ECM", "DCM", "Leveraged Finance",
    "Private Equity", "PE", "VC", "私募",
    "Hedge Fund", "对冲基金", "Asset Management",
    "高盛", "摩根士丹利", "中金", "中信", "瑞银", "JPMorgan", "Morgan Stanley", "Goldman",
]
```

### 3.2 AI / Tech（AI/研发）

```python
ai_tech_signals = [
    "Algorithm", "算法", "Machine Learning", "Deep Learning",
    "AI", "ML", "LLM", "大模型", "NLP", "CV", "Vision",
    "PhD", "博士",
    "PyTorch", "TensorFlow", "vLLM", "Triton",
    "Kubernetes", "Rust", "Go",
    "腾讯 AI Lab", "字节 Seed", "阿里达摩院", "百度文心", "Meta FAIR",
]
```

### 3.3 Gaming / Art（游戏/美术）

```python
gaming_signals = [
    "Concept Artist", "原画", "3D Artist", "建模",
    "Animator", "动画师", "VFX", "特效",
    "Art Director", "美术总监", "Lead Artist",
    "Technical Artist", "TA",
    "Unreal", "Unity", "Maya", "Houdini",
    "米哈游", "腾讯天美", "网易雷火", "完美世界",
]
```

### 3.4 PM / Ops（产品/运营）

```python
pm_ops_signals = [
    "Product Manager", "产品经理",
    "Operations", "运营", "Marketing",
    "BD", "Business Development", "商务",
    "Strategy", "战略",
]
```

---

## 四、职级标准化

### 4.1 金融行业职级

| JD 写法 | 标准化 level |
|---------|------------|
| "MD", "Managing Director", "董事总经理" | `MD` |
| "ED", "Executive Director", "执行董事" | `ED` |
| "VP", "Vice President", "副总裁" | `VP` |
| "Associate", "高级经理" | `Associate` |
| "Analyst", "分析师" | `Analyst` |
| "Partner", "合伙人" | `Partner` |
| "Principal" (PE/Consulting) | `Principal` |

### 4.2 互联网/AI 职级

| JD 写法 | 标准化 level |
|---------|------------|
| "Distinguished Engineer / Fellow" | `Fellow` |
| "Principal Engineer / Architect" | `Principal` |
| "Staff / Senior Staff Engineer" | `Staff` |
| "Senior Engineer / Lead" | `Senior` |
| "Engineer / Mid-level" | `Mid` |
| "Junior / Associate / Entry" | `Junior` |

### 4.3 学术职级

| JD 写法 | 标准化 level |
|---------|------------|
| "Distinguished Scientist" | `Distinguished` |
| "Principal Researcher" | `Principal` |
| "Senior Research Scientist" | `Senior` |
| "Research Scientist" | `Mid` |
| "Postdoc / Intern" | `Junior` |

---

## 五、地域标准化

| JD 写法 | 标准化 geography |
|---------|----------------|
| "HK", "香港", "Hong Kong", "Hongkong" | `Hong Kong` |
| "Beijing", "北京", "BJ" | `Beijing` |
| "Shanghai", "上海", "SH" | `Shanghai` |
| "Shenzhen", "深圳", "SZ" | `Shenzhen` |
| "Hangzhou", "杭州" | `Hangzhou` |
| "Singapore", "新加坡" | `Singapore` |
| "Bay Area", "湾区", "SF", "Mountain View" | `Bay Area` |
| "Seattle" | `Seattle` |
| "London" | `London` |
| "Tokyo", "东京" | `Tokyo` |

---

## 六、复合 JD 拆解

如果 JD 同时含多个行业关键词，按以下优先级合并：

### 6.1 跨行业组合

| JD 描述 | 解析为 |
|---------|--------|
| "FinTech AI 算法工程师" | industry = `Finance + AI`，priority_mode = `C`（深度），skills = `[github, linkedin, deal-news]` |
| "游戏行业 投资经理" | industry = `Finance`（投资是主业），但 vertical = `Gaming`，skills = `[linkedin, deal-news]` |
| "腾讯游戏 美术总监 + Technical Artist 经验" | industry = `Gaming`，但需要技术验证，skills = `[linkedin, artstation, github]` |
| "PE 硬科技投资经理" | industry = `Finance`，vertical = `Tech/AI`，skills = `[linkedin, deal-news, authorfilter（验证候选人懂技术）]` |

---

## 七、模糊输入处理

用户可能输入很模糊：

### 7.1 案例：「帮我挖几个 vLLM 高手」

```json
{
  "company_canonical": null,
  "industry": "AI",
  "department": null,
  "title": null,
  "level": "Senior+",
  "skills_required": ["vLLM", "LLM Inference", "GPU optimization"],
  "priority_mode": "C",
  "estimated_skills_to_call": ["github", "authorfilter", "linkedin"],
  "search_mode": "by_topic_expert"  // GitHub mode B/E
}
```

### 7.2 案例：「找米哈游所有美术」

```json
{
  "company_canonical": "miHoYo",
  "company_id": "mihoyo",
  "industry": "Gaming",
  "department": "Art",
  "title": null,
  "level": "All",
  "priority_mode": "D",
  "estimated_skills_to_call": ["artstation", "linkedin"]
}
```

### 7.3 案例：「腾讯近期人事变动」

```json
{
  "company_canonical": "Tencent",
  "company_id": "tencent",
  "industry": "All",
  "search_focus": "personnel_changes",
  "time_range": "recent_3_months",
  "priority_mode": "B",
  "estimated_skills_to_call": ["deal-news", "linkedin"]
}
```

---

## 八、不解析直接退出的输入

| 输入类型 | 处理 |
|---------|------|
| 纯候选人查询（"张三的情况"）| 不本 Skill，转给 wiki-reader |
| 简历上传 | 不本 Skill，转给 wiki-compiler |
| 查询历史 mapping 结果 | 直接读 knowledge-base |
| 「随便聊聊招聘」无具体目标 | 引导用户填 5 问问卷 |

---

## 九、输出契约

意图解析完成后，把结构化结果传递给 `skill-routing.md`：

```python
intent = parse_user_input(user_query)
skills_to_call = route_to_skills(intent)
budget = budget_by_priority_mode(intent["priority_mode"])
```

各 Skill 拿到的是同一份 `intent` 对象，确保参数一致。

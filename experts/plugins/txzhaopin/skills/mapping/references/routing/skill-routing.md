# Skill 路由表（按 JD 派发）

> 把 JD 关键词映射到 7 个底层 Skill 的调用序列

---

## 一、4 大业务线分流

```
JD 输入
   ↓
┌──────────────────────────────────────┐
│ 关键词分类器                          │
└──────────────────────────────────────┘
   ↓                ↓               ↓               ↓
[金融业务线]    [AI/研发线]      [游戏/美术线]    [产品/运营线]
```

---

## 二、金融业务线路由

### 2.1 关键词识别

```python
FINANCE_KEYWORDS = [
    "Investment Bank", "IBD", "投行",
    "M&A", "ECM", "DCM", "Leveraged Finance",
    "Sponsor", "Coverage", "Sector",
    "Private Equity", "PE", "私募",
    "Hedge Fund", "对冲基金",
    "Counsel", "律师", "Solicitor",
    "Auditor", "审计", "会计师",
    "Credit Suisse", "Goldman", "Morgan Stanley", "高盛", "摩根",
]
```

### 2.2 调用序列（按 JD 子类）

| JD 子类 | Skill 调用序列 | 说明 |
|---------|--------------|------|
| **IBD Coverage** | linkedin → hkex → sec → deal-news | 4 源并行 |
| **PE Director** | linkedin → deal-news → sec-filing | PE 多通过 deal news 暴露 |
| **M&A Banker** | linkedin → deal-news → hkex → sec | M&A deal 媒体爆光多 |
| **Counsel / Partner** | hkex → sec-filing → linkedin | 律所合伙人通过招股书披露 |
| **Compliance / Legal** | linkedin → hkex → deal-news | |
| **Front Office Senior** | linkedin → deal-news（追踪 promotion） | |

### 2.3 数据合并优先级

```
HKEX 招股书签字 / SEC F-1 签字（法定披露）→ 最高 (very_high)
   ↓
Deal News 媒体专访（IFR / Bloomberg / 36 氪 / 晚点）→ 高 (high)
   ↓
LinkedIn snippet 现状画像 → 中 (medium)
```

---

## 三、AI / 研发业务线路由

### 3.1 关键词识别

```python
AI_TECH_KEYWORDS = [
    "Algorithm", "算法", "Machine Learning", "ML", "AI",
    "Deep Learning", "LLM", "大模型", "NLP", "CV", "Vision",
    "Software Engineer", "SWE", "Backend", "Infra",
    "Research Scientist", "研究员",
    "PhD", "博士",
    "PyTorch", "TensorFlow", "Triton", "vLLM", "Rust", "Go", "K8s",
]
```

### 3.2 调用序列

| JD 子类 | Skill 调用序列 | 说明 |
|---------|--------------|------|
| **AI Research Scientist** | authorfilter → linkedin → github → deal-news | 学术深度优先 |
| **ML Engineer** | github → authorfilter → linkedin | 代码能力优先 |
| **LLM Inference Engineer (vLLM/TensorRT)** | github (mode B) → linkedin | 项目贡献者最权威 |
| **Senior SWE / Lead** | github → linkedin → deal-news | |
| **Infra Engineer** | github → linkedin | |
| **Robotics / Autonomous Driving** | github → authorfilter → linkedin | 论文 + 开源都关键 |

### 3.3 数据合并优先级

```
GitHub Org Member + commit 邮箱 = @company（双重确认）→ very_high
   ↓
论文 affiliation = company → very_high (法定可引用)
   ↓
LinkedIn snippet → medium
```

---

## 四、游戏 / 美术 / CG 业务线路由

### 4.1 关键词识别

```python
GAMING_ART_KEYWORDS = [
    "Concept Art", "原画", "Illustrator",
    "3D Art", "Modeling", "Texture",
    "Animation", "动画师",
    "VFX", "特效", "Lighting",
    "UI/UX Artist",
    "Art Director", "美术总监", "Lead Artist",
    "Technical Artist", "TA",
    "Unreal", "Unity", "Maya", "Houdini", "Substance",
    "米哈游", "腾讯天美", "网易", "完美世界", "Blizzard", "Naughty Dog",
]
```

### 4.2 调用序列

| JD 子类 | Skill 调用序列 |
|---------|--------------|
| **Concept Artist / 3D Artist (IC)** | artstation-talent-finder |
| **Art Director / Lead Artist** | linkedin → artstation |
| **Technical Artist** | linkedin → github (shader 项目) |
| **Animator** | artstation → linkedin |

---

## 五、产品 / 运营 / BD 业务线路由

### 5.1 关键词识别

```python
PM_OPS_KEYWORDS = [
    "Product Manager", "产品经理", "PM",
    "Operations", "运营", "Marketing",
    "BD", "Business Development", "商务",
    "Strategy", "战略",
]
```

### 5.2 调用序列

| JD 子类 | Skill 调用序列 |
|---------|--------------|
| **Senior PM** | linkedin → deal-news (产品发布媒体)|
| **BD Director** | linkedin → deal-news |
| **Strategy** | linkedin |
| **运营 / Marketing** | linkedin |

LinkedIn 是这类岗位的主力（产品/运营人员的非线上痕迹少）。

---

## 六、跨业务线复合 JD 的处理

实际 JD 经常是复合的，举例：

### 6.1 "金融科技 (FinTech) AI 算法工程师"
跨金融 + AI 业务线 → 调用：
```
github (主) → authorfilter → linkedin → deal-news (FinTech 媒体)
```

### 6.2 "腾讯游戏 美术总监 (兼 TA 经验)"
跨游戏 + 研发 → 调用：
```
linkedin → artstation → github (shader 项目)
```

### 6.3 "PE 投资经理 (硬科技赛道)"
跨金融 + AI/研发 →
```
linkedin → deal-news（PE 媒体）→ authorfilter（看是否懂技术）
```

---

## 七、调用预算限制

| 模式 | Skill 数 | 单 Skill 调用次数 | 总耗时 |
|------|---------|------------------|--------|
| **快速** | 1-2 | 4-6 | 5 min |
| **标准** | 3 | 8-10 | 15-20 min |
| **深度** | 5+ | 15+ | 30-60 min |

用户选择 Stage 1 的"优先级模式"决定走哪种：
- A. 现状画像优先 → 快速（仅 LinkedIn）
- B. 履历溯源优先 → 标准（LinkedIn + 1 个法定 Skill）
- C. 能力深度优先 → 深度（GitHub + Authorfilter + LinkedIn）
- D. 全面 mapping → 深度（全开）

---

## 八、Skill 级联触发逻辑

某些 Skill 完成后，自动建议下一步：

```
authorfilter 入库后 → 高产研究员（papers >= 3）→ 自动建议 跑 linkedin 验证当前
github 入库后 → Tier 1 contributor → 自动建议 跑 linkedin + deal-news
linkedin 找到 Senior 层 → 自动建议 跑 hkex/sec 看 deal 履历（金融业务）
                     → 自动建议 跑 github 验证（研发业务）
hkex 找到投行 MD → 自动建议 跑 deal-news 看媒体爆料
```

这些级联是"建议"性质，由用户确认后触发，避免无限循环。

---

## 九、数据归一化合并规则

### 9.1 同一人来自多个 Skill

```python
def merge_person_from_multi_skills(name, company_id, sources):
    """
    sources = [
        {"skill": "linkedin", "data": {...}},
        {"skill": "github", "data": {...}},
        {"skill": "hkex", "data": {...}},
    ]
    """
    person = {
        "name": name,
        "company_normalized": company_id,
        "_sources": {s["skill"]: s["data"] for s in sources},
    }
    
    # 主字段取最权威来源
    person["title"] = pick_priority(sources, "title", priority=["hkex", "sec", "linkedin", "github"])
    person["level"] = pick_priority(sources, "level", priority=["linkedin", "deal-news", "hkex"])
    person["department"] = pick_priority(sources, "department", priority=["github_org", "linkedin", "authorfilter"])
    
    # confidence 升级
    if len(sources) >= 3:
        person["confidence"] = "very_high"
    elif len(sources) == 2:
        person["confidence"] = "high"
    else:
        person["confidence"] = sources[0]["data"].get("confidence", "medium")
    
    person["cross_skill_verified"] = len(sources) >= 2
    return person
```

### 9.2 字段冲突解决

| 冲突类型 | 解决策略 |
|---------|---------|
| LinkedIn 写"MD"，HKEX 签字 "Director" | 取 HKEX（法定）；LinkedIn 写到 `notes` |
| LinkedIn 写公司 A，GitHub Org 是公司 B | 取最近 commit 邮箱；标 `recently_changed_company: true` |
| 2 个 LinkedIn URL 冲突 | 看哪个有更多 deal 数据；保留高质量的 |

---

## 十、报告输出模板（5 段式）

```markdown
# Mapping 报告：{Company} {Department} {Level}

## 1. 执行摘要
- 挖掘范围：...
- 调用 Skill：linkedin / github / hkex / ...
- 累计候选人：N 人
- Top 3 Insights：
  - ...
  - ...
  - ...

## 2. 组织架构图
{HTML 嵌入或链接}

## 3. 关键人物名单（高优先级 Top N）
| 姓名 | 职级 | 部门 | 联系建议 | confidence |
|------|------|------|---------|-----------|
| ... | ... | ... | LinkedIn / GitHub / 论文 | very_high |

## 4. 置信度热力图
- very_high (cross-skill verified): N 人
- high (single 法定来源): M 人
- medium (LinkedIn snippet only): K 人
- open_questions: P 个待跟进

## 5. 待办
- 知识库已更新：{json_path}
- 建议手动验证：N 人
- 数据时效：30 天后建议重跑
```

---

## 附录：与历史文件的关系

本文件是 v3.0 的"Skill → 数据源"映射（聚焦于 7 个具体可调用 Skill 的派发），
姊妹文件 `../channel-routing.md` 是 v1.0 的"业务线 → 渠道"映射（聚焦于 P0/P1/P2 分层 + 按层级差异）。

| 维度 | `channel-routing.md` (v1.0) | `skill-routing.md`（本文件，v3.0） |
|------|---------------------------|--------------------------------|
| 视角 | 渠道（LinkedIn / GitHub / 媒体 ...）| Skill（linkedin-deep-miner / github-miner / ...） |
| 抽象层 | 高层（What / Where） | 低层（How / Which） |
| 决策内容 | 优先级 P0/P1/P2 + 按层级差异 | 调用顺序 + 数据合并优先级 |
| 适用 | Stage 3 业务线分流 | Stage 4 实际调度 |

**两者互补，先用 channel-routing 决定"该在哪些渠道挖"，再用 skill-routing 决定"调哪个 Skill 实现"**。

业务线画像模板见 `../profile-templates/{investment, engineering, product, operations, generic}.md`，
含层级 Title 词典 / 方向细分 / 硬技能维度 / 薪酬基准 / 离职信号 / 水下画像。

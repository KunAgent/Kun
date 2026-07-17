---
name: zhihu-miner
description: |
  知乎人才挖掘器。通过知乎的面经 / 回答 / 专栏 / 话题，挖掘 Junior-Mid 层候选人、
  目标公司的内部情报（面试官姓名、面试流程、晋升通道、薪酬爆料等）。
  这是 Junior 层最高 ROI 渠道 —— 大厂面经文化让 Associate/Analyst 层大量暴露。
  触发场景：
  - 挖某公司的 Junior-Mid 层候选人（Analyst / Associate / P5-P7）
  - 了解目标公司的面试流程 / 面试官 / 内部文化
  - 挖某前员工的跳槽去向（知乎"离职分享"文化）
  - 找某赛道的内容输出者（行业专栏作者）
  触发短语：
  "知乎搜"、"知乎面经"、"内部视角"、"挖 Analyst"、"AN Asso 层"、
  "扒面试情报"、"zhihu-miner"、"面经"、"面试经验"。
description_zh: "知乎人才挖掘器 — 面经暴露 Junior 层，专栏反查专家"
description_en: "Zhihu Talent Miner — interview experiences reveal Junior layer"
version: "1.0.0"
meta_rules:
  - no-hallucination@1.0.0
---

# 📝 Zhihu Miner · 知乎人才挖掘

> 📌 本 Skill 遵守 [`rules/no-hallucination.md`](../../rules/no-hallucination.md)

---

## 一、核心价值

知乎是**中国互联网最好的 Junior 层人才情报源**。原因：

1. **大厂面经文化**：90% 大厂应聘者写面经，**暴露面试官真名**
2. **离职总结文化**：很多离职员工写"在 XX 工作 X 年的体会"，**暴露团队架构**
3. **行业专栏**：某些 Senior 会写专业专栏，**自带专家画像**
4. **匿名回答**：员工在匿名区吐槽时提到同事名字

| 维度 | 知乎 | LinkedIn |
|------|-----|---------|
| Junior 层覆盖 | 🔴 高（面经文化） | 中 |
| Senior 层覆盖 | 中 | 🔴 高 |
| 内部情报（面试/薪酬/文化） | 🔴 极高 | 低 |
| 真实性 | 中（部分匿名） | 高（实名） |
| 适用业务线 | 研发 / 产品 / 投资 / 运营都适用 | 同左 |

---

## 二、核心工作流（5 种挖掘模式）

### 🎯 模式 1：面经反查面试官（Junior 挖掘神招）

**目标**：通过面经暴露的面试官姓名，挖 Mid-Senior 层

**搜索语法**：

```
site:zhihu.com {公司} 面试 "面试官"
site:zhihu.com {公司} 一面 OR 二面 OR 终面 经验

# 示例
site:zhihu.com 字节跳动 推荐算法 面试 "面试官"
site:zhihu.com 高瓴 实习 面试 经历
```

**金矿句式**（在面经里搜索）：

```
"面试官 叫 {某某}"
"{岗位} {姓名} 面试"
"面了 {公司} 的 {岗位}，面试官是 {姓}"
"前面 是 {某某} 面 的"
```

---

### 🎯 模式 2：离职分享 → 前员工去向

**目标**：挖从目标公司离职的 Senior（最好触达的候选人）

**搜索语法**：

```
site:zhihu.com 在 {公司} 工作 体验
site:zhihu.com 从 {公司} 离职
site:zhihu.com 为什么离开 {公司}
site:zhihu.com {公司} 跳槽 去哪
```

**金矿句式**：

```
"我从 {公司} 离职了"
"在 {公司} {X} 年"
"转到 {新公司}"
"被 {新公司} 挖走"
```

---

### 🎯 模式 3：专栏作者 = 赛道专家

**目标**：找某赛道的顶级 content creator（通常是 Senior+ 层）

**搜索语法**：

```
site:zhuanlan.zhihu.com {赛道关键词}
site:zhihu.com/column {行业}

# 示例
site:zhuanlan.zhihu.com 推荐系统 工程实践
site:zhuanlan.zhihu.com 大模型 训练
site:zhuanlan.zhihu.com 消费投资
```

**反查步骤**：
1. 找到活跃专栏作者
2. 点 profile 看 "职业经历"（很多作者会写明）
3. 交叉验证其他社交账号（微博 / Twitter / 个人站）

---

### 🎯 模式 4：匿名区吐槽挖同事名字

**目标**：从匿名回答中提取被提到的员工姓名

**搜索语法**：

```
site:zhihu.com {公司} 匿名
site:zhihu.com "{公司}" "吐槽" OR "老板" OR "同事"
site:zhihu.com "{公司} 内部" OR "{公司}工作感受"
```

**注意**：
- 匿名区信息可信度**降一级**（可能是黑稿）
- 需多源交叉验证
- 提到的姓名要在 LinkedIn / 公司官网核对

---

### 🎯 模式 5：话题 / 问题下的高赞答主

**目标**：某个行业问题下，高赞回答的作者画像

**搜索语法**：

```
# 直接用知乎搜索
知乎 搜 "如何评价 {公司}" → 看高赞答主
知乎 搜 "{公司} 技术栈" → 看答主 bio

# Google 搜
site:zhihu.com 如何看待 {公司} "答主"
site:zhihu.com {公司} 话题 高赞
```

---

## 三、Dorking 模板库

### 研发岗（面经最多）

```
site:zhihu.com "字节跳动" 算法 面试 经历
site:zhihu.com "阿里" P7 OR P8 面试
site:zhihu.com "腾讯" T3 OR T4 晋升
site:zhihu.com "美团" 后端 面试题
site:zhihu.com "快手" 推荐算法 面经
site:zhihu.com "小红书" AI 面试
site:zhihu.com "拼多多" 算法 WLB

# LLM/大模型专向
site:zhihu.com 大模型 训练 工程师 面经
site:zhihu.com RLHF 面试
```

### 产品岗

```
site:zhihu.com 字节 产品经理 面试
site:zhihu.com PM 面经 {公司}
site:zhihu.com B端产品 {公司}
```

### 运营岗

```
site:zhihu.com {公司} 运营 面试
site:zhihu.com 小红书 内容运营
site:zhihu.com 抖音电商 运营
```

### 投资岗

```
site:zhihu.com VC 实习 面经
site:zhihu.com {基金} 分析师 面试
site:zhihu.com 投行 IBD 暑期实习
site:zhihu.com 买方 面试 经历
```

---

## 四、输出 Schema

### 4.1 从面经挖到的"面试官线索"

```json
{
  "type": "interviewer_clue",
  "target_company": "字节跳动",
  "interviewer_name_hint": "李老师（姓李，具体名字未披露）",
  "interviewer_role_hint": "推荐算法团队 Leader",
  "clue_source": "https://zhuanlan.zhihu.com/p/xxxxx",
  "snippet": "一面面试官是李老师，问了我多目标的工程细节",
  "confidence": "medium",
  "follow_up_action": "需通过 LinkedIn 反查字节推荐算法团队姓李的 Leader"
}
```

### 4.2 候选人（自写面经 / 公开档案）

```json
{
  "type": "candidate",
  "name_cn": "（知乎昵称，可能非真名）",
  "zhihu_url": "...",
  "bio_from_zhihu": "前 BAT 算法工程师 · 现 LLM 创业",
  "inferred_role": "算法工程师",
  "inferred_level": "Mid",
  "topics_active": ["推荐系统", "LLM", "创业"],
  "recent_articles": [
    {"title": "...", "url": "..."}
  ],
  "sources": ["https://www.zhihu.com/people/..."],
  "confidence": "low"
}
```

### 4.3 公司内部情报

```json
{
  "type": "company_intel",
  "company": "字节跳动",
  "intel_type": "interview_process | compensation | culture | org_structure",
  "content": "推荐算法组 3 轮技术 + 1 轮 HR，第 2 轮必考多目标建模",
  "source_url": "https://zhihu.com/question/xxx",
  "reliability": "high | medium | low",
  "last_verified": "2026-04-28"
}
```

---

## 五、使用限制

### ⚠️ 注意

- **真实性**：知乎内容真假混杂，**不得直接断定为事实**
- **匿名信息**：匿名回答降级可信度
- **时效性**：面经半衰期 6-12 个月（流程、面试官常变）
- **黑稿风险**：竞争对手可能刻意抹黑某公司，交叉验证

### ⚠️ 合规

- ✅ 只读公开回答
- ❌ 不得收集用户私信 / 站内信
- ❌ 不得爬取需登录查看的内容
- ❌ 不得将匿名用户信息反向关联到真实身份

---

## 六、与其他 Skill 的协作

| Skill | 关系 |
|-------|-----|
| `mapping-universal` | 上游调度（所有业务线 P1/P2） |
| `linkedin-public-miner` | 下游验证（面经挖到的姓氏 → LinkedIn 查真人） |
| `github-miner` | 平级（研发面经 + GitHub 双重验证） |
| `wiki-evolver` | 下游（面经里的新事实沉淀） |

---

## 七、Changelog

### v1.0.0 · 2026-04-28

- 首版发布
- 5 种挖掘模式
- 4 业务线 Dorking 模板
- 3 种输出 Schema（线索 / 候选人 / 情报）
- 真实性提示

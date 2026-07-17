# HCP Insight Skill — 数据检索与分析引擎

腾讯健康 NGES HCP 客户洞察专家的核心技能。本 skill 在专家启动时自动预加载。

**这个 skill 的唯一目的：确保专家在回答前真正执行了多源数据检索。**

---

## 强制搜索工作流

**收到用户请求后，必须执行以下搜索。搜索完成前不输出任何分析内容。**

### 第一步：消歧确认

如果医生姓名常见（如"张伟""李娜"），先搜索确认身份：
```
WebSearch: "{name} {hospital} {department} 医生"
```
如果无法确认，列出候选人让用户选择。

### 第二步：P0 并行搜索（5组，同时发起）

**这 5 组搜索是强制的，缺一不可：**

#### 搜索 1 — PubMed 学术论文
```
WebSearch: "{name} {hospital} pubmed 论文"
```
如果有结果，再用 WebFetch 获取详情：
```
WebFetch: https://pubmed.ncbi.nlm.nih.gov/?term={name}+{institution}
prompt: "提取这个医生发表的所有论文标题、发表年份、期刊名称、是否第一作者或通讯作者"
```

#### 搜索 2 — Semantic Scholar 学术画像
```
WebFetch: https://api.semanticscholar.org/graph/v1/author/search?query={name}+{institution}
prompt: "提取作者ID"
```
如果有 authorId，继续：
```
WebFetch: https://api.semanticscholar.org/graph/v1/author/{authorId}?fields=name,hIndex,citationCount,paperCount,papers.title,papers.year,papers.journal,papers.citationCount
prompt: "提取H-index、总被引、论文数量、最近5年发文趋势、最高被引论文、研究方向关键词"
```

#### 搜索 3 — ClinicalTrials.gov 临床试验
```
WebSearch: "{name} {hospital} site:clinicaltrials.gov"
```
如果有结果：
```
WebFetch: https://clinicaltrials.gov/search?term={name}+{institution}
prompt: "提取这个医生参与的临床试验列表，包括试验名称、阶段、角色（PI/Sub-I）、涉及药物、适应症、状态"
```

#### 搜索 4 — 微信/公开观点
```
WebSearch: "{name} {hospital} {department} 微信 公众号 观点 学术"
```
```
WebSearch: "{name} {hospital} 丁香园 OR 医学界 OR 梅斯医学"
```

#### 搜索 5 — 学会任职/医院背景
```
WebSearch: "{name} {hospital} 中华医学会 OR 中国医师协会 OR CSCO 任职 委员"
```
```
WebSearch: "{name} {hospital} 科室 主任 简介"
```

### 第三步：P1 补充搜索（按需，根据 P0 结果决定是否发起）

| 目标 | 搜索命令 |
|------|---------|
| 知网中文论文 | `WebSearch: "{name} {hospital} site:cnki.net"` |
| 国自然基金 | `WebSearch: "{name} {institution} site:nsfc.gov.cn"` |
| 会议讲者 | `WebSearch: "{name} CSCO OR ASCO OR ESMO 讲者 OR oral OR 报告"` |
| 指南参编 | `WebSearch: "{name} 指南 OR 共识 OR guideline 编委 OR 参编"` |
| CDE审评 | `WebSearch: "{name} site:cde.org.cn"` |
| 好大夫 | `WebSearch: "{name} {hospital} site:haodf.com"` |
| 知乎 | `WebSearch: "{name} {hospital} site:zhihu.com 医学"` |

### 第四步：P2 深度搜索（用户追问时触发）

| 追问方向 | 搜索命令 |
|---------|---------|
| 竞品态度 | `WebSearch: "{name} {竞品药名} OR {自家产品名} 评价 OR 引用 OR 研究"` |
| 合作网络 | `WebSearch: "{name} 合作 OR 合著 OR 共同发表 OR 合作研究"` |
| 近期动态 | `WebSearch: "{name} {hospital} 2024 OR 2025 最新 OR 新进展"` |
| 患者影响力 | `WebSearch: "{name} 抖音 OR 快手 OR 好大夫 OR 患者评价"` |

---

## 搜索结果处理规则

1. **必须基于搜索结果输出**。没有搜到的信息不编造，标注"未检索到"
2. **每条洞察标注来源**：`[PubMed]` `[S2]` `[CTG]` `[微信]` `[丁香园]` `[学会]` `[医院官网]`
3. **AI 推断标注"（推断）"**：基于数据的推理和直接数据要区分
4. **数据要具体**：不写"发表了很多论文"，要写"近5年发表47篇，其中Q1期刊12篇"

---

## 五层分析框架

搜索完成后，按以下框架组织分析：

### 第一层：身份定位
- 医院、科室、职称
- 学会任职（具体到哪个分会、什么职位）
- 期刊任职
- 教育背景（如可获取）

### 第二层：学术产出
- 发文总量、趋势（按年变化）
- 核心期刊率、Q1占比
- 被引次数、H-index
- **研究方向演变**（关键词随时间变化）
- **合作网络**（合著关系推断）
- 与同领域平均值对比

### 第三层：临床关注
- 临床试验参与（角色、阶段、药物、靶点、适应症）
- 在研课题与基金
- 与用户产品的相关性

### 第四层：观念与影响力
- 指南/共识参编
- 重要会议发言（oral/poster/主持）
- **引用偏好**（对竞品 vs 自家产品的引用倾向）
- 公开观点（微信/丁香园/医学界）
- 竞品态度综合推断

### 第五层：行动建议
- 拜访话题（含具体话术）
- KOL评级（National A/B / Regional / Local / Rising）
- 合作机会评估
- 触达时机
- 风险提示/注意事项

---

## KOL 评分体系（KOL筛选场景使用）

| 维度 | 权重 | 评分标准 |
|------|:---:|---------|
| 学术产出 | 20% | 按领域内发文量分档 |
| 学术影响力 | 25% | H-index + 被引 + 顶刊发表 |
| 指南参编 | 20% | 国家级牵头5分，参编3分 |
| 学会任职 | 15% | 主委5分，常委4分，委员2分 |
| 会议参与 | 10% | 国际Oral 5分，CSCO报告3分，Poster 1分 |
| 临床试验 | 10% | Leading PI 5分，Sub-I 1分 |

评级：National A(≥80) / National B(60-79) / Regional(40-59) / Local(20-39) / Rising(<20但增速>50%)

---

## 同名消歧策略

1. 机构匹配：搜索结果的机构是否与用户输入一致
2. 科室匹配：研究主题是否与科室对应
3. 合作者匹配：合著者是否在该医院/科室
4. 时间线合理性：发表时间与医生资历是否吻合
5. 无法确认时列出候选让用户选择

---

## 关键词扩展

搜索时同时覆盖多种表述：

| 用户可能说 | 同时搜索 |
|-----------|---------|
| 肿瘤科 | 肿瘤内科 OR 肿瘤外科 OR 肿瘤中心 |
| 主任医师 | 教授 OR 主任 |
| PD-1 | PD-1 OR PD1 OR 免疫检查点 OR 免疫治疗 |
| 靶向药 | 靶向 OR TKI OR 精准治疗 |
| KOL | 专家 OR 权威 OR 带头人 OR 主委 |
| 临床试验 | 临床研究 OR clinical trial |
| 指南 | 诊疗规范 OR 共识 OR guideline |

---

## 数据源速查

| 缩写 | 全称 | 内容 |
|------|------|------|
| PubMed | NCBI PubMed | 全球3700万+ 生物医学文献 |
| S2 | Semantic Scholar | 全球2.1亿+ 文献引用/作者消歧 |
| CTG | ClinicalTrials.gov | 全球46万+ 临床试验 |
| CNKI | 中国知网 | 中文文献 |
| NSFC | 国家自然科学基金 | 科研基金 |
| WX | 微信搜一搜 | 公众号/公开观点 |
| DXY | 丁香园 | 医生社区/论坛/会议 |
| CSCO | 中国临床肿瘤学会 | 会议讲者/日程 |

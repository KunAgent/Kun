# 阶段 5：精读（Top 30 池 + 命中 10 即停） v6.1.3

## 目标

从粗筛挑出的 **Top 30 候选**中逐批精读，**累计找够 10 个符合画像的人就停**，避免精读浪费。

---

## 🆕 v6.1.3 变化：精读回归"不落盘"原设计

### 调用范式（红线）

**正确**（永远这样）：

```bash
python3 {skillDir}/scripts/deep_read.py \
    --rids "$ALL_RIDS" \
    --offset {OFFSET} \
    --limit {LIMIT}
```

命令运行后：
- **stdout（纯 JSON）** → 直接作为 `execute_command` 工具的返回值给模型，模型从返回值解析
- **stderr（进度日志）** → 实时打到用户屏幕（`[1/30] 获取 xxx...`）

**禁止**（会破坏"不落盘"原设计 或 吞掉进度日志）：
- ❌ `... > batch1.json`
- ❌ `... 2>&1`
- ❌ `... | tee file.json`
- ❌ `... | head -N` / `| tail -N` / `| jq ...`

### `--limit` 按模型上下文自适应

| 模型上下文 | `--limit` 推荐 | 单批 Token ≈ | 说明 |
|------|------|----|----|
| ≥128k（Claude Opus / GPT-4）| **5**（默认）| ~8k | 舒适 |
| 32k-64k（Hunyuan3.0 等）| **3** | ~5k | 留推理空间 |
| 16k | **2** | ~3k | 紧但可用 |
| <16k | **1** | ~1.5k | 单份精读 |

动态降级规则：如果 `execute_command` 返回 JSON 尾部不完整（解析失败）→ 把 `--limit` 减半重试。

---

## 🆕 v6.1.1 变化：精读不再校验公司

精读阶段**不需要**再核对候选人的公司背景（无论是 `must.companies` 还是 `bonus.tier1_companies`）：

- `must.companies`：搜索端 `mustCompanies` 已在 MCP 后端按简历全部工作经历做命中，返回的所有候选人都必然命中这些公司之一，无需再核对
- `bonus.tier1_companies`：粗筛阶段已做加权打分排序，精读不再重复

**腾出的权重分配给粗筛看不到的维度**：技能深度、项目量级、职级晋升、团队规模、论文/比赛细节等。

---

## 🎯 精读打分逻辑（100 分制）

对每个候选人从 4 个维度打分，**完全符合画像得满分**，依据画像的必要条件与加分项拆：

### 打分公式

```
match_score = 必要条件分(60) + 加分项(40)
```

### 必要条件分（60）—— 不满足直接扣光

每个"必要条件"维度的分值 = `60 / 必要条件维度数`。

例如画像有 3 个必要条件（岗位方向、工作年限、城市），那每个维度 20 分。

**注意（v6.1.1）**：`must.companies` 不再作为精读必要条件维度（搜索端已兜底）。

每个维度判 3 档：
- **✅ 完全满足** → 该维度满分
- **⭐ 部分满足** → 该维度 60% 分
- **❌ 不满足** → 0 分

### 加分项（40）—— 锦上添花

每个加分项维度等权，总分 40。

例如画像有 4 个加分项（目标公司、核心技能、项目经验、业务领域），每项 10 分。

**注意（v6.1.1）**：`bonus.tier1_companies` 在粗筛已加权，精读打分时可**不再作为加分项维度**，把权重匀给其他维度（技能深度/项目量级/职级等）。

每项判 3 档：
- **✅ 强匹配** → 满分
- **⭐ 部分匹配** → 60% 分
- **❌ 无体现** → 0 分

### 命中阈值（决定是否计入"找够 10 个"）

| 区间 | 等级 | 算不算命中 |
|---|---|---|
| 90-100 | 💎 深度匹配 | ✅ 计入 |
| 75-89 | ⭐ 高度匹配 | ✅ 计入 |
| 60-74 | ✅ 基础匹配 | ✅ 计入 |
| < 60 | ⚠️ 勉强匹配 / ❌ 不匹配 | ❌ 不计入 |

**默认阈值为 60**。如果画像很宽泛导致池子里 60+ 的人不够 10，可在 Agent 层决策降到 45（并在报告里说明）。

---

## 🔁 早停执行算法（v6.0 · 脚本拉详情 + Agent 维护循环）

> v6.0 改造：**"批量拉详情 + 字段过滤" 下沉到 `deep_read.py` 脚本**；**"循环 + 早停 + 模型打分"仍在 Agent 端**。

### 流程

```
前置：rough_screen.py 已输出 top_rids.json（top_rids 为 Top 30 的有序 rid 列表）

输入：
  - top_rids（从 top_rids.json 用 read_file 读取，最多 30 个）
  - 拼接为逗号分隔字符串 ALL_RIDS

变量：
  - offset = 0           # 当前批次起点
  - qualified_count = 0  # 累计合格数（模型每批自报）
  - qualified_list = []  # 已命中候选人

WHILE offset < len(top_rids) AND qualified_count < 10:

  # ① Agent 调脚本拉本批
  python3 {skillDir}/scripts/deep_read.py \
    --rids "$ALL_RIDS" --offset {offset} --limit 5
  → 返回 {results: [...], errors: [...], batch_info: {...}}

  # ② 模型按画像维度精读 results 中每份简历
  #    - 计算 match_score
  #    - 输出每份的精读评估表

  # ③ 模型在本批末尾必须显式声明：
  #    "本批合格 X 份 / 累计合格 Y / 10"
  #    qualified_count 累加 X

  # ④ Agent 根据 batch_info 更新 offset
  offset = batch_info.next_offset

  # ⑤ 终止判断
  - qualified_count >= 10 → 截到 10 个，停
  - batch_info.has_more == false → 池子用完，停

输出：qualified_list（按 score 降序，取前 10）
```

> ⚠️ **强制要求**：模型每批必须显式输出"累计合格 Y / 10"，否则 Agent 无法判断是否停止，会精读完所有 30 份造成浪费。

### 执行示例

| 批次 | offset | 本批 5 份 | 新增合格 | 累计 | 动作 |
|---|---|---|---|---|---|
| 1 | 0 | rank 1-5 | 4 | 4 | 继续 |
| 2 | 5 | rank 6-10 | 3 | 7 | 继续 |
| 3 | 10 | rank 11-15 | 4 | **11 → 截到 10** | 停 |

**最优场景**：Top 10 命中率高 → 2-3 批就够 → 总耗时约 60-90s
**最差场景**：命中率低 → 6 批拉满 30 → 总耗时约 3 分钟

---

## 📋 精读输入字段（白名单 · v6.0 deep_read.py 内置过滤）

`deep_read.py` 调用 MCP `getResumeWithDetail` 后，按以下白名单字段过滤后输出到 stdout（不落盘），模型只看精简后的字段做评估。

### 1. 基本信息（身份卡片，报告表格用）

```
RID / name / age / gender / workCity / extendWorkYearValue（工作年限）
currentJobTitle（当前职位） / lastCompany（当前公司）
education（最高学历） / school（最高学历院校）
status / statusText / isLock（锁定状态，合规必需）
```

### 2. 前 2 段工作经历（`resumeWorkExp[0:2]`）

```
employerName / department / positionTitle / industry
workStartDate / workEndDate / workPlace
workSummary（只看前 200 字，超出部分忽略）
```

### 3. 前 2 段项目经历（`resumeProject[0:2]`）

```
projectName / projStartDate/projectStartDate / projEndDate/projectEndDate
projSummary/projectSummary（只看前 200 字，超出部分忽略）
```

### 4. 教育经历（`resumeEdu`，字段少不占 token）

```
eduSchool/schoolName / eduLevel/degree / eduMajorName/majorName
eduStartDate/startDate / endDate
is985 / is211 / isC9 / overSea
```

### 5. 技能标签（`resumeTagSkills`，字符串数组）

### ❌ 主动忽略（MCP 返回但不评估）

- 自我评价（SelfEvaluation）
- 证书列表（CertList）
- 语言能力（LangList）
- 培训经历（TrainList）
- **面试评价 / 沟通记录详情**（flowList / contactRecords）
- 期望薪资 / 到岗时间
- 附件 / 照片

---

## 🎯 精读输出模板（每人一段）

```markdown
## 候选人 {global_rank}：{name} — {match_tier}

- **现司现职**：{lastCompany} / {currentJobTitle}（≤ 25 字）
- **年限 / 城市 / 学历**：{workYears} / {workCity} / {education}·{school}（≤ 40 字）
- **匹配分**：{match_score}/100
- **锁定状态**：{statusText}（锁定人选需提示）

**核心亮点**（3 条，每条 ≤ 35 字，必须是简历里有的具体经历）：
1. {亮点 1}
2. {亮点 2}
3. {亮点 3}

**必要条件评估**（按画像 must 逐项）：
- {维度 1}：{✅/⭐/❌} {说明，≤ 30 字}
- {维度 2}：{✅/⭐/❌} {说明}
...

**加分项评估**（按画像 bonus 逐项）：
- {维度 1}：{✅/⭐/❌} {说明，≤ 30 字}
- {维度 2}：{✅/⭐/❌} {说明}
...

**潜在风险**（≤ 50 字，无则写"无"）：{风险}

**简历链接**：https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP

---
```

**单条字数预算**：≤ 350 字 → 10 条总输出 ≤ 3500 字

---

## 🧠 精读 Prompt（每批次独立使用）

```
你是腾讯社招简历精读助手。对下面 {batch_size} 份候选人详情**逐条评估打分**，
按画像的必要条件和加分项拆分维度，每维度判 ✅/⭐/❌ 并给分，最后算出 match_score。

【画像】
必要条件：{must 的每个维度 + 各自阈值}
加分项：{bonus 的每个维度 + 关键词/公司列表}

【打分规则】
- match_score = 必要条件分(60) + 加分项(40)
- 必要条件每维度等权分 60/N 分：✅满分、⭐60%、❌0
- 加分项每维度等权分 40/M 分：✅满分、⭐60%、❌0

【字段白名单——只看以下字段，忽略其余】
- 基本信息：name/age/gender/workCity/extendWorkYearValue/currentJobTitle/lastCompany/education/school/status/statusText/isLock
- 工作经历：resumeWorkExp 前 2 段（workSummary 只看前 200 字）
- 项目经历：resumeProject 前 2 段（projSummary 只看前 200 字）
- 教育经历：resumeEdu 全部
- 技能标签：resumeTagSkills

【候选人详情（{batch_size} 人，来自 MCP getResumeWithDetail 返回）】
candidate_1: {JSON}
candidate_2: {JSON}
...

【输出要求】
1. 严格按 Markdown 模板填空
2. match_score ≥ 60 的标为 💎/⭐/✅，< 60 标为 ⚠️，并在输出末尾用 `MISS` 行标注
3. 亮点必须摘简历里的具体项目/成就，不能写空话
4. 锁定状态为非"可推荐"时必须在"潜在风险"里提示
5. rid 直接从 candidate.rid 取，不要编造链接
6. 本批内先按 match_score 降序排

【输出末尾追加一行机器可读摘要，方便短路判断】：
`BATCH_SUMMARY: hits={命中数} misses={未命中数} scores=[候选人1分,候选人2分,...]`

现在开始，直接从 `## 候选人 1` 开始输出：
```

---

## ⚠️ 边界场景

| 场景 | 处理 |
|---|---|
| 30 人精读完仍不足 10 命中 | 直接交付已有命中数 + 提示用户"要不要扩 Top 60 / 降阈值到 45 / 调画像" |
| 某批输出格式偏离模板 | 只重跑该批（单批粒度） |
| 锁定状态为非"可推荐" | 依然参与打分，但在风险栏标红，让用户决定 |
| rid 张冠李戴 | Agent 合并时按 batch 输入的 rid 列表校验，不匹配直接丢 |
| Top 30 整体质量偏差大 | 说明粗读打分规则与画像对不上，回退到阶段 1 重新对齐画像 |
| `deep_read.py` 返回 errors 非空 | Agent 跳过失败 rid，按 batch_info.next_offset 继续下一批 |

---

## v6.0 职责划分

| 职责 | 归属 | 原因 |
|---|---|---|
| 调 MCP 拉详情 | `deep_read.py` | 重复 IO，脚本批量调更快；多次解析 JSON 不污染 Agent 上下文 |
| 字段白名单过滤 | `deep_read.py` | 完整详情 ~10KB/份 × 30 = 300KB；过滤后 ~1KB/份 × 30 = 30KB，节省 90% Token |
| 模型按画像打分 | Agent | 评估含主观判断（"项目是不是真核心"），无法脚本化 |
| 早停循环控制 | Agent | 终止条件依赖模型打分结果，必须 Agent 编排 |

**精读阶段的正确做法**：
- ✅ Agent 调 `deep_read.py` 拉本批
- ✅ Agent 用模型按画像维度评估打分
- ✅ Agent 维护 qualified_count 累计 + 早停判断
- ❌ 不要绕开 `deep_read.py` 直接 `mcp_call_tool` 逐条拉
- ❌ 不要让模型自己写 Python 代码拉详情

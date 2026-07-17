---
name: 叙事门控与外部工作流对标
description: 对照 spec-driven / 上下文工程实践，补齐福帮手在长文档场景下的门控、验收与并行语义
---

# 叙事门控与外部工作流对标（福帮手 × 工程化协作范式）

> **版本**：2.1.1  
> **目的**：把「代码交付类」工作流中已验证的 **门控分类、计划契约、波次并行、人机分工、修订熔断** 转写为 **长文档 / 书籍 / 白皮书** 可执行规则，**不**引入与企业写作无关的仪式。  
> **非目标**：复制第三方命令名或目录结构；真值仍在 `.fbs/`、`chapter-status`、脚本实测。

---

## 1. 福帮手「软肋」与补齐关系（摘要）

| 典型软肋 | 表现 | 本仓库补齐方式 |
|----------|------|----------------|
| 大纲与成文断层 | 一句话目录撑不起叙述 | **叙述 CONTEXT 冻结**（`.fbs/narrative-context.md` 模板）+ S1/S2 与 `author-meta` / 术语锁定 |
| 扩写无契约 | 并行失控、字数虚报、台账漂移 | **书面** `expansion-plan.md` + **`verify-expansion-plan-structure`** 结构门禁 + `expansion-word-verify` |
| 机检≠可读 | 脚本全绿但读者不满意 | **读者验收清单**（`template-reader-uat-checklist.md`）显式人机分工 |
| 无限改稿 | 同一章反复润色不收敛 | **修订熔断**（见 §5，对齐质检轮次与阶段回退） |
| 主会话撑爆 | SKILL + 全书灌入上下文 | **`fbs-context-compression.md`** + 速查卡「指针读盘」 |
| 并行叙事分裂 | 多章齐写风格与伏笔不一致 | **Wave 语义**（扩写计划内波次 + 共享 `book-context-brief` / 术语表） |

---

## 2. 四类门控（映射 S0–S6）

与通用 **Pre-flight / Revision / Escalation / Abort** 对齐；以下为福帮手 **叙事域** 含义。

### 2.1 Pre-flight（进入前）

- **条件**：阶段要求工件齐全（如 S3 前 `s3-start-gate`、S3.5 前 **已确认** 的 `expansion-plan.md`、叙述 CONTEXT 与大纲冻结一致）。
- **失败**：**不创建**半成品交付（例如未确认计划不得写 `.expanded` 覆盖正式章）。

### 2.2 Revision（产出后迭代）

- **条件**：计划 / 章节经 **质检或脚本** 发现问题，带反馈重入（如 `quality-auditor`、扩写未达标重扩）。
- **边界**：须设 **最大轮次**；见 §5。

### 2.3 Escalation（必须人判）

- **条件**：素材不足、立场冲突、品牌口径不明、**同一问题多轮质检不收敛**。
- **行为**：暂停自动扩写/润色，回到 **会议机制 / 用户确认 / 大纲或 CONTEXT 修订**。

### 2.4 Abort（继续有害）

- **条件**：宿主工具不可用却强依赖、`.fbs` 真值矛盾（如 `chapter-status` 与磁盘严重冲突且无法解析）、或上下文已不足以可靠执行。
- **行为**：**停止大规模改写**，保留状态，先修复前置（环境、真值、计划）。

---

## 3. 计划契约：扩写计划 = 机读 + 人读

- **结构门禁**：`node scripts/verify-expansion-plan-structure.mjs --book-root <本书根>`  
  校验必备章节标题、机读表、用户确认区（可选 `--strict` 要求已勾选确认）。
- **字数门禁**：`expansion-word-verify` / `expansion-gate`（既有，不变）。
- **素材启发式**：`expansion-plan-vs-material`（既有）。

---

## 4. Wave（波次）在福帮手中的含义

- **定义**：同一波次内章节 **叙事依赖弱**、可共享同一套冻结 CONTEXT + 术语；**下一波**依赖上一波已落地的论点或事实。
- **写法**：在 `.fbs/expansion-plan.md` 的 **「Wave 编排」** 中列出波次与章 ID；并行度仍受 `fbs-runtime-hints.json` **上限**约束（≤3，推荐≤2）。
- **反模式**：把 Wave 当成「多开 Agent 数量」——应先画 **依赖**，再填波次。

---

## 5. 修订熔断（对齐「issue 数不降则升级」）

适用于：**同一章 / 同一扩写 batch** 在 S+P（或全书 profile）质检下反复失败。

1. 记录每轮 **阻塞项数量**（或质检分数未达标项）。  
2. 若 **连续两轮** 阻塞项 **不减少**，则 **Escalation**：检查是否 **叙述 CONTEXT** 或 **素材** 不足，而非继续同层磨字。  
3. 三轮仍不收敛：必须 **用户显式选择**（接受带瑕疵继续 / 回退到大纲或 S0 补素材 / 缩小范围）。

（与 `references/02-quality/writing-phase-alert-tiers.md`、S3.7 精修轮次配合阅读。）

---

## 6. 人机验收分工（checkpoint 语义）

| 类型 | 谁做 | 福帮手对应 |
|------|------|------------|
| 机器可判 | 脚本 / 固定规则 | 字数、`chapter-status`、A 类词、链接、待核实台账 |
| 人必须判 | 作者 / 主编 | 可读性、说服力、风格、结构节奏、敏感表述 |
| 衔接 | 清单模板 | `template-reader-uat-checklist.md`（可复制到 `.fbs/reader-uat.md`） |

原则：**能跑脚本的不让用户点点点**；用户时间留给 **判断与取舍**。

---

## 7. 相关文档与脚本

| 资源 | 说明 |
|------|------|
| [`../01-core/s3-expansion-phase.md`](../01-core/s3-expansion-phase.md) | S3.5 权威 |
| [`fbs-context-compression.md`](./fbs-context-compression.md) | 上下文压缩 |
| [`agent-task-strategy.md`](./agent-task-strategy.md) | 并行与单线策略 |
| [`template-narrative-context.md`](./template-narrative-context.md) | 叙述 CONTEXT 模板 |
| [`template-reader-uat-checklist.md`](./template-reader-uat-checklist.md) | 读者验收模板 |
| `scripts/verify-expansion-plan-structure.mjs` | 扩写计划结构校验 |

---

## 8. 变更说明

本文件为 **规范层** 增补；不改变既有脚本退出码语义，仅增加可选门禁与模板入口。

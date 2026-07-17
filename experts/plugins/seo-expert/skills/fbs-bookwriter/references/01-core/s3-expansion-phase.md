# S3.5 内容扩写阶段（初稿后的迭代扩写）

> **版本**：2.1.2  
> **依据**：WorkBuddy 实测复盘（2026-04-14）— 扩写缺规划、并行失控、字数虚报、台账未更新等  
> **定位**：位于 **S3 初稿成文** 之后、**S4 排版构建** 之前；**不是** S3 的简单重复，而是有独立门禁与质检闭环的子阶段。

> **字数唯一真源（P0）**：对用户、对台账、对复盘报告披露的「本章/本书字符数」**必须**与 `node scripts/expansion-word-verify.mjs`（或等价 `fs.readFileSync(path,'utf8').length`）一致；**禁止**以模型心算作为唯一依据。

---

## 1. 何时进入 S3.5

用户明确表达：**扩写 / 加厚 / 从 X 字扩到 Y 字 / 进入扩写阶段** 等，且本书已有 S3 初稿 Markdown。

**禁止**：未产出书面扩写计划即开始逐章改写。

---

## 2. 阶段门禁（P0）

| 门禁 | 要求 |
|------|------|
| **扩写计划** | 必须先创建或更新 `.fbs/expansion-plan.md`，并经 **用户确认**（对话中明确「同意按此计划执行」或等价表述） |
| **素材对齐** | 计划中每章须标注素材充足度：`充足` / `偏少` / `需先补 S0`；指标（如「引语≥8处」）不得超过 `material-library.md` 可支撑范围 |
| **并行度** | **写作类扩写**并行 **≤3**（`fbs-runtime-hints.json` → `s3.maxParallelExpansionChapters`）；**推荐 ≤2**（`recommendedParallelExpansionChapters`）以降低风格漂移；禁止超过上限同时扩写正文 |
| **子智能体** | **禁止**使用 `code-explorer` 或纯代码探索类 subagent 承担正文扩写；扩写由 `fbs-writer` / team-lead 或宿主明示的写作类角色执行 |
| **共享上下文** | 每路扩写前注入：`book-context-brief.md`、`术语锁定记录.md`、品牌/合规约束；并行时尚需 **相邻章摘要** 以防论点重复 |
| **临时文件** | 并行扩写时先写入 `[S3.5-ChNN].expanded.md`（或等价命名），**字数与质检通过后再替换** 正式章文件，避免半篇覆盖 |

---

## 3. `.fbs/expansion-plan.md` 必须包含

1. **全书扩写目标**：目标总字数区间、优先级（章序）。
2. **章节表**（可与下方「机读表」一致）：
   - 章节 ID、文件路径、**扩写前字符数**（工具测量）、**目标字符数**、**本轮最大增幅**（见 §4）。
   - **素材评估**：`充足` / `偏少` / `需先补 S0`。
   - **新增内容清单**（到小节级）。
   - **与前后章边界**：本章只写什么、**不**写哪些（避免与 Ch01 等重复论证）。
3. **执行顺序与并行策略**：明确写「本轮串行 / 本轮最多 N 章并行」（N≤3，推荐 2）。
4. **用户确认记录**：一行「用户确认时间 / 方式」。

---

## 4. 单次扩写增幅与轮次

- **默认**：单轮相对扩写前正文，增幅 **≤50%**（例如 6K→9K）；若目标为翻倍以上，必须 **多轮**，每轮后执行 §5。
- **Prompt 硬约束**：扩写指令中必须包含 **不少于 N 字符**（N 为数值），且 N 来自 `expansion-plan`，非模型估算。

### 4.1 扩写 Prompt 清单（P0，结构化四要素 — 复盘 F-P0-4）

每条扩写任务**必须**显式写出（可粘贴进对话或写入 `.fbs/expansion-batch-prompt.md`）：

1. **全书/阶段总目标**：目标总字符区间或全书目标（来自 expansion-plan / author-meta）。  
2. **本轮目标**：本轮只扩哪些章、每章下限字符（来自 `expansion-word-verify` 口径）。  
3. **达标判断**：单章「实际 ≥ 目标×90%」；全书以 `chapter-status` 与脚本实测一致为准。  
4. **自动终止条件**：本轮计划内各章均达标，或用户喊停 / 门禁失败退出；**禁止**无终止条件的「持续扩写到满意」。

另须包含：**新增内容清单**（到小节级）、**必须保留的原文要素**、**语言风格与术语**、**与相邻章边界**（见 expansion-plan）。

---

## 5. 字数验证（P0 — 禁止凭感觉报数）

1. **写入后**必须用工具测量 UTF-8 字符长度（与复盘报告一致）：
   - `node scripts/expansion-word-verify.mjs --book-root <根> --file <相对或绝对路径> --target-chars <N>`
   - 或对计划内多章：`node scripts/expansion-word-verify.mjs --book-root <根> --from-plan .fbs/expansion-plan.md`
2. **对外报告中的字数**（对用户/对台账）**必须**来自上述脚本或等价 `fs.readFileSync` 测量，**禁止**仅使用模型心算字数。
3. **交付判定**：实际字符数 **≥ 目标 × 90%** 方可视为「本轮扩写达标」；低于 90% 记为 **扩写未完成**，须继续扩写或说明原因。
4. **偏差告警**：若声称字数与实测偏差 **>20%**，必须标记为 **数据异常**，并优先复测文件是否被截断 / 未保存。

---

## 6. 扩写后质检（闭环）

最低：**S + P** 层（`quality-auditor-lite` 等）；推荐：**S + P + C**（事实与出处、MAT 标注）。

- 新增事实性内容（数据、引语、案例）须有 **`[MAT-xxx]`** 或素材库可追溯标注；否则标为「作者观察」「行业共识（待补证）」。
- **B 层**：关注与 **相邻章** 论点重复（扩写后抽检）。

---

## 7. 台账与中断恢复

| 项 | 要求 |
|----|------|
| **chapter-status.md** | 每章扩写达标并验证后 **立即** 更新字数、状态、最后更新时间（**硬性步骤**） |
| **用户取消并行任务** | team-lead **扫描**目标文件 → 对比备份或 `.expanded` 临时稿 → **汇报差异** → 由用户决定是否回滚；禁止假设「未修改」 |
| **中断续写** | 在 `.fbs/next-action.md` 或会话摘要中记下 **断点**（章文件 + 已写入/未写入段落）；下次从该文件继续，禁止从无关章节重开 |

---

## 8. 与 ESM / S4 的衔接

- 建议在 `.fbs/esm-state.md` 中显式标记 `phase: S3.5_expansion`（或与现有枚举兼容的备注），直至扩写计划内各章均 §5 达标。
- **进入 S4 前**：须满足 `workflow-s3-closure.md` 原条件，且扩写阶段若已启用，**expansion-plan 内章节点均为达标或已登记例外**。

---

## 9. 相关脚本

- `node scripts/verify-expansion-plan-structure.mjs --book-root <根>` — **计划结构**门禁（必备章节、机读表、用户确认区；`--strict` 要求已勾选确认）  
- `node scripts/expansion-word-verify.mjs` — 字数实测与计划批量校验  
- `node scripts/quality-auditor-lite.mjs --book-root <根>` — 扩写后最低层质检入口  
- `node scripts/sync-chapter-status-chars.mjs --book-root <根>` — 按磁盘真值刷新 `chapter-status.md` 字数列（P2）
- `node scripts/runtime-nudge.mjs --book-root <根>` — 结合 `esm-state` 与复盘项生成本轮必做/可选提醒（`.fbs/runtime-nudges.json`）
- `node scripts/retro-to-skill-candidates.mjs --book-root <根>` — 将未修复整改项提炼为流程沉淀候选（`.fbs/retro-skill-candidates.json`）

---

## 10. 叙事门控与外部范式对标（v2.1.1）

- **四类门控**（Pre-flight / Revision / Escalation / Abort）、**Wave 语义**、**修订熔断**、**读者验收 vs 机检**：见 [`references/05-ops/fbs-narrative-gates-and-parity.md`](../05-ops/fbs-narrative-gates-and-parity.md)。  
- **叙述 CONTEXT 冻结**（对标「讨论阶段」产出）：`.fbs/narrative-context.md`（`init-fbs-multiagent-artifacts` 可生成空壳）；完整模板见 [`references/05-ops/template-narrative-context.md`](../05-ops/template-narrative-context.md)。  
- **读者验收清单**（机检通过后）：[`references/05-ops/template-reader-uat-checklist.md`](../05-ops/template-reader-uat-checklist.md)。

返回：[`workflow-s3.md`](./workflow-volumes/workflow-s3.md) · [`SKILL.md`](../../SKILL.md)

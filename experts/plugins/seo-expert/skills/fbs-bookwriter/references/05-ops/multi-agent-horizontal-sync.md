# 多智能体横向协同（架构模式 · 磁盘协议）

**版本**：2.1 · **优先级**：P2（宿主层；不替代主编仲裁）

> **编排总策略**（风格一致 · 防断链 · 质量优先 + 信号弹性）：见 [`agent-task-strategy.md`](./agent-task-strategy.md)。本文侧重**磁盘协议与写入边界**；与前者配套使用。

## ⚠️ 多智能体正文写作：默认不推荐

**除非用户明确要求，FBS-BookWriter 不主动建议用多智能体进行正文写作。** 被要求时，须先向用户说明以下风险：

| 风险类型 | 说明 |
|---------|------|
| 风格不一致 | 各智能体语言风格、叙述密度、句式偏好差异，合稿后需大量打磨 |
| 衔接边界难对齐 | 章节交界处的逻辑过渡、引用回指、前情摘要难以自动对齐 |
| 智能体失响 | 某个成员卡顿/超时将导致该批次空洞，影响整体进度和连贯性 |
| 协调成本高 | GLOSSARY 冲突、重复内容、编号体系分歧均需主编人工仲裁 |

> **适合多智能体的任务**：策划（大纲拆解、市场定位）、校对（术语核查、格式审计）、审核（质量门禁、一致性检测）——这类任务有明确边界、可并行、不依赖叙事连贯性。
>
> **正文写作建议**：优先使用单会话串行模式；仅当章节间依赖关系已明确且用户知悉风险后，才启用多 Writer 并行。

## 架构模式选择

| 模式 | `project-config.json` | 适用场景 |
|------|----------------------|---------|
| **单会话串行**（默认推荐） | `multiAgentMode` 可视为单 Writer | 多数场景；见 SKILL §3 指针 |
| **多 Writer 并行** | `parallel_writing` | 用户明确要求且已知悉上述风险；须维护 `.fbs/chapter-status.md`、依赖图、心跳 |

> **多智能体零横向通信风险**：依赖**磁盘真相源** + `send_message` / 主编调度，勿信口头「都写完了」。  
> 话术与编排：[`workbuddy-agent-briefings.md`](../01-core/workbuddy-agent-briefings.md) · [`session-protocols.md`](../01-core/session-protocols.md)

## 原则

多 Writer **不以对话为 SoT**，以**本书根下磁盘文件**为唯一可合并真值。Coordinator 只分发路径与门禁，不假设其他成员「已读过同一段对话」。

## 写入边界

| 工件 | 约定 |
|------|------|
| 章成稿 | 每人仅写分配章节路径；禁止覆盖他人文件除非走合稿分支流程。 |
| `.fbs/search-ledger.jsonl` | **追加** JSONL；冲突字段用新行说明更正，不原地篡改历史行（便于审计）。 |
| `.fbs/writing-notes/{chapterId}.brief.md` / `report-brief.md` | 由 `fbs-writer` 或 `team-lead` 维护，作为章节 / 报告写作简报；researcher 不得覆盖。 |
| `.fbs/writing-notes/*-research.brief.md` | researcher 独占；仅写研究摘要、检索发现和证据备注。 |
| `.fbs/writing-notes/*-draft.md` | writer 独占；仅写起草备注、段落实验和重写草稿。 |
| `术语锁定记录.md` | 主编或单一「术语 Owner」合并；Writer 只追加「建议」或 PR 式说明节。 |
| `pending-verification.md` | 各 Writer 可追加 `- [ ]` 项；清零责任在主编或 S5 前 CLI。 |


## 最小同步清单（每轮并行写前）

1. 本书 `FBS_CONTEXT_INDEX.md` 或主编指定的 Brief 路径已更新。  
2. `search-policy.json` 当前体裁与检索阶段无异议。  
3. 本章 `[S3]*.md`（若存在）与 `Chapter Brief` 文件名、章节 ID 一致。  
4. 引用格式与数据源索引约定与 `citation-format.md` 一致（避免合稿时双轨脚注）。

## 冲突处理

- **内容冲突**：上升 Critic / Arbiter（见 `coordinator-arbiter-briefs.md`），**输出落盘**到 `writing-notes/` 决议摘要，再改正文。  
- **工具未跑**：以 `search-policy.json` 中 `p0AutomationIndex` 为准；声称「已过门禁」须对应命令与退出码 0。

## 与执行契约关系

见 `references/01-core/execution-contract-brief.md`（宿主职责与磁盘 SoT）。

---

## M3 规模适用说明

当书籍规模达到 **M3（>100万字，≥50章）** 时，多智能体协同面临更高的调度压力：

| 约束 | M3 建议 |
|------|---------|
| 并行 Writer 数量 | ≤ 4 个（超出时调度开销 > 收益） |
| 心跳检查频率 | 每 30 分钟 Coordinator 主动巡检一次 `chapter-status.md` |
| 合稿策略 | 以「编」为单位分批合稿（每 10 章一批），而非全书一次合稿 |
| 素材库冲突 | M3 必须启用 `search-ledger.jsonl` 追加锁（避免多 Writer 并发写入撕裂） |
| 磁盘 SoT 强化 | 禁止 Writer 间口头传递「我已写完」——所有状态以 `chapter-status.md` 为唯一可信源 |

> **参考**：[`large-scale-book-strategy.md`](./large-scale-book-strategy.md) M3 章节；[`search-policy.json`](./search-policy.json)（含 `p0AutomationIndex`）多智能体 CLI 列表。

---

## Skill 2.0.1 审计协同改进基线（7项一次性落地）

> 适用范围：WorkBuddy/CodeBuddy 的 Team 场景（审计、巡检、质检）
> 入口导航：[`SKILL.md`](../../SKILL.md) · [`platform-ops-brief.md`](./platform-ops-brief.md)
> **补充说明**：Team 模式原生就是为并行设计；锁、隔离与 shutdown 协议的目标，是保护共享写路径、可恢复性与审计一致性，而不是否定并行能力本身。

### 1) 只读并行 + 写入隔离（P0）


- 审计任务默认 `type: read-only`，只允许读取与消息输出。
- 仅 `type: write` 允许写盘，且必须写到隔离目录：`{team_dir}/output/{agent_id}/`。
- 任何跨 agent 共用工件（如报告汇总）由 `team-lead` 单点写入，禁止多 agent 竞争写同一路径。

### 2) 结构化任务模板 + 职责去重（P0）

统一使用模板分配任务，禁止自然语言自由发挥式派单：

```yaml
task:
  id: audit-references
  type: read-only
  scope: ["卷一~卷十", "附录B"]
  excludes: ["字数统计", "编号检查"]
  deliverable: "message+report"
  timeout: "15m"
  maxRetries: 1
```

调度器需在派发前执行：
- `scope` 重叠检查
- `scope` 与 `excludes` 冲突检查
- 缺字段阻断（`id/type/scope/excludes/deliverable/timeout`）

**与单会话写作契约对齐（P0）**：并行前由 `team-lead` 核对本书 `.fbs/project-config.json`（`targetWordCount`、`plannedChapterTotal`、`outlineFreezeVersion` 等）与团队快照一致；扩 scope 须同步 [`outline-freeze.md`](../01-core/outline-freeze.md) 变更单，避免多 agent 在过时大纲下分头写作。

### 2.1 扩写/精修合流检查（team-lead 必做）

- [ ] 各并行路已读 **同一** `book-context-brief.md` + `术语锁定记录.md`（+ 品牌约束若适用）。  
- [ ] 临时稿为 `*.expanded.md` 或隔离目录；合流前 **`node scripts/expansion-word-verify.mjs`** 与 **S+P 质检**。  
- [ ] 合并正式稿后 **`chapter-status.md`** 由 **单点 Owner** 更新。  
- [ ] 可选：`node scripts/adjacent-chapter-similarity.mjs` 对相邻章做重叠预警。  
- [ ] 可选：`node scripts/merge-expansion-batch.mjs --book-root <根>` 列出待合并临时稿。  
- [ ] 合流留痕：`node scripts/merge-expansion-batch.mjs --book-root <根> --write-report` 或 `node scripts/write-merge-report.mjs …`，产出 `.fbs/last-merge-report.json`（规格见 `fbs-optimization-roadmap-spec.md` §P1-2）。

### 3) 结构快照缓存 + 批量读取（P1）

- 并行会话启动前，由 `team-lead` 生成结构快照：`meta/全书结构快照.json`。
- 内容至少包含：文件树、章节编号、字数统计、最近修改时间。
- agent 首轮优先读取快照，不重复全盘扫描。
- 允许批量读取接口（如 `batch_read(paths[])`），减少逐文件往返。

### 4) 超时 / 重试 / 部分结果保底（P0）

- 每个 agent 必须有 `timeout` 与 `maxRetries`。
- 超时状态标准化为 `timeout`（区别于 `failed`）。
- 超时后必须提交 `partial` 结果（至少包含已完成范围、未完成范围、风险说明）。
- 允许单次重试；重试后仍超时则强制收束并交付 partial。

### 5) shutdown 协议标准化（P1）

统一状态流：
- `running -> stopping -> stopped`（正常）
- `running -> stopping -> timeout -> terminated`（超时）

统一消息字段：
- `requestId`
- `reason`
- `partial`
- `timestamp`

约束：`shutdown_request` 发出后，30s 内无响应即强制终止并归档现场。

### 6) 生命周期治理（P2）

- 每次会话写入运行目录：`.fbs/audit-runs/{runId}/`
- 维护索引：`.fbs/audit-runs/index.json`
- 默认保留 30 天；超期自动清理。
- 团队结束后应执行归档/清理，避免历史团队目录持续膨胀。

### 7) artifact 路径策略透明化（P0）

- `isArtifact=true`：仅允许写入 `brain/<conversation-id>/`
- `isArtifact=false`：允许写入 workspace（用于项目交付物归档）

执行前置校验（必须）：
- 目标路径是否合法
- 当前模式是否匹配（artifact/workspace）
- 失败时返回“原因 + 正确路径 + 修复动作”，避免盲目重试

> 审计报告标准归档目录建议：`<book-root>/.fbs/` 或 `<book-root>/meta/`（workspace 模式）。

---

## Skill 2.0.1 执行清单（S3 / S5 可直接复用）

### S3 并行审计前（启动清单）

- [ ] 按结构化模板完成任务分配（`id/type/scope/excludes/deliverable/timeout/maxRetries`）。
- [ ] 明确 `read-only` 与 `write` 任务，`write` 任务已分配隔离目录。
- [ ] 生成并广播结构快照：`meta/全书结构快照.json`。
- [ ] 完成任务重叠检查并处理告警（重叠项需写明责任边界）。
- [ ] 确认输出模式：artifact 或 workspace；模式与归档目标一致。
- [ ] **全景质检阶段串行策略**：先 `S层`，通过后再 `P/C/B`；默认同层仅 1 个子任务。
- [ ] **子任务上限参数**：建议 `timeout=15m`、`maxTurns=12`、`maxRetries=1`（超时必须交付 partial）。
- [ ] **启动可见性**：派发后立即向用户回报「阶段、范围、预计耗时、超时上限」。

### S3 执行中（运行清单）

- [ ] 每个 agent 按心跳阈值更新状态（参考 `platform-ops-brief.md`）。
- [ ] 超时任务进入 `timeout` 状态并提交 `partial` 结果。
- [ ] 若 `shutdown_request` 30s 无响应，执行强制终止并记录原因。
- [ ] 禁止跨 agent 共享写路径；公共报告仅由 `team-lead` 汇总落盘。

### S5 终审前（收束清单）

- [ ] 汇总报告归档到 `.fbs/` 或 `meta/`（workspace 模式）。
- [ ] 运行索引更新：`.fbs/audit-runs/index.json`。
- [ ] 记录本次 runId、超时数、重试数、partial 数。
- [ ] 对未完成项形成可追踪待办（禁止口头“已完成”）。

### S5 结束后（治理清单）

- [ ] 运行目录落盘：`.fbs/audit-runs/{runId}/`。
- [ ] 执行保留策略：清理超过 30 天历史运行目录。
- [ ] 复核 7 项基线是否全部生效并更新会议纪要。

## 结果落盘规范

> 适用于并行质检、巡检、审校等“结果可能超过对话返回上限”的场景。

1. **子智能体完整结果必须先落盘**：优先写入 `{bookRoot}/.workbuddy/memory/qc-{taskId}.md`。
   - 裸仓库场景也可用，不依赖 `.fbs/`
   - 若目录不存在，由主智能体或子智能体先创建
2. **返回值只发摘要**：子智能体回复中只保留 `文件路径 + 综合结论 + P0/P1 问题数`，不要直接粘贴完整报告。
3. **主智能体再读取完整结果**：主智能体用 `read_file` / `open_result_view` 消费落盘文件，不把长报告塞进消息通道。
4. **中断恢复依赖落盘文件**：恢复时先扫描 `.workbuddy/memory/qc-*.md`，跳过已完成范围。
5. **禁止行为**：
   - ✗ 禁止把完整质检报告直接放进子智能体返回值
   - ✗ 禁止把裸仓库任务结果只写进 `.fbs/`
   - ✗ 禁止多个子智能体竞争写同一个结果文件

## 失响、超时与恢复（WorkBuddy 运行态）

并行或 Sub-Agent 执行时，**失响**（无输出超时）、**部分返回**（partial）均可能发生。主编（team-lead）应：

1. **以磁盘为准**：优先检查 `.fbs/chapter-status.md`、分配路径上的成稿文件是否落盘，勿仅依赖对话中的「已完成」。  
2. **超时策略**：长任务应设超时并允许 partial；向用户说明已完成范围与待补范围（与 SKILL「超时与收束」一致）。  
3. **重试**：同一章节重复派发前，先读现有文件再决定覆盖或续写，避免并行写同一路径。  
4. **宿主侧**：若 WorkBuddy 提供任务队列/心跳，应与 `shutdown_request` / 心跳协议（见上文章节）对齐；无队列时退化为 **串行重试**，体验变慢但语义更安全。





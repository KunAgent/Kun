# 宿主平台多智能体委托话术（S3 / S5）

> **平台适用范围说明（v3.2）**：
> - 本文件仅描述 **WorkBuddy** 场景下的委托话术；正式发布物已拆分为 WorkBuddy / CodeBuddy 双通道。
> - 宿主真值统一来自 `scripts/host-capability-detect.mjs`：读取 `~/.workbuddy/settings.json` 与 `~/.workbuddy/skills-marketplace/skills/`。
> - 详见 [`brand-platform-convention.md`](./brand-platform-convention.md)。


> **⚠️ 重要：多成员模式选用说明**：以下话术适用于 WorkBuddy 中已支持 Agent Teams / Sub-Agent 的场景。Full Team 本身可直接使用；是否采用并行，取决于任务拆分、写入隔离、心跳与交接设计，而不是宿主“不支持并行”。
>
> **⚠️ 正文写作默认不主动推荐多智能体**：除非用户明确要求，不主动建议用多 Writer 并行写作。被要求时须先提示风险：①各 Writer 风格不一致；②章节衔接边界难对齐；③某成员失响会导致整体缺口。详见 [`multi-agent-horizontal-sync.md`](../05-ops/multi-agent-horizontal-sync.md)。
>
> **✅ 非写作任务（策划/校对/审核）**：多智能体可用于策划（大纲拆解）、校对（术语核查）、审核（质量门禁）等有明确边界的任务。**主智能体（team-lead）负责统筹规划和协同期间信息协调**，分配任务、收集结果、解决冲突，不允许 Writer 自行修改 GLOSSARY 或 chapter-status。
> **✅ 任务-智能体映射（新增硬规则）**：探索 / 审计 / 扫描 / 定位 → 只读成员或 `code-explorer`；修复 / 替换 / 写入 → team-lead 或可写成员执行，**不要**把 `code-explorer` 用在最终修复落盘上。
> **✅ 结果返回约束**：若任务结果可能超过 200 字，必须先把完整结果写入 `deliverable` 指定路径，消息体只返回短摘要。
>
> **✅ 编排策略（单线/多线/质量优先）**：全书风格与防碎片以 **Brief + GLOSSARY + session-resume-brief** 为锚；多智能体防断链以 **磁盘真值 + 超时 partial** 为准；过程调度见 [`agent-task-strategy.md`](../05-ops/agent-task-strategy.md)。


>
> **执行约束全文**：见 [`skill-authoritative-supplement.md §宿主集成指南`](./skill-authoritative-supplement.md)、[WorkBuddy 官方说明](https://www.codebuddy.cn/docs/workbuddy/Overview)
>
> **用途**：给想在 WorkBuddy 中通过自然语言协调多任务时使用的轻量委托话术；**不**执行 API。
>
> **技能生态（v3.2 重要）**：
> - **WorkBuddy 环境**：本地预装技能市场（`~/.workbuddy/skills-marketplace/skills/`）作为 Tier1，已启用插件作为 Tier2；优先本地市场，其次插件，最后远程发现。
> - 运行时平台检测：`Test-Path ~/.workbuddy/skills-marketplace`，并继续读取 `settings.json` 确认可用插件。
>
> **关键 WorkBuddy Tier1 技能（可直接探测）**：

> - `deep-research`：`/research`→`/research-deep`→`/research-report` 三步结构化调研，替代 playwright 作为 S0 主引擎
> - `multi-search-engine`：17 引擎聚合（8 国内 + 9 国际），中文书稿自动启用
> - `citation-manager`：Crossref API 学术引用，APA/MLA/Chicago/GB-T 多格式，学术类书籍必备
> - `minimax-docx`：OpenXML SDK 打印级 Word，优于通用 docx 插件（Tier2 降级用）
> - `minimax-pdf`：token 设计系统印刷级 PDF，优于通用 pdf 插件（Tier2 降级用）
> - `content-ops`：专家面板评分，递归迭代至 90+ 分，增强 S4 质检门禁
> - `agent-team-orchestration`：角色定义/任务流转/交接协议，可增强福帮手自身编排
>
> **多 Agent 说明（v3.2）**：WorkBuddy 通道支持 Sub-Agent（`.codebuddy/agents/*.md` 声明式定义）和 Agent Teams（`team_create`/`send_message`）。S3/S5 可直接使用 Team API；正文写作默认建议逐章委派或由 team-lead 控编，若用户明确要求且章节边界清晰，也可直接启用 Full Team。关键约束是编排与写入边界，而不是禁止并行。


>
> **角色扮演注意**：team-lead 统筹规划和信息协调；Writer 不得自行修改 GLOSSARY 或 chapter-status。

---

## 核心 CLI 快查（启路流程 P0）

| 用途 | 命令 |
|------|------|
| 构建虚拟书房（初始化 `.fbs/` 内部台账层 + `deliverables/` 交付层 + `releases/` 发布准备层） | `node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根>` |

| 扫描实际章节 vs 预期章节 | `node scripts/sync-book-chapter-index.mjs --book-root <本书根> --json-out .fbs/chapter-scan-result.json` |
| 章节调度提示展示 | `node scripts/chapter-scheduler-hint.mjs --book-root <本书根>` |
| 禁止混合引注格式 | `node scripts/citation-format-check.mjs --skill-root <技能根> --chapter-file <章节.md>` |
| 术语写法一致性 / `--strict` 强制 GLOSSARY | `node scripts/terminology-gate.mjs --skill-root <技能根> --book-root <本书根> --chapter-file <章节.md>` |
| 成员实时巡检 | `node scripts/heartbeat-monitor.mjs --book-root <本书根> --emit-actions`（约 2m 预警 / 5m ping / 10m shutdown / 15m critical / shutdown 后 30s 强制终止） |
| 失败任务重试队列 | 见 `.fbs/task-queue.json` 查看失败任务并手动重试 |
| 工件缺失时即时核验 | `node scripts/verify-expected-artifacts.mjs --book-root <本书根>`，可选 `--expect-s0` / `--expect-chapter N` / `--since-minutes` / `--strict` |

---

## S3 写作前 team-lead 必做（启动前检查）

每次开始新一批章节写作前，先完成虚拟书房构建并校验：


```bash
node scripts/init-fbs-multiagent-artifacts.mjs --book-root <本书根>
```

确认生成以下底座与工件（缺失时加 `--force` 重建）：
三层底座：`.fbs/`、`deliverables/`、`releases/`；
基础工件：`.fbs/chapter-status.md`、`chapter-status.md`、`chapter-dependencies.json`、`GLOSSARY.md`、`book-context-brief.md`、`search-ledger.jsonl`、`project-config.json`、`member-heartbeats.json`、`task-queue.json`、`rate-budget.json`、`high-quality-domains.json`、`material-library.md`、`author-meta.md`、`insight-cards.md`、`目录.md`、`规范执行状态.md`、`esm-state.md`、`writing-notes/pending-verification.md`；
扩展工件：`material-inventory.md`、`work-intelligence.md`、`reader-language.md`、`story-bank.md`、`sessions-summary.md`、`sessions/`；
运行时 S6 产物：`.fbs/[S6]-content-units.md`、`.fbs/[S6]-product-roadmap.md`、`.fbs/[S6]-release-map.md` 与 `releases/<chapterId>-release.json`。

---

## 协同角色（P0 级，建议每 07 轮主动应用）

分配 S3 写作成员时，team-lead 应（可在同一个会话分配职责；没有扮演时临时由 team-lead 兼任，并在 `.fbs/project-config.json` 中说明）：

1. **术语联络员（Glossary liaison）**：维护 `.fbs/GLOSSARY.md`，有应同步的写法时 `@` 询问，跑 `terminology-gate.mjs` 核查。
2. **数据引用联络员（Data / citation liaison）**：维护 `book-context-brief.md` 摘录，跑 `citation-format-check.mjs` 核查。

通过 `send_message` 联系 Writer，**不得** team-lead 转每一条；team-lead 保持每批次台账权限。

---

## S3 Writer 执行前必须读取的上下文（逐条核对，team-lead 检查）

按 **S2 目录** 与 `.fbs/chapter-dependencies.json` 中的 **dependsOn** / **batch** 分组，跑 `chapter-scheduler-hint.mjs` 了解顺序、依赖、缺口：

1. **批次 1**：只能单章串行，防止 GLOSSARY 冲突
2. **批次 2+**：写前确认前批章节 **chapter-status 为已完成** 才可并行
3. 每位 Writer 启动时读取：
   - 当前 **Writer 上下文粘贴板（强制）**
   - `citation-format.md` 摘要路径
   - `.fbs/GLOSSARY.md` 路径
   - **写完章节** 后更新 `chapter-status.md` + `book-context-brief.md` 向 team-lead 汇报

**上下文粘贴板**：成员→team-lead，建议每9轮提供阶段进度：

```text
[章节名称]
目标字数：
参考路径：
内容约束：
chapter-status.md 核验：是/否
book-context-brief.md 核验：是/否
词表核查（GLOSSARY/10条以上）：
S质检/警告 / 未扫
引用来源是否标注：是/否
阶段动作写法 OPC 是否对齐 GLOSSARY / 否/未查
去AI味核查（quality-AI-scan 模式）：通过 / 未跑（未跑请说明原因）
```

---

## Writer 上下文粘贴板（强制粘贴给每位 Writer）

> **建议每 09 轮**：team-lead 发送以下粘贴板给 Writer；模板 **每次**，未完成时装载全量摘要。

```markdown
## 当前角色：写作前必做项（前置核查）

1. **S 层（句级核查，写作前必跑）**
   - **长句检测**：A/B/C 层见 `quality-S.md` → 全章扫描，B 层 buzzword **占比为 0**
   - **S6 去AI味**：全章节 `破折号（——）` 密度 **>1 个/千字** 时执行 `quality-S.md` S6、AI 味替换模式（换词/换句/调结构/重写段落等）
   - **句长**：不超 40 字（超 40 句占比 **<10%**），否则拆句
   - **AI味**：使用 `references/02-quality/quality-AI-scan.md` 规则扫描并修正
2. **P 层**：`quality-PLC.md` 中C4 → 禁止无来源数据，确认引用比例，来源写法符合实际
3. **C 层**：`citation-format.md` 中 A 格式：行内注 + 章末 **## 参考来源列表**，交前跑 `citation-format-check.mjs`
4. **术语**：`.fbs/GLOSSARY.md` → 有新写法时 `@` 询问确认
5. **搜索**：有已开始的 `.fbs/` 时，`enforce-search-policy.mjs` 确认搜索达到 L2 标准，以 `search-policy.json` 为准
6. **状态 UI**：写前确认 **`[S3-Ch章]`** 对应 md 文件内容为 **非空白内容**，若 WorkBuddy 展示工具调用失败 unknown，以**磁盘为准**，必要时运行 `node scripts/verify-expected-artifacts.mjs --book-root <本书根> --expect-chapter <N> --strict`
```

---

## S3 写作完成后台账核查

为确保每批章节正确完成，S3 结束后 WorkBuddy 宿主执行核对：

1. **成员 A（文字 / G 层）**：见 `references/02-quality/quality-S.md` 逐条核查；**联网全文**时 **G4 默认联查**（检索来源见 `citation-format.md`）
2. **成员 B（数据核 / P 层）**：见 `references/02-quality/quality-PLC.md` P 层数据渭指。
3. **成员 C（结构 / C 层）**：见 `references/02-quality/quality-PLC.md` C 层结构，含 **C5 扩展**

成员完成后各自输出台账报告；**C0 未通过不得同步通过**，见 `quality-check.md` C0、`section-3-workflow` **S5-G5** 一致。

---

## 多轮超时 SOP（成员长时间无响应时）

成员应定期写入 `.fbs/member-heartbeats.json`，team-lead 定时检查各成员 `lastHeartbeat` 时间，执行以下 SOP：

| 无响应时长 | team-lead 动作 |
|------------|----------------|
| ~2 min | 预警（WARN），记录状态，提示成员继续 |
| ~5 min | `send_message` 发送 PING |
| ~10 min | 发送 `shutdown_request`，准备接管 |
| ~15 min | 升级 CRITICAL，停止等待成员，启动接管 |
| `shutdown_request` 后 30s 未响应 | 强制终止（force terminate），记录台账 |

---

## 角色广播话术（粘贴给每位 Writer）

```markdown
## 写作约束（强制）

- 引注格式使用 `citation-format.md` **A 格式**：行内注格式；章末需加《## 参考来源列表》（C 格式文末）
- 每章末尾补充 **## 参考来源列表**（C 格式完整）
- 搜索执行后补 `## 搜索执行记录` 与 frontmatter `fbs_search_queries: N` 及 `.fbs/search-ledger.jsonl`（见 `enforce-search-policy.mjs`）
- 全章节内容引用枚举只用标准格式 `[1]`、`参考来源`，不加无关的行内注
```

---

## S5 台账核查

为确保每批章节 S5 终审正确核对：

1. **成员 A（篇章 B 层）**：见 `references/02-quality/quality-PLC.md` B 层篇章完整性核查
2. **成员 B（视觉引注）**：见 [`08-visual.md`](../03-product/08-visual.md) 中 3 个以上图/图表的视觉约束
3. **成员 C（全书 C0 + CX）**：见 [`book-level-consistency.md`](../02-quality/book-level-consistency.md) 执行 **C0-1 / C0-2 / C0-4**；**联网全文**时执行 [`cross-chapter-consistency.md`](../02-quality/cross-chapter-consistency.md) 全书 **CX** 核查

成员完成后各自提交台账报告；**C0 未通过不得同步通过**，见 `quality-check.md` C0、`section-3-workflow` **S5-G5** 一致。

---

## v2.0.1 新增：会议机制 / 扩展路径 / 角色卡 / 会话摘要

> **使用说明**：v2.0.1 新增的散-聚循环会议机制，细节见 [`references/01-core/session-protocols.md`](./session-protocols.md)
> **使用方式**：以下话术仅供应对复杂 WorkBuddy 任务时使用，不要逐条朗读；仅在需要协调分工时使用
> **关于 P0**：每轮对话前准备好 ≤500 字的会话简报（格式见 `sessionProtocols.sessionBriefFormat`），追加到 `.fbs/sessions-summary.md`

---

### 会议机制（S1 主题定位前）

> **使用时机**：路径B（情报收集）、路径C（探索驱动）且在 S1 主题定位前执行
> **目标**：把散选主题聚焦，提升内容差异效应，降低框架冗余（详见 §8 会议机制）

```markdown
## 会前准备：邀请 3 位 Agent

**你的职责**：分析本书可能方向与竞争格局
- 主题/定位：{约20字}
- 背景说明：{约100字，描述想写什么、为什么写}
- 差异目标：把散选主题聚焦到业内空白点，约 1-2 个方向
- 禁止：不要做全量结构写作细节，留到 S1/S2

---

### 角色A（定位者）

你的任务是从竞争格局定位本书差异化亮点：
- 要求两个以上的切入角度和框架案例
- 建议 2 轮以内的常规同主题对标书
- 说明你认为聚焦某方向的差异化在哪里？没有这角度为什么无人写？
- 禁止发散收获结论之前角色结案

---

### 角色B（读者画像者）

你的任务是从业务链条的专业度和阶段性聚焦读者需求：
- 聚合读者画像，从某角度与业务结构
- 建议 2 轮以内明确读者群体，写出具体角色
- 说明你认为聚焦这方向的书为什么读者要看本书？参考什么？
- 禁止发散收获结论之前角色结案

---

### 角色C（批评者）

你的任务是找出当前选题框架缺陷，防止内容空洞：
- 找出选题三个以上潜在框架缺失
- 建议 2 轮以内锁定一个有争议的角度
- 说明你认为聚焦这方向的选题框架缺少什么知识？如何解决本书？
- 禁止发散收获结论之前角色结案

---

### 收拢阶段：主编/team-lead 执行

1. 收集三个角色结案，禁止删减任何结案
2. 比较三角色结案，选出 1-2 个潜在角度，说明选取原因
3. 整合综合，选取 1-2 个最佳潜在角度，写入 `.fbs/sessions/creative-session.md`
4. 追加到 `.fbs/sessions-summary.md`，格式 | 时间 | 主题方向（约3句）| 已执行动作
```

---

## S3 启动 P0 强制步骤

> ⚠️ 本区块优先级高于上方原有「S3 写作前 team-lead 必做」。
> 步骤严格串行，每步通过后才进入下一步，任何步骤失败均不得继续。

### 步骤 0（P0）：运行 S3 启动门禁 ← 物理第一步，不可跳过

**宿主支持 CLI 时**：
```bash
node scripts/s3-start-gate.mjs \
  --skill-root <技能根> \
  --book-root <本书根> \
  --mode parallel_writing \
  --verify-stages \
  --audit-term-enforce
```
- 退出码 = 0：继续步骤 1
- 退出码 ≠ 0：❌ 禁止继续。查看中文修复说明，逐项修复后重新运行步骤 0
- 帮助中心：https://fbs-bookwriter.u3w.com/help/s3-gate

**宿主为对话模式时** ← 显式降级声明，非物理阻断：

> ⚠️ 当前宿主为对话模式，守卫以口头核查形式执行（非物理阻断）。

- [ ] S0 search-ledger 有 S0 阶段记录（或有 offline-degraded 声明）
- [ ] genreLevel / genreTag 已写入 project-config
- [ ] S2.5 清单已核销（或显式风险接受）
- [ ] 所有目标章节有 `.fbs/writing-notes/{chId}.brief.md`（非空，≥200字符）

核查完成后在 `.fbs/esm-state.md` 写入：
`[S3门禁口头核查] {ISO时间} | 结果：通过/部分通过（说明缺口）`

---

## Writer 完成条件（两阶段，P0）

> 优先级高于上方原有 Writer 完成判定说明。

### 阶段一：Writer 自验（章节初稿完成后立即执行）

1. **字数检查**：章节字数不低于 Chapter Brief 中约定的目标字数
2. **结构检查**：章节包含 Brief 要求的所有必要段落/小节
3. **术语检查**：运行术语门禁（若有 GLOSSARY.md）
   ```bash
   node scripts/terminology-gate.mjs --book-root <本书根> --chapter-file <章节文件>
   ```
   - 通过 → 继续阶段二
   - 有违规且 --strict 未开启 → 记录警告，继续阶段二，但须在 esm-state.md 标注
4. **S层质检（可选，推荐）**：
   ```bash
   node scripts/quality-audit-incremental.mjs --book-root <本书根> --chapter-file <章节文件>
   ```
   - 脚本不存在时：输出 `[S质检] 脚本不存在，跳过（待脚本就绪后补跑）` 并继续
   - 质检结果同步写入 `gate-run-log.jsonl`（若 s3-start-gate 已初始化该文件）

### 阶段二：team-lead 收尾（所有 Writer 完成阶段一后）

1. **章节状态更新**：将 `chapter-status.md` 中对应章节标记为 `[初稿完成]`
2. **Brief 核销**：确认 Chapter Brief 中的核心议题已被覆盖，在 Brief 文件末尾追加：
   `[Brief 核销记录] {ISO时间} | Writer: {角色名} | 核销结论：覆盖完整/有缺口（说明）`
3. **esm-state.md 推进**：若全部目标章节初稿完成，将 `currentState` 推进到下一阶段
4. **sessions-summary.md 记录**：追加本轮写作摘要
5. **验收失败处理**：如上述任一步骤失败，禁止推进 esm-state，须向 team-lead 上报
   - 帮助中心：https://fbs-bookwriter.u3w.com/help/chapter-verify

---

## 多智能体改进基线执行规则（P0）

> 对应 `platform-ops-brief.md` §4.4 一次性全面落地验收（7 项）中尚缺项的执行规则。

### 基线①：结构化任务模板（P0 必填字段）

派发给 Writer 的每个任务对象**必须包含**以下字段，缺失任一字段 team-lead 禁止下发：

```yaml
id: "ch01-draft"          # 唯一任务 ID（建议：章节名-动作）
type: "write"             # 任务类型：write | review | audit | read
scope: "chapters/ch01.md" # 操作范围（文件或目录）
excludes: []              # 显式排除路径（只读任务填 []）
deliverable: ".fbs/agent-results/ch01-draft.md"  # 完整结果或验收产物落盘路径
timeout: 600              # 超时秒数（超时须产出 partial 结果）
maxRetries: 2             # 最大重试次数
```

补充约束：
- `read` / `audit` / `review` 类型任务可使用只读成员，但 `deliverable` 必须是实际结果文件路径，返回值只保留 ≤200 字摘要。
- `write` 类型任务须同时声明 `isolatedTo`（写入隔离路径），防止并发写入冲突。
- 凡是修复 / 替换 / 批量改写，统一归入 `write` 类型，不得伪装成 `audit` 后再让只读成员落盘。


### 基线②：结构快照缓存（P1 启动阶段优化）

每轮 team-lead 启动前，**优先读取缓存快照**，避免重复全盘扫描：

1. 检查 `meta/全书结构快照.json` 是否存在且 `updatedAt` 在 30 分钟内：
   ```bash
   # 更新快照（chapter-scan-result 生成后同步）
   node scripts/sync-book-chapter-index.mjs --book-root <本书根> --json-out .fbs/chapter-scan-result.json
   ```
2. 快照存在且新鲜 → 直接读取，跳过全盘扫描
3. 快照缺失或超期 → 重新生成后缓存至 `meta/全书结构快照.json`

`meta/` 目录如不存在可自动创建；快照文件格式与 `chapter-scan-result.json` 保持一致。

### 基线③：artifact 路径策略透明化（P0 首次写入前必核）

每个成员在**首次写入任何文件前**，须确认路径归属：

| 文件类型 | 路径策略 | `isArtifact` |
|----------|----------|--------------|
| 过程性/临时产物（审计中间结果、会话草稿） | `brain/<conversation-id>/` | `true` |
| 项目交付物（章节 md、工件、台账） | workspace（`.fbs/`、`deliverables/`、`releases/`） | `false` |

路径校验规则：
- `isArtifact=true`：路径**必须**以 `brain/<conversation-id>/` 开头，否则拒绝写入
- `isArtifact=false`：路径**必须**在 workspace 白名单内（见 `security-fence.mjs` `filesystem.allowedPaths`）
- 首次写入失败须返回：失败原因 + 正确路径 + 修复建议（对应 `platform-ops-brief.md §4.1`）


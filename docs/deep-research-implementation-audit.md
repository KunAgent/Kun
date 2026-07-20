# Kun DeepResearch Implementation Audit

> Scope: this audit compares the current Kun codebase against the design in `/Users/rubick/Downloads/kun-deep-research-design.md`.
> The goal objective mentioned `/workspace/kun-deep-research-design.md`, but that path does not exist on this machine. The downloaded design file is the authoritative source used here.
>
> UI-specific implementation requirements from the design are intentionally deferred. UI is referenced only when it affects runtime/API boundaries.

## Executive Summary

Kun now has a P0 internal DeepResearch runtime foundation under `kun/src/research/`. It defines a dedicated runtime, state machine, brief approval gate, evidence ledger, citation resolver, basic verifier, artifact repository, HTTP routes, fake-data end-to-end tests, and a minimal feature-flagged UI. The renderer `/research <topic>` entry can create a run, show a scoped confirmation card, approve/cancel the run, show clear create/approve/run/completed states, and open the generated `report.md`.

This pass also adds a search-enhanced web worker path: each research task can generate multiple search queries from the confirmed brief and plan, run searches in parallel, fetch result pages, and then ask the extraction model to produce structured evidence. DeepSeek-hosted runtimes can use the DeepSeek Anthropic-compatible Web Search provider when an API key is available; failed or unavailable search falls back to the existing seed/fallback worker path.

The runtime now follows a hypothesis-driven supervisor loop. After `ResearchFrame` is confirmed, `BasicHypothesisProposer` creates candidate explanations, `BasicTestDesigner` turns them into falsifiable tests, and task selection uses value of information (VOI) rather than broad topical coverage. Each retained task must answer: "If this search succeeds, can it change the final judgment?" Worker evidence is then bound back to hypotheses, `BasicHypothesisAssessor` applies structured status updates, and `BasicConvergenceAnalyzer` decides whether the judgment has converged. `BasicCoverageEvaluator` still protects report completeness, but it no longer acts as the primary search objective.

The final `report.md` is now treated as a user-facing document, not an audit log. Internal run metadata, model judge details, `核心问题与回答`, and standalone `证据链` sections are kept out of the rendered report; evidence remains available through inline citation links and `.kun-research/*` artifacts.

Quality verification now uses a token-conscious loop: failed report attempts are retried from structured verifier/Judge feedback rather than by reinserting the previous full draft. The LLM Judge prompt is compacted to cited evidence and section-aware report slices, and the Judge stage requests concise JSON from the user-selected model instead of spending the output budget on reasoning prose. Completed research tasks may record `maxSources = 0` when no usable source was found; plan validation treats that as consumed actual budget, not an invalid pending task.

This pass tightened the two places where local tests exposed false confidence. First, `kun serve` now promotes `serve.providers.deepseek` into the default request credentials when top-level `serve.apiKey/baseUrl/endpointFormat/modelProxyUrl` are omitted, while CLI and environment overrides still win. Second, `ResearchRuntime` now stops before synthesis when the final gap-loop verdict is `budget_exhausted` with remaining evidence gaps. Evidence-insufficient runs get a structured failed verification, do not call the synthesis writer or LLM Judge, and do not expose a report path. Lightweight `quick` runs still use lower thresholds, but they no longer write a report when their configured evidence gate is not met.

Strong web evidence is now a runtime concept, not a UI label. Fetched pages that pass search/fetch/extraction are tagged as `web_fetch` + `strong_web_evidence`; model-generated source cards and local fallback records do not satisfy this gate. For `standard` and `deep` runs whose brief allows web sources, `BasicCoverageEvaluator` evaluates a coverage matrix: required questions need per-question source coverage, high-priority questions need at least one or two strong web sources depending on preset, comparison targets need independent coverage, and deep/standard runs need boundary or disconfirming evidence when the frame asks for it. The newer VOI layer sits above this gate: it prevents low-impact "related material" searches and prioritizes evidence that can support, weaken, qualify, or reject competing hypotheses.

The evidence gate now rejects model fallback at citation admission time as well as at coverage time. `SourceRecord.kind` distinguishes `web_strong`, `web_weak`, `user_file`, and `model_fallback`; `CitationResolver` does not emit visible superscript citations or verified bindings for `model_fallback` spans, and `QualityVerifier` does not count model-generated cards toward citation requirements, critical-claim support, evidence coverage, or source quality. The scope confirmation path also performs a capability check before brief approval: web evidence requires an actual search-capable worker, and local-file evidence requires an explicit local-evidence-capable worker, not merely `allowedSourceTypes: ['local_file']` in the brief. If a standard/deep run has no verifiable source capability, the runtime terminates before approval as unavailable; the renderer folds that rare internal state into a normal "cannot continue" failure surface instead of exposing the raw status name.

Verification failures are now routed by failure class instead of being blindly sent back to the writer. Writing-only failures can still trigger a bounded rewrite with compact verifier feedback. Citation-only failures stop in the citation layer instead of spending another writer attempt. Evidence-blocking failures try a bounded worker repair round only when there is remaining source budget and an available real evidence capability; otherwise they fail immediately. Repair tasks are phrased around value of information: they must seek evidence that can change, weaken, or materially qualify the final judgment, not just add related background.

Live model testing also exposed a writer-layer regression: the fallback synthesis writer had a domain-specific claim whitelist tuned for stock/company research, so generic architecture claims such as gap loop / LLM Judge were filtered out and citations disappeared. This is now removed; any supported, non-boilerplate claim can be cited. Research runtime stages now use the model selected by the user; no stage silently downgrades to a cheaper model.

The remaining architectural gap is stronger runtime enforcement and model-backed reasoning nodes: the current hypothesis proposer/test designer/binder/assessor/convergence analyzer are deterministic first versions. They establish the runtime contract and state shape, but future work should add model-backed versions with schema validation, source permission isolation beyond source-policy validation, timeout enforcement, cooperative cancellation, resume from checkpoint, and richer source reliability / semantic verification.

## Existing Entry Points And Reusable Foundations

- Research entry: `src/renderer/src/components/chat/floating-composer-commands.ts`, `src/renderer/src/components/chat/FloatingComposer.tsx`, `src/renderer/src/research/deep-research-runtime-client.ts`, `src/renderer/src/locales/*/common.json`.
- Research HTTP routes: `kun/src/server/routes/research.ts`, mounted from `kun/src/server/routes/index.ts`.
- Write assistant send path: `src/renderer/src/components/Workbench.tsx`, `src/renderer/src/write/quoted-selection.ts`.
- Runtime composition: `kun/src/server/runtime-factory.ts`.
- Generic runtime events and replay: `kun/src/services/runtime-event-recorder.ts`, `kun/src/adapters/file/file-session-store.ts`, `kun/src/contracts/events.ts`.
- Generic user input gate: `kun/src/adapters/in-memory-user-input-gate.ts`, `kun/src/server/routes/user-inputs.ts`.
- Generic delegation: `kun/src/delegation/delegation-runtime.ts`, `kun/src/delegation/child-agent-executor.ts`, `kun/src/adapters/tool/delegation-tool-provider.ts`.
- Tool policy and sandbox: `kun/src/adapters/tool/local-tool-host.ts`, `kun/src/adapters/tool/sandbox-policy.ts`, `kun/src/adapters/tool/capability-registry.ts`.
- Web search/fetch tools: `kun/src/adapters/tool/web-tool-provider.ts`.
- Local Write retrieval and PDF extraction: `src/main/services/write-retrieval-service.ts`, `src/main/services/write-pdf-text-service.ts`, `src/shared/write-retrieval.ts`.
- Lark document snapshot flow: `src/main/services/lark-documents.ts`, `src/shared/lark-document.ts`.
- Workspace file persistence: `src/main/services/workspace-files.ts`, `src/shared/workspace-file.ts`.
- Prior planning note: `docs/deep-research-options.md`.

## Requirement Matrix

| 文档要求 | 当前实现位置 | 当前状态 | 是否需要改造 | 计划改法 | 风险 |
|---|---|---|---|---|---|
| 1. 是否有 `ResearchRuntime` 硬控状态、权限、预算、工具调用、落盘 | `kun/src/research/runtime/ResearchRuntime.ts`、`kun/src/research/runtime/ResearchRuntimeService.ts`、`kun/src/server/routes/research.ts` | `partial` | 是 | P0 已控制状态、brief gate、source policy、source budget、事件和落盘，并通过 HTTP route 暴露；P1 需接入真实工具权限、timeout/resume | 若绕过 feature flag 回到 prompt-only，不会产生 ledger/report artifacts |
| 2. 是否有清晰的 `BriefingAgent` / `PlanAgent` / `HypothesisProposer` / `TestDesigner` / `ResearchTaskWorker` / `EvidenceBinder` / `HypothesisAssessor` / `ConvergenceAnalyzer` / `SynthesisWriter` / `CitationResolver` / `QualityVerifier` 边界 | `kun/src/research/agents/*`、`kun/src/research/evidence/CitationResolver.ts`、`kun/src/research/verification/QualityVerifier.ts` | `partial` | 是 | 已有 Scope/Supervisor/Plan/Hypothesis/Test/Worker/Binder/Assessor/Convergence/Gap/Writer/Citation/Verifier 边界；worker 支持并行任务和搜索增强；VOI selector 防止低价值相关资料任务进入搜索 | 后续不能让 worker 直接写报告，也不能让 supervisor 绕过 runtime budget |
| 3. Research Workers 是否只产结构化 notes，而不是直接写报告章节 | `kun/src/research/agents/types.ts`、`kun/src/research/agents/ResearchTaskWorker.ts` | `done` | 否 | `WorkerResult` 只收 sources/spans/claims/notes；测试拒绝 `markdown` 字段 | 后续真实 worker prompt/schema 也必须复用此校验 |
| 4. `SynthesisWriter` 是否唯一负责最终报告生成 | `kun/src/research/agents/SynthesisWriter.ts`、`kun/src/research/runtime/ResearchRuntime.ts` | `done` | 否 | Runtime 只在研究完成后调用 `SynthesisWriter.writeDraft` 生成 Markdown draft | 未来多 writer 或 worker prose 会破坏 citation chain |
| 5. 是否有 `ResearchBrief` + `ResearchFrame`，尤其是 `coreResearchThread` | `kun/src/research/core/types.ts`、`kun/src/research/core/validation.ts` | `done` | 否 | `ResearchFrame.coreResearchThread` 和非空 core questions/success criteria 已校验 | 后续 UI 编辑 brief 时必须同步 brief hash/version |
| 6. brief 是否必须用户确认，模型是否不能自己确认 | `kun/src/research/runtime/ResearchRuntime.ts` | `done` | 否 | `approveBrief` 只接受 `approvedByUser: true` 和匹配 `briefHash`；未确认不能进入 researching | UI 接入时不能让模型消息直接生成最终 approval |
| 7. Evidence Ledger 是否拆成 `SourceRecord` / `EvidenceSpan` / `AtomicClaim` / `ResearchNote` / `CitationBinding` | `kun/src/research/evidence/types.ts`、`kun/src/research/evidence/EvidenceStore.ts` | `done` | 否 | 五层 ledger 已定义并写入 `.kun-research/*.jsonl` | P1 可增强 dedupe、source policy、conflict graph |
| 8. citation 是否能绑定到具体 evidence span，而不是只绑定 source | `kun/src/research/evidence/CitationResolver.ts` | `done` | 否 | `[claim:*]` / `[evidence:*]` placeholder 解析为 `CitationBinding.evidenceSpanIds`，报告正文输出可点击上标链接，不再追加脚注来源列表 | 语义匹配仍是 P2，不在 P0 范围 |
| 9. Verifier 是否包含 deterministic checks、citation coverage、claim-support、整体 rubric | `kun/src/research/verification/QualityVerifier.ts`、`kun/src/research/verification/QualityJudge.ts` | `partial` | 是 | P0 deterministic checks 已覆盖 broken citation、missing span、required question、critical unsupported claim；LLM Judge 已用紧凑 prompt + thinking off JSON 评分；语义 claim-support 和完整 rubric 未做 | 不应把 P0 verifier 误当成最终质量判断 |
| 10. 是否有 bounded research loop，而不是无限多轮研究 | `kun/src/research/core/types.ts`、`kun/src/research/runtime/ResearchRuntime.ts`、`kun/src/research/agents/HypothesisAgent.ts`、`kun/src/research/agents/GapAnalyzer.ts` | `done` | 否 | Runtime 每轮 research 后绑定证据到 hypothesis，评估假设状态，运行 convergence analyzer；CoverageEvaluator 只负责完整性 gate；follow-up tasks 会经过 VOI 筛选并受预算约束 | 真实 source adapter 接入后仍需严格执行 timeout/cancel |
| 11. 是否有 `ResearchBudget`，包括 maxWorkers、maxRounds、maxSources、timeout | `kun/src/research/core/types.ts`、`kun/src/research/core/presets.ts`、`kun/src/research/agents/SupervisorAgent.ts` | `partial` | 是 | Budget 现在包含 preset、reasoningEffort、maxWorkers、maxSubagents、maxResearchRounds、maxSynthesisRetries、min/target/maxSources、timeout；timeout/cancel 尚未强制执行 | 长任务接入前必须补 timeout/cancel |
| 12. 是否有长任务恢复机制，包括 `events.jsonl`、checkpoint、resume | `kun/src/research/storage/ResearchRunRepository.ts` | `partial` | 是 | P0 写入 `run.json` 和 `.kun-research/events.jsonl`；resume 重建 runtime 状态未实现 | 只靠文件存在还不能证明恢复能力 |
| 13. 是否有 prompt injection / 私有数据隔离策略 | 通用 sandbox 仍在 `kun/src/adapters/tool/*`；research-specific 未接入 | `partial` | 是 | P0 worker 接口隔离了结构化输出，并校验 allowed source type；source trust boundary 和 web/local 工具权限隔离未做 | 接真实 web/local source 前必须补 source trust policy |
| 14. 是否能落盘为 `report.md`、`brief.md`、`plan.md`、`sources.md`、`notes.md` 和 `.kun-research/*` | `kun/src/research/storage/ResearchRunRepository.ts`、`kun/src/research/markdown/*` | `done` | 否 | E2E 测试验证完整目录和 `run/evidence/claims/citations/events` JSONL | UI 展示路径和 workspace 文档索引后续再接 |
| 15. 是否有单元测试、集成测试或 fake corpus 验证关键链路 | `kun/tests/research-runtime.test.ts` | `done` | 否 | Fake data E2E 覆盖 brief gate、worker notes、citation binding、verifier、落盘 | P1 需要 fake corpus 扩展到真实 retrieval/source adapter |

## P0 Acceptance Matrix

| 文档条目 | 实现状态 | 对应代码位置 | 测试覆盖 | 未完成原因 | 后续建议 |
|---|---|---|---|---|---|
| P0.1 DeepResearch 状态机 | `done` | `kun/src/research/core/state-machine.ts`, `kun/src/research/core/events.ts` | `kun/tests/research-runtime.test.ts` 验证完整状态事件序列 | 无 | UI/API 接入时复用同一状态机 |
| P0.2 BriefApproval gate | `done` | `kun/src/research/runtime/ResearchRuntime.ts` | 未确认不能 `runConfirmedResearch`，模型式 `approvedByUser: false` 被拒绝 | 无 | 增加 HTTP route 后继续用 hash/version 防 stale approval |
| P0.3 ResearchBrief + ResearchFrame | `done` | `kun/src/research/core/types.ts`, `kun/src/research/core/validation.ts` | E2E 使用含 `coreResearchThread` 的 confirmed brief/frame | 无 | 下一轮接入 BriefingAgent proposed brief |
| P0.4 ResearchTask + planning output | `done` | `kun/src/research/core/types.ts`, `kun/src/research/agents/PlanAgent.ts` | E2E 生成 one task，并验证 plan artifact | 无 | 后续替换为模型 PlanAgent 时保持 schema 校验 |
| P0.5 Evidence Ledger 基础结构 | `done` | `kun/src/research/evidence/types.ts`, `kun/src/research/evidence/EvidenceStore.ts` | E2E 验证 evidence/claims/citations JSONL | 无 | 增强 dedupe、conflict/source policy |
| P0.6 Worker 只输出 notes/evidence | `done` | `kun/src/research/agents/types.ts`, `kun/src/research/agents/ResearchTaskWorker.ts` | 测试拒绝 worker 输出 `markdown` | 无 | 真实 worker 需要 schema parser 严格复用 |
| P0.7 单一 SynthesisWriter | `done` | `kun/src/research/agents/SynthesisWriter.ts`, `kun/src/research/runtime/ResearchRuntime.ts` | E2E 中 report 只由 writer draft 产生，并验证用户可见报告不展示内部元数据、核心问题问答或独立证据链 | 无 | 后续可加 context selection，但仍保持唯一写作入口 |
| P0.8 CitationResolver 绑定 EvidenceSpan | `done` | `kun/src/research/evidence/CitationResolver.ts` | E2E 验证 `CitationBinding.evidenceSpanIds` 包含 `span_1` | 无 | P2 再做复杂语义匹配 |
| P0.9 基础 QualityVerifier + LLM Judge | `done` | `kun/src/research/verification/QualityVerifier.ts`, `kun/src/research/verification/QualityJudge.ts` | 测试覆盖 broken citation、missing span、required question、critical unsupported claim、Judge prompt 压缩和 JSON 输出 | 无 | P1/P2 增加 coverage ratio、semantic claim-support，并把 Judge 异常原因显式落事件 |
| P0.10 研究产物落盘结构 | `done` | `kun/src/research/storage/ResearchRunRepository.ts`, `kun/src/research/markdown/*` | E2E 验证 `report.md/brief.md/plan.md/sources.md/notes.md/.kun-research/*` 存在 | 无 | 下一轮接 workspace index / UI display |
| Runtime 接入入口 | `done` | `kun/src/server/routes/research.ts`, `src/renderer/src/research/deep-research-runtime-client.ts`, `src/renderer/src/components/chat/FloatingComposer.tsx`, `src/renderer/src/components/Workbench.tsx` | `kun/tests/research-routes.test.ts`, `src/renderer/src/research/deep-research-runtime-client.request.test.ts` | 无 | 下一轮接 run history / resume loader |
| 最小 Brief 确认 UI | `done` | `src/renderer/src/components/research/DeepResearchRuntimePanel.tsx`, `src/renderer/src/components/Workbench.tsx` | `src/renderer/src/components/research/DeepResearchRuntimePanel.test.ts` | 无 | UI 现在隐藏 run id、用户意图、中心问题、调研路径、调研主线、artifact/source 明细、任务列表和评分矩阵；过程数据只保留在 runtime 与日志中 |
| 搜索增强 Worker | `partial` | `kun/src/research/runtime/SeededWebResearchTaskWorker.ts`, `kun/src/research/runtime/DeepSeekWebSearchProvider.ts`, `kun/src/server/runtime-factory.ts` | `kun/tests/research-model-nodes.test.ts` 覆盖 search -> fetch -> extraction、默认最近一年搜索窗、用户显式时间范围不追加默认窗、通用 architecture 网页抽取和 `strong_web_evidence` 标记 | DeepSeek Web Search 不可用时自动回退；通用搜索 provider 尚未产品化配置 | 后续把 search provider 配置化，并暴露运行日志中的 search query / fetch status |
| report 打开/展示 | `done` | `src/renderer/src/components/Workbench.tsx`, `src/renderer/src/components/research/DeepResearchRuntimePanel.tsx` | `DeepResearchRuntimePanel.test.ts` 覆盖 report path、打开按钮和评估展示；相关 helper 测试覆盖 runtime response | 无 | 下一轮把完成态自动纳入 Write 文档树刷新和打开记录 |
| Evidence Drawer | `deferred` | 无 | 无 | 本轮明确不做 Evidence Drawer | 等 citation/evidence UI 设计稳定后再接 |
| Audit Panel | `deferred` | 无 | 无 | 本轮明确不做完整 Audit Panel | 先沉淀 `.kun-research/*` 读取 API |
| 真实 source adapter | `partial` | `SeededWebResearchTaskWorker`, `DeepSeekWebSearchProvider` | `research-model-nodes.test.ts` 覆盖 search -> fetch -> extraction | 已有网页搜索/抓取增强，但本地 Write/PDF/Lark evidence adapter 未接 | 下一轮优先接本地 Write workspace retrieval |
| Reasoning preset / supervisor budget | `done` | `kun/src/research/core/presets.ts`, `kun/src/research/agents/SupervisorAgent.ts`, `src/renderer/src/components/Workbench.tsx` | `research-model-nodes.test.ts`, `research-routes.test.ts`, `deep-research-runtime-client.request.test.ts` | 无 | 后续可把 BasicResearchSupervisor 替换为模型版 supervisor，但 runtime 预算仍必须硬控 |
| P1 Hypothesis Ledger / VOI task selection | `done` | `kun/src/research/core/types.ts`, `kun/src/research/agents/HypothesisAgent.ts`, `kun/src/research/runtime/ResearchRuntime.ts`, `kun/src/research/agents/SynthesisWriter.ts` | `research-model-nodes.test.ts` 覆盖低 VOI 背景任务被过滤、决定性任务保留；`research-runtime.test.ts` 覆盖 hypotheses/tests/bindings/updates/convergence 落入 `run.json` 和事件流 | 无 | 后续把 deterministic HypothesisProposer/TestDesigner/EvidenceBinder/HypothesisAssessor/ConvergenceAnalyzer 替换为模型版，但保持 schema 和 runtime gate |
| P1 bounded gap round | `done` | `kun/src/research/agents/GapAnalyzer.ts`, `kun/src/research/runtime/ResearchRuntime.ts` | `research-runtime.test.ts`, `research-model-nodes.test.ts` 覆盖 `need_more -> follow-up -> sufficient` | 无 | 下一轮增强语义 coverage、冲突检测和反证要求 |
| P1 budget-exhausted evidence gate | `done` | `kun/src/research/runtime/ResearchRuntime.ts`, `kun/src/research/verification/QualityVerifier.ts` | `research-runtime.test.ts` 覆盖证据不足时 synthesis/Judge 前早停、无 report path、无草稿落盘；`research-routes.test.ts` 将 dev wiring happy-path 明确限定到最小证据达标的 quick 档 | 无 | 后续把 blocker 原因展示成用户可理解的“需要补充搜索/证据”状态 |
| P1 coverage matrix / strong web evidence gate | `done` | `kun/src/research/runtime/SeededWebResearchTaskWorker.ts`, `kun/src/research/agents/GapAnalyzer.ts`, `kun/src/research/verification/QualityVerifier.ts` | `research-model-nodes.test.ts`, `research-runtime.test.ts` 覆盖模型资料卡不能冒充强联网证据，真实抓取网页可计入 per-question strong web 覆盖，满足矩阵后不会为了旧的全局来源数继续烧 token | 无 | 后续把抓取失败原因保留在日志中，UI 只展示可行动的失败说明 |
| Generic claim synthesis | `done` | `kun/src/research/agents/SynthesisWriter.ts` | `research-model-nodes.test.ts` 覆盖 gap loop / LLM Judge 等非股票领域 claim 仍可进入 fallback report 并生成 citation placeholder；live quick run 验证报告完成 | 无 | 后续把模型草稿缺引用的回退原因落事件，方便 UI 展示“已使用 deterministic writer 兜底” |
| Serve provider credential fallback | `done` | `kun/src/cli/serve.ts`, `kun/src/config/kun-config.ts` | `contracts.test.ts` 覆盖 `serve.providers.deepseek` 自动成为默认 apiKey/baseUrl/endpointFormat/modelProxyUrl，且 env 覆盖优先 | 无 | GUI 配置保存 provider-only 时，不再需要额外注入 `DEEPSEEK_API_KEY` 才能跑 flash 测试 |
| P1 budget manager / timeout / cancel / resume | `partial` | budget preset、source policy 校验、source budget、gap round 预算和事件落盘已存在 | E2E 覆盖 maxWorkers/maxSources/source policy/gap loop 基础路径 | timeout/cancel/resume 未实现 | 下一轮补 runtime cancellation 和 resume loader |
| P1 source reliability / prompt injection / conflict candidates | `not_started` | 仅有字段和 worker output 结构 | 无 | 本轮不做复杂 source policy | 接 web/local source 前优先做权限隔离 |
| P2 semantic verifier / audit panel / evidence library / MCP | `not_started` | 无 | 无 | 超出 P0 范围 | 等 P0 runtime 接入产品后再做 |

## Detailed Findings

### Current `/research` Entry Uses The Runtime Path

`/research <topic>` calls `POST /v1/research/runs` and displays `DeepResearchRuntimePanel`. The panel now uses product-level states (`creating_run`, `scoping`, `awaiting_brief_confirm`, `approving`, `running`, `completed`, `failed`, `cancelled`) while keeping the backend's finer-grained run statuses internal. The user-facing card shows only actionable information: topic, scope questions, brief confirmation, a concise running message, and the open-report action. It intentionally hides run id, user intent, central question, investigation path, core research thread, constraints, task lists, artifact/source internals, verifier scores, and source-count diagnostics.

When `VITE_KUN_DEEP_RESEARCH_AUTO_APPROVE=1` or localStorage `kun.deepResearch.autoApprove=1` is set, the request auto-confirms only after scope is ready; unclear scope still returns to the interactive clarification state. Without auto-approve, clicking `确认并开始` calls `POST /v1/research/runs/:id/approve`; completion displays and opens `report.md`.

### Search-Enhanced Worker Path

`SeededWebResearchTaskWorker` now first builds multiple search queries from task hints, task objective, confirmed questions, and expected evidence. When the user has not mentioned or selected a time range, each search query carries a default recent-year window (`after:<date>` / `before:<date>` plus structured `timeRange` metadata). If the user explicitly says current/latest, historical, future, since/until, a concrete year, or no time limit, the worker does not add the default window. It runs searches in parallel through a `WebProvider`, dedupes results, fetches the result pages, then asks the model to extract structured evidence cards from the fetched page text. In DeepSeek-hosted runtimes, `DeepSeekWebSearchProvider` attempts the DeepSeek Anthropic-compatible Web Search path and includes the structured time range in the search prompt. If search is unavailable or returns insufficient pages, the worker falls back to curated seed URLs and then to the model/generated-card fallback.

Only fetched web pages that survive this pipeline are tagged as strong web evidence. Generic topics such as gap loop, LLM Judge, supervisor architecture, citation faithfulness, and retrieval evaluation are accepted by the signal filter instead of being forced through earlier stock/product-specific keyword rules.

### Hypothesis, VOI, And Convergence Loop

`/research` now carries the active composer `reasoningEffort` to the runtime as structured data. The runtime maps low/medium to `quick`, high/auto to `standard`, and max to `deep`. These presets set `maxSubagents`, `maxResearchRounds`, `minSources`, `targetSources`, `maxSources`, and timeout ceilings. The preset is a budget ceiling, not mandatory work: `BasicCoverageEvaluator` can stop early when the coverage matrix is satisfied.

Before the first worker task, `ResearchRuntime` now proposes a small hypothesis set and designs falsifiable tests. `selectTasksByValueOfInformation` annotates and filters tasks with a VOI score built from uncertainty importance, discriminative power, decision impact, source feasibility, and estimated cost. A task that is merely related but unlikely to change the final judgment is filtered out unless it is required for a high-priority question.

After each research round, evidence claims are bound to hypotheses as `supports`, `weakens`, or `qualifies`. `BasicHypothesisAssessor` writes structured updates back to the run, and `BasicConvergenceAnalyzer` records whether there is a leading hypothesis, whether high-VOI tests remain open, and whether further research is likely to change the final conclusion. `deep` runs can spend remaining budget on high-VOI follow-up tests; simpler presets avoid long-running extra searches unless the coverage gate itself requires another round.

`ResearchRuntime` still writes a `GAP_CHECK_COMPLETED` event after each research round. A `need_more` verdict appends bounded follow-up tasks after VOI filtering and returns the run to `researching`; `sufficient` moves the run toward synthesis when convergence does not require a high-value follow-up. If the final verdict is `budget_exhausted` and still contains evidence gaps, the runtime records a failed verification and stops before `SynthesisWriter`, citation resolution, LLM Judge, or report draft persistence. Evidence-insufficient failures therefore do not produce user-facing report files.

For `standard` and `deep`, when the brief allows web sources, the gap loop requires strong web coverage at the question level rather than a global fetched-page quota. A model-generated source card can still be kept as fallback context, but it no longer lets the run exit as if real web evidence had been collected.

### Generic Runtime Features Are Useful But Not Sufficient

Kun already has the right foundation for long-running work:

- persisted events before SSE publish;
- per-thread event replay via `events.jsonl`;
- generic user-input gates;
- generic delegation with child-run records;
- tool sandbox and approval policy;
- read-only child policy;
- web search/fetch tools;
- workspace file primitives.

These should be reused, but not treated as completion of the DeepResearch design. The design requires a dedicated runtime contract.

### Write Context Currently Disables Structured User Input

`src/renderer/src/write/quoted-selection.ts` adds an interaction rule telling the Write assistant not to call `request_user_input`, because the old Write assistant flow should ask in plain text. DeepResearch brief approval must therefore be implemented as a new runtime/UI contract, not as another prompt instruction inside the existing Write assistant.

### Local Sources Are Available At Snippet Level, Not Evidence Level

`retrieveWriteContext` can return ranked snippets with text line ranges or PDF pages. That is a good starting point for `EvidenceSpan`, but it lacks stable span IDs, hashes, source records, claim extraction, citation binding, and conflict metadata.

### Lark Is Snapshot-Based, Not Live Research

The Lark integration imports documents as local Markdown snapshots and sidecar metadata. For MVP, it should be treated as local workspace evidence after import. Real-time Lark fetching is correctly deferred.

## UI Scope Decision

The current UI is still intentionally minimal: it does not implement Evidence Drawer, Audit Panel, or a full run-history timeline. It does implement the product-critical confirmation and status surfaces:

- scope clarification questions are interactive options or explicit fill-in questions;
- brief confirmation is a single card with topic and delivery standards;
- running state shows a concise “正在生成报告” message instead of detailed task telemetry;
- completed state shows the report open action without verifier score matrices or artifact paths;
- report citations are inline clickable superscript links instead of a separate source list inside the report body.

## Recommended Status After P0

- `done`: P0 schemas, state machine, brief gate, worker-note contract, single writer, evidence ledger, citation binding, basic verifier, artifact writers, and fake-data E2E test.
- `partial`: real tool permission enforcement, stronger timeout controls, checkpoint resume, source trust policy, and richer verifier semantics.
- `not_started`: P2 semantic verifier, source reliability model, evidence library, real-time Lark/MCP, audit panel.
- `deferred`: Evidence Drawer, full Audit Panel, and real-time external source integrations.
- `blocked`: none. The current codebase has enough foundation for the next P0-to-product integration pass.

# Kun DeepResearch Implementation Audit

> Scope: this audit compares the current Kun codebase against the design in `/Users/rubick/Downloads/kun-deep-research-design.md`.
> The goal objective mentioned `/workspace/kun-deep-research-design.md`, but that path does not exist on this machine. The downloaded design file is the authoritative source used here.
>
> UI-specific implementation requirements from the design are intentionally deferred. UI is referenced only when it affects runtime/API boundaries.

## Executive Summary

Kun now has a P0 internal DeepResearch runtime foundation under `kun/src/research/`. It defines a dedicated runtime, state machine, brief approval gate, evidence ledger, citation resolver, basic verifier, artifact repository, HTTP routes, fake-data end-to-end tests, and a minimal feature-flagged UI. The renderer `/research <topic>` entry can create a run, show a scoped confirmation card, approve/cancel the run, show clear create/approve/run/completed states, and open the generated `report.md`.

This pass also adds a search-enhanced web worker path: each standard/deep research task first asks a `SourceStrategist` subagent, using the model and provider selected for the run, for at most three high-information queries and a body-verifiable identity criterion. The search executor reserves part of its query window for a deterministic topic/facet fallback so three over-specific model queries cannot suppress recall. The runtime runs queries sequentially inside each worker while workers remain parallel, fetches result pages, and then asks the extraction model for structured evidence. Search composition uses Tavily basic only when configured by the user, then free generic providers; paid model search is an explicit opt-in fallback.

The source path is intentionally topic-neutral. Core code does not infer annual reports, exchanges, SEC records, sports sources, or any other document category from the question. The model may propose any suitable source dynamically, but a source becomes `web_strong` only when the extraction result includes a primary/authoritative role plus a continuous publisher-identity excerpt that the runtime can find in the fetched body. Search rank, title, subject-like domain names, and search snippets cannot establish source authority.

The runtime now follows a hypothesis-driven supervisor loop. After `ResearchFrame` is confirmed, `BasicHypothesisProposer` creates candidate explanations, `BasicTestDesigner` turns them into falsifiable tests, and task selection uses value of information (VOI) rather than broad topical coverage. Each retained task must answer: "If this search succeeds, can it change the final judgment?" Worker evidence is then bound back to hypotheses, `BasicHypothesisAssessor` applies structured status updates, and `BasicConvergenceAnalyzer` decides whether the judgment has converged. `BasicCoverageEvaluator` still protects report completeness, but it no longer acts as the primary search objective.

The final `report.md` is now treated as a user-facing document, not an audit log. Internal run metadata, model judge details, `核心问题与回答`, and standalone `证据链` sections are kept out of the rendered report; evidence remains available through inline citation links and `.kun-research/*` artifacts.

Quality verification now uses a token-conscious loop: failed report attempts are retried from structured verifier/Judge feedback rather than by reinserting the previous full draft. The LLM Judge prompt is compacted to cited evidence and section-aware report slices, and the Judge stage requests concise JSON from the user-selected model instead of spending the output budget on reasoning prose. Completed research tasks may record `maxSources = 0` when no usable source was found; plan validation treats that as consumed actual budget, not an invalid pending task.

This pass tightened the two places where local tests exposed false confidence. First, `kun serve` now promotes `serve.providers.deepseek` into the default request credentials when top-level `serve.apiKey/baseUrl/endpointFormat/modelProxyUrl` are omitted, while CLI and environment overrides still win. Second, `ResearchRuntime` now stops before synthesis when the final gap-loop verdict is `budget_exhausted` with remaining evidence gaps. Evidence-insufficient runs get a structured failed verification, do not call the synthesis writer or LLM Judge, and do not expose a report path. Lightweight `quick` runs still use lower thresholds, but they no longer write a report when their configured evidence gate is not met.

Strong web evidence is now a runtime concept, not a creation-time tag. A source qualifies only when it is `web_strong`, fetched, high reliability, and paired with a citable extracted span; model-generated source cards and fallback records do not satisfy this gate. For `standard` and `deep` runs whose brief allows web sources, `BasicCoverageEvaluator` evaluates a coverage matrix: required questions need per-question source coverage, high-priority questions need strong web evidence, comparison targets need independent coverage, the brief's minimum unique-source count must be met, and requested boundary/disconfirming evidence must be represented. The newer VOI layer sits above this gate: it prevents low-impact "related material" searches and prioritizes evidence that can support, weaken, qualify, or reject competing hypotheses.

The evidence gate now rejects model fallback at citation admission time as well as at coverage time. `SourceRecord.kind` distinguishes `web_strong`, `web_weak`, `user_file`, and `model_fallback`; `CitationResolver` does not emit visible superscript citations or verified bindings for `model_fallback` spans, and `QualityVerifier` does not count model-generated cards toward citation requirements, critical-claim support, evidence coverage, or source quality. The scope confirmation path also performs a capability check before brief approval: web evidence requires an actual search-capable worker, and local-file evidence requires an explicit local-evidence-capable worker, not merely `allowedSourceTypes: ['local_file']` in the brief. If a standard/deep run has no verifiable source capability, the runtime terminates before approval as unavailable; the renderer folds that rare internal state into a normal "cannot continue" failure surface instead of exposing the raw status name.

Verification failures are now routed by failure class instead of being blindly sent back to the writer. Writing and citation-expression failures can trigger a bounded rewrite with compact verifier feedback; unsupported citation numbers do not trigger an evidence-search round. Evidence-blocking failures try a bounded worker repair round only when there is remaining source budget and an available real evidence capability; otherwise they fail immediately. Repair tasks are phrased around value of information: they must seek evidence that can change, weaken, or materially qualify the final judgment, not just add related background.

2026-07-07 修复了三处会导致“跑很久但产物垃圾”的链路缺陷。第一，`ResearchRuntimeService.buildResearchFrame` 不再把 scope 阶段的澄清问题文本映射成 `centralQuestion` 或 `coreQuestions`；如果 frame 中出现“您是否/请说明/待确认”等 scope prompt 泄漏，会抛出 `ScopeFrameMappingError`。用户确认出的调研维度会显式进入 required core questions，scope prompt 行不会再被当成“领域/维度”值抽取。第二，`EvidenceEligibility` 成为统一证据准入层：`fallback_extracted`、`fallback_structured`、模型资料卡、抓取/抽取失败文本和 “This operation was aborted” 片段不能满足 strong web coverage，也不能生成可见上标引用。第三，Judge 失败会按 `scope_frame_mapping_error`、`missing_required_dimensions`、`evidence_blocking`、`citation_fixable`、`writing_fixable` 分流；缺维度或证据不可用时回到研究/修复任务，而不是让 Writer 在同一批坏材料上反复重写。

同日补上 Plan 前的 `ResearchPreflightGate`。它在 `BRIEF_APPROVED` 后、hypothesis/plan/task 之前执行 `frameSanityCheck`、capability check 和 evidence policy check：Frame 中出现“您是否/请说明/回答：”会先确定性修复，无法修复则失败；standard/deep 在没有联网搜索且没有用户文件证据时直接进入 `research_unavailable`，不再启动计划、搜索、合成和 Judge。Preflight 同时生成 `ReportContract`，把用户确认的关键维度转成 Writer 必须覆盖的报告小节；模型 Writer 和 fallback Writer 都必须逐项填充，证据不足时写低置信限制判断而不是跳过。`QualityVerifier` 会检查 contract section 是否出现在最终报告中。Gap status 也补充了 `ready_with_limitations` 语义：只有中心问题和强证据已覆盖、剩余缺口属于非中心限制条件时，才允许带限制进入写作；否则继续 repair 或失败。

Research runtime 现在会把模型用量写入 `.kun-research/events.jsonl` 的 `MODEL_USAGE_RECORDED` 事件。记录覆盖 scope、source strategy、worker、web search、web extraction、architect、writer、editor、judge 阶段，字段包含 stage、model、turnId、taskId/attempt，以及 provider 返回的 promptTokens、completionTokens、totalTokens、cacheHitTokens、cacheMissTokens、cacheHitRate 和成本估算。这样可以直接看每个 run 的 token 消耗和缓存命中情况，而不是只在全局 usage 面板里推断。

Live model testing also exposed a writer-layer regression: the fallback synthesis writer had a domain-specific claim whitelist tuned for stock/company research, so generic architecture claims such as gap loop / LLM Judge were filtered out and citations disappeared. This is now removed; any supported, non-boilerplate claim can be cited. Research runtime stages now use the model selected by the user; no stage silently downgrades to a cheaper model.

### 2026-07-10 Independent Reliability Audit

The reliability pass was driven by bounded real runs using `deepseek-v4-flash`, not only fake happy paths. It fixed these concrete failure chains:

- `standard`/`deep` can no longer expose `BasicSynthesisWriter` output; model writer failure remains a failed run.
- synthetic/model/fallback cards cannot satisfy strong evidence or citations; duplicate canonical pages count once across Gap, Judge, and quality scoring.
- one rejected parallel worker no longer discards successful sibling results; policy/schema violations still fail closed.
- scope answers clear optional-only questions after one submission, and confirmed AI-governance requirements become reportable dimensions instead of generic or truncated questions.
- search no longer bursts all queries concurrently at an HTML endpoint. Official/entity queries run first, result groups are interleaved, official domains rank ahead of commentary, and the configured provider cascade is Tavily -> DuckDuckGo -> fallback-only DeepSeek Web Search.
- Gap enforces the brief's minimum unique-source count. ReportContract headings are complete and do not duplicate the central question.
- claim and report numbers are checked against evidence. Citation placeholder ids and rendered superscript labels are ignored; unsupported dates, costs, durations, counts, ratios, and thresholds trigger a bounded Writer feedback retry rather than an unnecessary research round.
- LLM Judge is skipped when deterministic verification already fails, reducing wasted tokens.

A later bounded Flash run exposed four additional production-only faults that fake providers did not reveal. A generated “不少于 2000 字” requirement was mistaken for a year and added a 2000-only search window; search continued into DeepSeek Web Search even after DuckDuckGo had returned allowed MDN pages; the renderer counted nonexistent `stage/outcome` audit fields instead of the persisted `phase/status` fields; and model-search reservations underestimated the provider's hidden web-search context. The repaired path reads time scope only from the original topic/clarifications, stops after the task candidate target, treats DeepSeek search as fallback-only with a 30k reservation, records estimated currency cost, and displays actual search attempts.

The same live sequence also exposed semantic duplicate and comparison bugs. MDN `/en-US/docs/...` and `/zh-CN/docs/...` translations of one page had counted as independent candidates, while scope text saying “不涉及其他来源；不比较其他机制” caused bare Chinese conjunction parsing to invent comparison targets. URL identity now collapses locale-prefixed documentation paths, cross-query acceptance continues until distinct pages are found, and comparison extraction requires nearby positive comparison language after removing negated comparison phrases.

The final real API run completed with status `done`: one scope answer produced zero remaining questions, the evidence ledger contained NIST Core, NIST Playbook, and a China-regulation source, deterministic verification passed, and the real Flash LLM Judge passed with overall `0.90` and citation faithfulness `0.90`. The Judge still warned that the China-regulation side should use more official sources and that staged implementation advice lacks direct SME case/cost evidence; these remain evidence-quality limitations, not hidden success claims.

### 2026-07-11 Full Pipeline Re-Audit

A new end-to-end audit walked every active DeepResearch layer from scope through final rendering and repeatedly stopped on real production failures instead of treating fake tests as completion. It fixed stale evidence maps after repair, duplicate spans being counted as progress, invalid/synthetic sources satisfying source floors, paid search consuming synthesis budget, Judge coverage issues being routed to new searches, optional scope questions looping, and conclusion citations being assigned to unrelated prose.

The live MDN test then exposed additional faults that deterministic fixtures had missed: a negated “不需要选答” instruction was classified as a scope prompt; technical concepts were invented as comparison entities; authoritative domains bypassed topic relevance and admitted an HTTP authentication page; a one-source task could emit only one evidence card; short official quotations failed an arbitrary 80-character strong-evidence threshold; model-provided question ids falsely satisfied section coverage; user-declared technical terms were rejected as hallucinations; and the report architect could inject unsupported conditions such as `max-age=0`. Each failure received a focused regression before the next bounded run.

The final `deepseek-v4-flash` API run `rr_fxynfoew` completed with status `done`. It used only `developer.mozilla.org`, produced a cited Chinese report, passed deterministic verification, and passed the real LLM Judge with overall `0.90`, citation faithfulness `1.00`, and writing quality `0.80`. The run used 12 model calls, 53,520 reported tokens, and an estimated CNY cost of `0.06256128`. Manual inspection confirmed that scope scaffolding, search hints, dangling conclusions, vague limitation placeholders, unsupported external recommendations, and off-topic authentication evidence were absent. The Judge retained two non-blocking warnings: the opening summary/findings can be shorter, and browser-specific `no-cache`/bfcache behavior remains lightly covered.

A second production-app sequence tested the exact no-question, single-domain concise request without route-level budget overrides. It exposed four more reliability faults: the default standard budget still demanded 8/15/25 sources from one documentation domain; query truncation cut `site:developer.mozilla.org` into `site:developer.moz`; comma-separated requested dimensions were collapsed into one generic question; and valid Writer drafts could exhaust all retries because one claim appeared outside its Architect-owned section. The runtime now adapts a concise single-domain request to a 2/4/8 source budget, preserves complete `site:` suffixes, turns each explicitly requested dimension into a required question, safely removes unsupported numeric sentences on retries, and deterministically moves misplaced claim prose back to its owned section.

The final post-fix run `rr_0k5nv6c0` completed with status `done` through the running Electron app. It used `deepseek-v4-flash`, made 12 model calls, reported 72,777 tokens, and cost an estimated CNY `0.09126524`. Deterministic verification passed; the real LLM Judge passed with overall `0.90`, citation faithfulness `0.90`, evidence use `0.90`, and no blocking issues. Manual review found the report materially usable but still identified summary/findings repetition and broad first queries. Final deterministic rendering now removes the repeated Findings lead, concise titles omit delivery directives, and dimension questions become the first domain-constrained search query. Across all bounded live audit attempts in this sequence, including failures used to discover these bugs, estimated model cost was CNY `0.7336472`.

The final reliability sequence re-ran the same MDN-only request after splitting the report path into section researchers, an architect, a single writer, and a constrained editor. It fixed cross-language question/source attribution, umbrella-question aggregation, two-claim coverage for multi-facet sections, editor-added uncited prose, raw MDN `Header type`/`Syntax` metadata, empty limitation headings, English claim text copied into a Chinese conclusion, and repeated prose before multiple Findings subsections. The final real run `rr_a2x5lto9` completed with status `done` using `deepseek-v4-flash`: 8 model calls, 53,549 reported tokens, and estimated cost CNY `0.06210692`. Deterministic verification passed with no issues; the real LLM Judge passed at `0.99`, citation faithfulness `1.00`, writing quality `0.90`, and no warnings. Manual hard checks found no uncited factual sentences, extraction boilerplate, English conclusion fallback, or empty limitations. The last pure-renderer change was replayed against this same artifact and removed the redundant Findings preamble without another paid model call.

User-visible citations now use Markdown reference links (`[1]` with definitions at the end of the file) instead of raw `<sup data-citation-id=...><a ...>` HTML. The Write preview renders the number as a clickable link and hides the definitions from prose, while `citations.jsonl` remains the machine-readable binding ledger. Final rendering also migrates already-generated legacy HTML citations, so old reports no longer expose internal attributes when rewritten.

Final regression status after this sequence: the Kun runtime suite passes 80 files / 904 tests, and the desktop repository suite passes 200 files / 1,606 tests. Both Kun and desktop TypeScript checks and production builds pass.

Absolute success is not guaranteed. Timeout enforcement, cooperative cancellation, run/evidence/event recovery, startup auto-resume, section-level evidence gates, strict source eligibility, redirect/SSRF protection, and structured Judge repair routing are now implemented. Remaining architectural work is stronger semantic entailment, richer source reliability calibration, local-file evidence adapters, and replacing the deterministic first versions of the hypothesis proposer/test designer/binder/assessor/convergence analyzer where measured quality justifies the extra model cost.

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
| 4. 最终报告是否经过单一编辑流水线 | `kun/src/research/agents/ReportArchitect.ts`、`kun/src/research/agents/SynthesisWriter.ts`、`kun/src/research/agents/ResearchEditor.ts`、`kun/src/research/runtime/ResearchSynthesisPipeline.ts` | `done` | 否 | 主编只产蓝图，Writer 是唯一正文作者，Editor 只能删除/重排且不能新增 claim；worker 仍禁止 prose | 任一节点绕过 claim 归属或允许 Editor 发明事实都会破坏 citation chain |
| 5. 是否有 `ResearchBrief` + `ResearchFrame`，尤其是 `coreResearchThread` | `kun/src/research/core/types.ts`、`kun/src/research/core/validation.ts` | `done` | 否 | `ResearchFrame.coreResearchThread` 和非空 core questions/success criteria 已校验 | 后续 UI 编辑 brief 时必须同步 brief hash/version |
| 6. brief 是否必须用户确认，模型是否不能自己确认 | `kun/src/research/runtime/ResearchRuntime.ts` | `done` | 否 | `approveBrief` 只接受 `approvedByUser: true` 和匹配 `briefHash`；未确认不能进入 researching | UI 接入时不能让模型消息直接生成最终 approval |
| 7. Evidence Ledger 是否拆成 `SourceRecord` / `EvidenceSpan` / `AtomicClaim` / `ResearchNote` / `CitationBinding` | `kun/src/research/evidence/types.ts`、`kun/src/research/evidence/EvidenceStore.ts` | `done` | 否 | 五层 ledger 已定义并写入 `.kun-research/*.jsonl` | P1 可增强 dedupe、source policy、conflict graph |
| 8. citation 是否能绑定到具体 evidence span，而不是只绑定 source | `kun/src/research/evidence/CitationResolver.ts` | `done` | 否 | `[claim:*]` / `[evidence:*]` placeholder 解析为 `CitationBinding.evidenceSpanIds`，报告正文输出可点击上标链接，不再追加脚注来源列表 | 语义匹配仍是 P2，不在 P0 范围 |
| 9. Verifier 是否包含 deterministic checks、citation coverage、claim-support、整体 rubric | `kun/src/research/verification/QualityVerifier.ts`、`kun/src/research/verification/QualityJudge.ts` | `partial` | 是 | P0 deterministic checks 已覆盖 broken citation、missing span、required question、critical unsupported claim；LLM Judge 已用紧凑 prompt + thinking off JSON 评分；语义 claim-support 和完整 rubric 未做 | 不应把 P0 verifier 误当成最终质量判断 |
| 10. 是否有 bounded research loop，而不是无限多轮研究 | `kun/src/research/core/types.ts`、`kun/src/research/runtime/ResearchRuntime.ts`、`kun/src/research/agents/HypothesisAgent.ts`、`kun/src/research/agents/GapAnalyzer.ts` | `done` | 否 | Runtime 每轮 research 后绑定证据到 hypothesis，评估假设状态，运行 convergence analyzer；CoverageEvaluator 只负责完整性 gate；follow-up tasks 会经过 VOI 筛选并受预算约束 | 真实 source adapter 接入后仍需严格执行 timeout/cancel |
| 11. 是否有 `ResearchBudget`，包括 maxWorkers、maxRounds、maxSources、timeout | `kun/src/research/core/types.ts`、`kun/src/research/core/presets.ts`、`kun/src/research/runtime/ResearchRuntimeExecution.ts` | `done` | 否 | Budget 包含 worker/round/source/model-call/token/timeout 上限；运行控制器在每次模型调用前预留 token，并把取消与总超时传播到搜索、抓取和模型阶段 | Provider 不返回 usage 时使用保守估算，仍需持续校准估算误差 |
| 12. 是否有长任务恢复机制，包括 `events.jsonl`、checkpoint、resume | `kun/src/research/storage/ResearchRunRepository.ts`、`kun/src/research/runtime/ResearchRunIndex.ts`、`kun/src/research/runtime/ResearchRuntimeRecovery.ts` | `done` | 否 | 启动时按 run 索引发现自定义 Workspace，回放 run/events/ledger，重置中断任务并自动恢复近期已批准运行 | 跨版本 schema 迁移仍需版本化策略 |
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
| P0.7 主编/作者/编辑职责隔离 | `done` | `kun/src/research/agents/ReportArchitect.ts`, `kun/src/research/agents/SynthesisWriter.ts`, `kun/src/research/agents/ResearchEditor.ts`, `kun/src/research/runtime/ResearchSynthesisPipeline.ts` | tests 覆盖 claim 单一章节归属、raw clarification 不进入 Writer、Editor 不得新增 claim | 无 | Writer 仍是唯一正文作者；Editor 只能在原 claim 集合内改写和去重 |
| P0.8 CitationResolver 绑定 EvidenceSpan | `done` | `kun/src/research/evidence/CitationResolver.ts` | E2E 验证 `CitationBinding.evidenceSpanIds` 包含 `span_1` | 无 | P2 再做复杂语义匹配 |
| P0.9 基础 QualityVerifier + LLM Judge | `done` | `kun/src/research/verification/QualityVerifier.ts`, `kun/src/research/verification/QualityJudge.ts` | 测试覆盖 broken citation、missing span、required question、critical unsupported claim、Judge prompt 压缩和 JSON 输出 | 无 | P1/P2 增加 coverage ratio、semantic claim-support，并把 Judge 异常原因显式落事件 |
| P0.10 研究产物落盘结构 | `done` | `kun/src/research/storage/ResearchRunRepository.ts`, `kun/src/research/markdown/*` | E2E 验证 `report.md/brief.md/plan.md/sources.md/notes.md/.kun-research/*` 存在 | 无 | 下一轮接 workspace index / UI display |
| Runtime 接入入口 | `done` | `kun/src/server/routes/research.ts`, `src/renderer/src/research/deep-research-runtime-client.ts`, `src/renderer/src/components/chat/FloatingComposer.tsx`, `src/renderer/src/components/Workbench.tsx` | `kun/tests/research-routes.test.ts`, `src/renderer/src/research/deep-research-runtime-client.request.test.ts` | 无 | 下一轮接 run history / resume loader |
| 最小 Brief 确认 UI | `done` | `src/renderer/src/components/research/DeepResearchRuntimePanel.tsx`, `src/renderer/src/components/Workbench.tsx` | `src/renderer/src/components/research/DeepResearchRuntimePanel.test.ts` | 无 | UI 现在隐藏 run id、用户意图、中心问题、调研路径、调研主线、artifact/source 明细、任务列表和评分矩阵；过程数据只保留在 runtime 与日志中 |
| 搜索增强 Worker | `done` | `kun/src/research/runtime/SeededWebResearchTaskWorker.ts`, `kun/src/research/runtime/CascadingWebSearchProvider.ts`, `kun/src/research/runtime/TavilyWebSearchProvider.ts`, `kun/src/research/runtime/GenericWebSearchProvider.ts`, `kun/src/research/runtime/DeepSeekWebSearchProvider.ts` | tests 覆盖 search -> fetch -> extraction、显式时间范围、来源白名单、结果不足继续级联、通用主题网页抽取和动态强证据准入 | 无静态题目种子；无时间要求的常青问题不再强塞最近一年 | 后续可按实际失败率调整 provider 顺序和搜索结果数 |
| report 打开/展示 | `done` | `src/renderer/src/components/Workbench.tsx`, `src/renderer/src/components/research/DeepResearchRuntimePanel.tsx` | `DeepResearchRuntimePanel.test.ts` 覆盖 report path、打开按钮和评估展示；相关 helper 测试覆盖 runtime response | 无 | 下一轮把完成态自动纳入 Write 文档树刷新和打开记录 |
| Evidence Drawer | `deferred` | 无 | 无 | 本轮明确不做 Evidence Drawer | 等 citation/evidence UI 设计稳定后再接 |
| Audit Panel | `deferred` | 无 | 无 | 本轮明确不做完整 Audit Panel | 先沉淀 `.kun-research/*` 读取 API |
| 真实 source adapter | `partial` | `SeededWebResearchTaskWorker`, `DeepSeekWebSearchProvider` | `research-model-nodes.test.ts` 覆盖 search -> fetch -> extraction | 已有网页搜索/抓取增强，但本地 Write/PDF/Lark evidence adapter 未接 | 下一轮优先接本地 Write workspace retrieval |
| Reasoning preset / supervisor budget | `done` | `kun/src/research/core/presets.ts`, `kun/src/research/agents/SupervisorAgent.ts`, `src/renderer/src/components/Workbench.tsx` | `research-model-nodes.test.ts`, `research-routes.test.ts`, `deep-research-runtime-client.request.test.ts` | 无 | 后续可把 BasicResearchSupervisor 替换为模型版 supervisor，但 runtime 预算仍必须硬控 |
| P1 Hypothesis Ledger / VOI task selection | `done` | `kun/src/research/core/types.ts`, `kun/src/research/agents/HypothesisAgent.ts`, `kun/src/research/runtime/ResearchRuntime.ts`, `kun/src/research/agents/SynthesisWriter.ts` | `research-model-nodes.test.ts` 覆盖低 VOI 背景任务被过滤、决定性任务保留；`research-runtime.test.ts` 覆盖 hypotheses/tests/bindings/updates/convergence 落入 `run.json` 和事件流 | 无 | 后续把 deterministic HypothesisProposer/TestDesigner/EvidenceBinder/HypothesisAssessor/ConvergenceAnalyzer 替换为模型版，但保持 schema 和 runtime gate |
| P1 bounded gap round | `done` | `kun/src/research/agents/GapAnalyzer.ts`, `kun/src/research/runtime/ResearchRuntime.ts` | `research-runtime.test.ts`, `research-model-nodes.test.ts` 覆盖 `need_more -> follow-up -> sufficient` | 无 | 下一轮增强语义 coverage、冲突检测和反证要求 |
| P1 budget-exhausted evidence gate | `done` | `kun/src/research/runtime/ResearchRuntime.ts`, `kun/src/research/verification/QualityVerifier.ts` | `research-runtime.test.ts` 覆盖证据不足时 synthesis/Judge 前早停、无 report path、无草稿落盘；`research-routes.test.ts` 将 dev wiring happy-path 明确限定到最小证据达标的 quick 档 | 无 | 后续把 blocker 原因展示成用户可理解的“需要补充搜索/证据”状态 |
| P1 coverage matrix / evidence confidence gate | `done` | `kun/src/research/runtime/SeededWebResearchTaskWorker.ts`, `kun/src/research/agents/GapAnalyzer.ts`, `kun/src/research/verification/QualityVerifier.ts` | `research-model-nodes.test.ts`, `research-runtime.test.ts` 覆盖模型资料卡不可引用、每个必答问题至少有直接可引用来源、弱来源只能形成带局限报告；不再按 deep/standard 固定强来源数量反复补研 | 无 | 后续把抓取失败原因保留在日志中，UI 只展示可行动的失败说明 |
| Generic claim synthesis | `done` | `kun/src/research/agents/SynthesisWriter.ts`, `kun/src/research/runtime/ResearchSynthesisPipeline.ts` | tests 覆盖任意领域的可支持 claim、引用占位符和模型 Writer 失败行为 | `standard/deep` 禁止 Basic writer 进入用户报告；Basic 仅保留 quick/debug 诊断用途 | Writer 失败应通过缩短证据输入或修复证据重试，不能伪装成完成报告 |
| Editorial subagent pipeline | `done` | `kun/src/research/agents/SupervisorAgent.ts`, `kun/src/research/agents/ReportArchitect.ts`, `kun/src/research/agents/ResearchEditor.ts`, `kun/src/research/runtime/ResearchWritableGate.ts` | tests 覆盖按报告章节分配 subagent、章节 claim 独占、主编重复归属修复和 Editor 新增 claim 回退 | 主编失败可退回确定性蓝图，但不能退回模板正文；Editor 失败保留已校验 Writer 原稿 | 后续真实运行重点观察编辑调用对重复率、信息密度和总 token 的影响 |
| Information-density writing policy | `done` | `kun/src/research/runtime/ResearchRuntimeService.ts`, `kun/src/research/agents/ScopeAgent.ts`, `kun/src/research/agents/SynthesisWriterSupport.ts`, `kun/src/research/verification/QualityVerifier.ts` | tests 覆盖简洁报告不会被注入固定 2000 字要求，Writer 和 Verifier 都不设置最低字数 | 用户明确的简洁/详细要求优先，默认篇幅服从问题复杂度和证据密度；结论仍必须保留主证据引用 | 不再用字数作为质量代理，Judge 继续检查完整性和写作质量 |
| Serve provider credential fallback | `done` | `kun/src/cli/serve.ts`, `kun/src/config/kun-config.ts` | `contracts.test.ts` 覆盖 `serve.providers.deepseek` 自动成为默认 apiKey/baseUrl/endpointFormat/modelProxyUrl，且 env 覆盖优先 | 无 | GUI 配置保存 provider-only 时，不再需要额外注入 `DEEPSEEK_API_KEY` 才能跑 flash 测试 |
| P1 budget manager / timeout / cancel / resume | `done` | `ResearchRuntimeExecution`, `ResearchRunRepository`, `ResearchRunIndex`, `ResearchRuntimeRecovery` | tests 覆盖模型预算预留、取消/超时、事件与 ledger 恢复和中断任务重置 | 无 | 后续增加跨版本恢复 fixtures |
| P1 source reliability / prompt injection / conflict candidates | `partial` | `ResearchSourceAuthority`, `SeededWebResearchTaskWorker`, `EvidenceEligibility` | tests 覆盖正文身份回查、未回查身份不得升级、prompt injection 和 conflict candidates | 已完成网页来源的通用身份校验；跨来源声誉、作者历史和本地文件身份仍未建模 | 保持模型提议、程序回查的边界，不新增题材或机构白名单 |
| P2 semantic verifier / audit panel / evidence library / MCP | `not_started` | 无 | 无 | 超出 P0 范围 | 等 P0 runtime 接入产品后再做 |

## Detailed Findings

### Current `/research` Entry Uses The Runtime Path

`/research <topic>` calls `POST /v1/research/runs` and displays `DeepResearchRuntimePanel`. The panel now uses product-level states (`creating_run`, `scoping`, `awaiting_brief_confirm`, `approving`, `running`, `completed`, `failed`, `cancelled`) while keeping the backend's finer-grained run statuses internal. The user-facing card shows only actionable information: topic, scope questions, brief confirmation, a concise running message, and the open-report action. It intentionally hides run id, user intent, central question, investigation path, core research thread, constraints, task lists, artifact/source internals, verifier scores, and source-count diagnostics.

When `VITE_KUN_DEEP_RESEARCH_AUTO_APPROVE=1` or localStorage `kun.deepResearch.autoApprove=1` is set, the request auto-confirms only after scope is ready; unclear scope still returns to the interactive clarification state. Without auto-approve, clicking `确认并开始` calls `POST /v1/research/runs/:id/approve`; completion displays and opens `report.md`.

### Search-Enhanced Worker Path

`SeededWebResearchTaskWorker` asks `ModelSourceStrategist` to design a bounded query set from the confirmed brief, the task's owned report questions, the evidence gap, and already-used URLs. `reportSectionIds` identify report structure; `reportQuestionIds` identify which questions a worker may populate, and runtime validation rejects notes that cross that ownership boundary. The executor mixes model queries with a generic fallback query, adds a time window only when the original user topic or clarification requests one, and runs queries sequentially inside each worker to avoid search-provider bursts. Results are interleaved across query intents, localized copies of the same page are collapsed, and duplicate canonical pages count once before Gap/Judge. The provider cascade uses an explicitly configured Tavily key first, then free Brave/HTML/Yahoo-compatible providers, with DeepSeek model search only when paid search is explicitly enabled. If all search/fetch paths fail, the worker records unresolved diagnostics; model-generated fallback cards remain non-citable.

Fetched status alone is not sufficient for strong evidence. The extraction model must identify a source as primary or authoritative and quote the body text that proves the publisher/owner role; `ResearchSourceAuthority` independently grounds that excerpt before adding the high-reliability tag. Generic topics are accepted through the same strategy, fetch, identity, relevance, and evidence gates instead of topic-specific keyword or domain rules.

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

## 2026-07-13 Real Flash Validation

- `v80` completed end to end with `deepseek-v4-flash`: deterministic verification and LLM Judge passed; Judge overall score was `0.95`, writing score was `0.90`, and the final report was written to the Workspace.
- Later stress replays exposed nondeterministic synthesis failures despite the same evidence corpus. `v81` reached Judge three times but remained at `0.70` because the API scene repeated conservative evidence boundaries instead of forming a scene answer. `v82` correctly stopped before Judge after the new scene gate detected that failure, but initially applied the rule too broadly to a static-resource section whose two direct claims were already distinct. `v83` removed the empty-scene failure in the first draft, then a revision introduced an unsupported dependency between `no-cache` and ETag strength and was rejected before a second Judge call.
- Current deterministic hardening removes the user-visible summary scaffold, blocks vague closing aggregates, rejects a conservative boundary as a completed scene analysis when direct scene claims substantially overlap, and deduplicates repeated context fallbacks. Focused DeepResearch coverage is `269/269` passing and the Kun build/typecheck pass.
- Release status is therefore **not fully stable**. The remaining priority is to rank one semantically closest context claim for each mandatory scene synthesis and locally reject unsupported cross-concept dependency wording before it reaches Judge. Do not raise Judge retries or treat a single passing run as proof of reliability.

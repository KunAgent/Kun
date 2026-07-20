# Kun DeepResearch Implementation Plan

> Scope: implement the non-UI parts of `/Users/rubick/Downloads/kun-deep-research-design.md`.
> UI sections are deferred. Tasks below may define runtime APIs/events needed by future UI, but do not require UI refactors in this stage.

## Guiding Architecture

DeepResearch should be implemented as a dedicated runtime workflow, not as a longer assistant prompt.

Target ownership:

- `kun/src/research/`: core research runtime, types, state machine, agents, evidence, storage, verification.
- `kun/src/server/routes/`: HTTP routes for research runs, brief confirmation, cancellation, resume, artifact fetch.
- `src/main/`: Electron IPC bridge to the Kun research HTTP routes, only when renderer integration starts.
- `src/shared/`: shared DTOs if renderer/main need compile-time contracts.
- `docs/`: architecture notes and audit artifacts.

MVP source scope:

- web search/fetch through existing runtime web tools;
- local Markdown/text/PDF through existing Write retrieval/PDF services or equivalent runtime adapters;
- already-imported Lark docs as local Markdown files only.

Out of MVP:

- UI implementation;
- real-time Lark remote reads;
- arbitrary MCP source integration;
- code interpreter/data analysis;
- chart generation;
- custom user-defined agents;
- unlimited research loops.

## P0：必须先做

### P0.1 Define The DeepResearch State Machine

- 修改目标: add a deterministic `ResearchRun` lifecycle controlled by runtime.
- 涉及文件:
  - `kun/src/research/core/types.ts`
  - `kun/src/research/core/events.ts`
  - `kun/src/research/core/state-machine.ts`
  - `kun/tests/research-state-machine.test.ts`
- 实施步骤:
  - Define `ResearchRunStatus`: `scoping`, `awaiting_brief_confirm`, `planning`, `researching`, `gap_checking`, `synthesizing`, `resolving_citations`, `verifying`, `writing`, `done`, `failed`, `cancelled`, `paused`.
  - Define `ResearchEvent` union matching the design event flow.
  - Implement pure transition reducer: `(state, event) -> state`.
  - Reject illegal transitions, especially `planning` before brief approval.
- 验收标准:
  - Illegal transitions throw or return typed failure.
  - `BRIEF_APPROVED` is the only event that can leave `awaiting_brief_confirm`.
  - `done` is reachable only after verification and report write events.
- 测试方式:
  - Unit tests for happy path, cancelled path, failed path, and illegal skip from scoping to researching.
- 风险和回滚方式:
  - Risk: state names drift from future UI expectations.
  - Rollback: keep the new module isolated and unused until API integration.

### P0.2 Define BriefApproval Gate

- 修改目标: enforce user-controlled brief confirmation; model cannot self-confirm.
- 涉及文件:
  - `kun/src/research/core/types.ts`
  - `kun/src/research/runtime/ResearchRuntime.ts`
  - `kun/src/server/routes/research.ts`
  - `kun/tests/research-brief-approval.test.ts`
- 实施步骤:
  - Define `BriefApproval` with `briefVersion`, `approvedByUser`, `approvedAt`, `approvalMessageId`, `briefHash`.
  - Add runtime method `approveBrief(runId, input)` that validates current status and hash.
  - Do not accept model-generated `approved: true` as approval.
  - Add route stub for brief approval when HTTP integration begins.
- 验收标准:
  - `PlanAgent` cannot run until `BriefApproval.approvedByUser === true`.
  - Approval against stale `briefHash` fails.
- 测试方式:
  - Unit tests for approval, stale approval, double approval, model-proposed ready state without user approval.
- 风险和回滚方式:
  - Risk: overfitting approval to UI click only.
  - Rollback: allow approval source enum later: `button`, `explicit_message`, `api`.

### P0.3 Define ResearchBrief + ResearchFrame

- 修改目标: make `coreResearchThread` a first-class contract.
- 涉及文件:
  - `kun/src/research/core/types.ts`
  - `kun/src/research/agents/schemas.ts`
  - `kun/tests/research-brief-schema.test.ts`
- 实施步骤:
  - Define `ResearchBrief`: topic, userIntent, targetAudience, outputFormat, sourcePolicy, successCriteria, constraints.
  - Define `ResearchFrame`: `coreResearchThread`, centralQuestion, coreQuestions, investigationPath, evidenceNeeded, disconfirmingEvidenceNeeded, nonGoals.
  - Add schema validation and normalization.
- 验收标准:
  - A brief without `coreResearchThread` is invalid.
  - `coreQuestions` and `successCriteria` must be non-empty before approval.
- 测试方式:
  - Schema unit tests for valid/invalid brief and frame.
- 风险和回滚方式:
  - Risk: fields become too product-specific.
  - Rollback: keep optional product-path fields optional; preserve generic central question/core thread.

### P0.4 Define ResearchTask

- 修改目标: convert plan into bounded worker tasks.
- 涉及文件:
  - `kun/src/research/core/types.ts`
  - `kun/src/research/agents/PlanAgent.ts`
  - `kun/src/research/agents/schemas.ts`
  - `kun/tests/research-plan-agent.test.ts`
- 实施步骤:
  - Define `ResearchPlan` and `ResearchTask`.
  - Require each task to reference one or more brief question IDs.
  - Include objective, expectedEvidence, sourceTypes, searchHints, maxSources, priority, status.
  - Add validation that total planned sources stays inside budget.
- 验收标准:
  - Every high-priority core question maps to at least one task.
  - Tasks are not freeform strings; they have structured source and evidence expectations.
- 测试方式:
  - Unit tests for mapping core questions to tasks and rejecting unbounded plans.
- 风险和回滚方式:
  - Risk: initial model plans are too rigid.
  - Rollback: allow runtime to regenerate plan while preserving confirmed brief.

### P0.5 Define Evidence Ledger Foundation

- 修改目标: create append-only machine-readable evidence records.
- 涉及文件:
  - `kun/src/research/evidence/types.ts`
  - `kun/src/research/evidence/EvidenceStore.ts`
  - `kun/src/research/evidence/SourceNormalizer.ts`
  - `kun/src/research/storage/ResearchRunRepository.ts`
  - `kun/tests/research-evidence-store.test.ts`
- 实施步骤:
  - Define `SourceRecord`, `EvidenceSpan`, `AtomicClaim`, `ResearchNote`, `CitationBinding`.
  - Store records in `.kun-research/evidence.jsonl`, `claims.jsonl`, `citations.jsonl`.
  - Add source fingerprint and evidence span text hash.
  - Add dedupe by source fingerprint and span hash.
- 验收标准:
  - Every note references existing claim IDs and evidence span IDs.
  - Every evidence span references an existing source ID.
  - JSONL append survives partial run failure.
- 测试方式:
  - Unit tests for append/read/dedupe/hash integrity.
- 风险和回滚方式:
  - Risk: schema too heavy for MVP.
  - Rollback: keep schema stable but allow some fields optional in P0.

### P0.6 Ensure Worker Outputs Only Notes

- 修改目标: make research workers extraction-only, not report writers.
- 涉及文件:
  - `kun/src/research/agents/ResearchTaskWorker.ts`
  - `kun/src/research/agents/schemas.ts`
  - `kun/tests/research-worker-output.test.ts`
- 实施步骤:
  - Define `WorkerResult` with sources, spans, claims, notes, unresolvedQuestions, conflicts, suggestedNextQueries.
  - Reject Markdown section outputs from worker schemas.
  - Keep worker prompts focused on reading/searching/extracting implications for brief.
- 验收标准:
  - Worker result contains no report prose fields.
  - Worker result can be persisted directly into evidence ledger.
- 测试方式:
  - Fake model output parsing tests and schema rejection tests.
- 风险和回滚方式:
  - Risk: workers provide too little narrative context.
  - Rollback: add `summary` and `implicationForBrief`, but still forbid final report section prose.

### P0.7 Define Single SynthesisWriter

- 修改目标: final report is generated once from global context.
- 涉及文件:
  - `kun/src/research/agents/SynthesisWriter.ts`
  - `kun/src/research/markdown/ReportRenderer.ts`
  - `kun/tests/research-synthesis-writer.test.ts`
- 实施步骤:
  - Writer input: confirmed brief, research frame, selected notes, evidence spans, plan state.
  - Writer output: draft Markdown with stable claim/citation placeholders.
  - Runtime must call writer only after research/gap rounds complete.
- 验收标准:
  - No worker-produced prose is treated as report section.
  - Writer receives only budgeted context, not full raw source dumps.
- 测试方式:
  - Unit tests with fake notes producing a coherent report skeleton.
- 风险和回滚方式:
  - Risk: writer context selection drops important evidence.
  - Rollback: add retrieval-based context expansion before writer call.

### P0.8 Bind Citations To EvidenceSpan

- 修改目标: citations point to exact spans, not only sources.
- 涉及文件:
  - `kun/src/research/evidence/CitationResolver.ts`
  - `kun/src/research/markdown/ReportRenderer.ts`
  - `kun/tests/research-citation-resolver.test.ts`
- 实施步骤:
  - Let writer output `[claim:<id>]` or `[evidence:<id>]` placeholders.
  - Resolve placeholders into Markdown footnotes and `CitationBinding`.
  - Validate every citation target exists and points to an `EvidenceSpan`.
- 验收标准:
  - Broken citation IDs fail deterministic verification.
  - Report footnotes can be traced to source + span location.
- 测试方式:
  - Unit tests for placeholder parsing, footnote rendering, broken citation detection.
- 风险和回滚方式:
  - Risk: writer emits unsupported claims without placeholders.
  - Rollback: verifier blocks final write or sends draft back for revision.

### P0.9 Add Basic Verifier

- 修改目标: block low-quality reports before final write.
- 涉及文件:
  - `kun/src/research/verification/DeterministicVerifier.ts`
  - `kun/src/research/verification/CitationCoverage.ts`
  - `kun/src/research/verification/QualityVerifier.ts`
  - `kun/tests/research-verifier.test.ts`
- 实施步骤:
  - Implement deterministic checks: required sections, citation IDs exist, citation points to spans, no empty high-priority questions, source count within policy.
  - Implement MVP citation coverage using placeholder/binding counts.
  - Add semantic verifier stub for claim-support, with fake implementation in tests.
- 验收标准:
  - Missing required section fails.
  - Broken citation fails.
  - Critical unanswered question fails.
- 测试方式:
  - Unit tests for pass/fail cases and blocking issue lists.
- 风险和回滚方式:
  - Risk: verifier too strict blocks usable drafts.
  - Rollback: separate `blockingIssues` from `warnings`; only block critical checks in MVP.

### P0.10 Define Research Artifact Layout And Writers

- 修改目标: write complete research package into Write workspace.
- 涉及文件:
  - `kun/src/research/storage/ResearchRunRepository.ts`
  - `kun/src/research/markdown/Frontmatter.ts`
  - `kun/src/research/markdown/BriefRenderer.ts`
  - `kun/src/research/markdown/PlanRenderer.ts`
  - `kun/src/research/markdown/SourcesRenderer.ts`
  - `kun/src/research/markdown/NotesRenderer.ts`
  - `kun/tests/research-markdown-writers.test.ts`
- 实施步骤:
  - Create folder: `Research/<date-slug>/`.
  - Write `report.md`, `brief.md`, `plan.md`, `sources.md`, `notes.md`.
  - Write machine-readable `.kun-research/run.json`, `events.jsonl`, `evidence.jsonl`, `claims.jsonl`, `citations.jsonl`.
  - Use temp file + atomic rename for final report.
- 验收标准:
  - A completed run produces all required files.
  - `report.md` frontmatter includes run id, brief hash, source count, claim count, verification status.
- 测试方式:
  - Filesystem unit tests in temp workspace.
- 风险和回滚方式:
  - Risk: artifact layout changes after UI work starts.
  - Rollback: centralize layout in repository methods and keep migration path simple.

## P1：随后做

### P1.1 Bounded Gap Round

- 修改目标: add at most one follow-up research round in MVP.
- 涉及文件: `kun/src/research/agents/GapAnalyzer.ts`, `kun/src/research/runtime/ResearchRuntime.ts`, `kun/tests/research-gap-round.test.ts`.
- 实施步骤: analyze coverage per core question; generate follow-up `ResearchTask[]`; enqueue only if budget remains.
- 验收标准: no more than configured `maxRounds`; no follow-up if no blocking gaps.
- 测试方式: fake corpus with missing evidence and no-gap cases.
- 风险和回滚方式: gap analyzer may loop; rollback by disabling follow-up round via budget.
- 当前实现: 已落到 `BasicCoverageEvaluator` + `ResearchRuntime` gap loop；实际字段已拆成 `maxResearchRounds` 和 `maxSynthesisRetries`，测试覆盖 `need_more -> follow-up -> sufficient`。

### P1.2 Budget Manager

- 修改目标: enforce maxWorkers, maxRounds, maxSources, timeout, optional token/cost caps.
- 涉及文件: `kun/src/research/runtime/BudgetManager.ts`, `kun/src/research/runtime/TaskQueue.ts`, `kun/tests/research-budget-manager.test.ts`.
- 实施步骤: count worker slots, source additions, round index, elapsed time; return typed budget-exhausted events.
- 验收标准: runtime never starts tasks beyond budget; exhausted budget produces report caveat.
- 测试方式: unit tests for each cap.
- 风险和回滚方式: too conservative budgets reduce quality; expose presets later without changing core.

### P1.3 Checkpoint / Resume

- 修改目标: resume interrupted runs from persisted artifacts.
- 涉及文件: `kun/src/research/runtime/CheckpointManager.ts`, `kun/src/research/storage/ResearchRunRepository.ts`, `kun/tests/research-resume.test.ts`.
- 实施步骤: persist event after every state change; make task completion idempotent; reconstruct run from `run.json` + events.
- 验收标准: simulated crash after worker result can resume without duplicate sources/notes.
- 测试方式: temp workspace crash/resume tests.
- 风险和回滚方式: duplicate writes; mitigate with record IDs and fingerprints.

### P1.4 Source Reliability

- 修改目标: classify sources with simple rules plus model explanation.
- 涉及文件: `kun/src/research/evidence/SourceReliability.ts`, `kun/src/research/agents/ResearchTaskWorker.ts`.
- 实施步骤: derive reliability from source type, domain, recency, author/publisher, user-provided flag; allow LLM reason text.
- 验收标准: official/local/user-provided sources can be tagged distinctly from SEO/unknown sources.
- 测试方式: unit tests over fixture source metadata.
- 风险和回滚方式: false confidence; default to `unknown` when rules are unclear.

### P1.5 Conflict Candidates

- 修改目标: surface contradictory or stale evidence candidates.
- 涉及文件: `kun/src/research/evidence/ConflictDetector.ts`, `kun/src/research/agents/GapAnalyzer.ts`.
- 实施步骤: compare atomic claims by entities, dates, metrics, polarity; record `ConflictCandidate[]`.
- 验收标准: conflicting fixture claims are not silently merged.
- 测试方式: fake corpus with outdated blog vs official page.
- 风险和回滚方式: noisy conflict detection; mark as candidate, not verdict.

### P1.6 Prompt Injection Protection

- 修改目标: isolate untrusted source text and private local data.
- 涉及文件: `kun/src/research/core/policies.ts`, `kun/src/research/tools/*`, `kun/src/research/agents/prompts/*`, `kun/tests/research-prompt-injection.test.ts`.
- 实施步骤: wrap source text as untrusted; split web and local source permissions; prevent local worker from web calls; enforce URL allow/block policy.
- 验收标准: malicious fixture cannot alter system policy or request private file exfiltration.
- 测试方式: fake malicious source integration test.
- 风险和回滚方式: too much isolation limits cross-source synthesis; keep synthesis over extracted notes, not raw private docs.

### P1.7 Fake Corpus Integration Tests

- 修改目标: verify the whole non-UI research chain deterministically.
- 涉及文件: `kun/tests/fixtures/research-corpus/*`, `kun/tests/research-integration.test.ts`.
- 实施步骤: create web/local fixtures; use fake source adapters and fake model agents; test normal, conflict, stale, injection, resume, budget cases.
- 验收标准: tests cover brief unconfirmed gate, worker retry, budget exhaustion, citation failure, successful report write.
- 测试方式: `npm run test -- research`.
- 风险和回滚方式: fixtures become brittle; keep fake agents deterministic and minimal.

## P2：后续增强

### P2.1 Stronger Claim-Support Semantic Verifier

- 修改目标: evaluate claim + evidence pair semantics, not just citation presence.
- 涉及文件: `kun/src/research/verification/ClaimSupportVerifier.ts`.
- 实施步骤: pass one claim and cited spans into model; classify supported/partial/unsupported/contradicted.
- 验收标准: unsupported factual claims fail even when cited to unrelated spans.
- 测试方式: semantic verifier tests with fake model verdicts.
- 风险和回滚方式: high model cost; sample claims or only verify critical claims.

### P2.2 Stronger Source Policy

- 修改目标: user-configurable source policies and templates.
- 涉及文件: `kun/src/research/core/policies.ts`, future shared settings.
- 实施步骤: add policy templates: product, technical, market, investment, local-first.
- 验收标准: source adapter obeys template restrictions.
- 测试方式: policy unit tests.
- 风险和回滚方式: policy surface grows too soon; keep defaults internal until UI stabilizes.

### P2.3 Full Audit Panel Support

- 修改目标: provide data needed for a future audit panel.
- 涉及文件: `kun/src/research/storage/ResearchRunRepository.ts`, `kun/src/server/routes/research.ts`.
- 实施步骤: expose run timeline, source list, claim bindings, verifier output via read-only routes.
- 验收标准: renderer can query all audit data without reading raw JSONL itself.
- 测试方式: HTTP route tests.
- 风险和回滚方式: UI may need different shape; keep DTOs versioned.

### P2.4 Multi-Report Evidence Library

- 修改目标: reuse sources and evidence across research runs.
- 涉及文件: `kun/src/research/storage/SqliteResearchStore.ts`, `kun/src/research/evidence/EvidenceStore.ts`.
- 实施步骤: move from per-run JSONL only to indexed shared store; keep per-run snapshots.
- 验收标准: same source can be reused without losing per-run audit trail.
- 测试方式: store migration and reuse tests.
- 风险和回滚方式: premature DB complexity; do only after P0/P1 JSONL proves stable.

### P2.5 External MCP / Real-Time Lark Connections

- 修改目标: add controlled external/private source adapters beyond MVP.
- 涉及文件: `kun/src/research/tools/McpSourceAdapter.ts`, `kun/src/research/tools/LarkDocSourceAdapter.ts`.
- 实施步骤: implement per-source permission prompts, scoped credentials, source snapshots, failure recovery.
- 验收标准: live external source reads are auditable and isolated from web workers.
- 测试方式: fake MCP/Lark adapter tests plus manual auth-path tests.
- 风险和回滚方式: auth and privacy complexity; keep disabled by default.

## Suggested P0 Implementation Order

1. `ResearchBrief` + `ResearchFrame` + `BriefApproval` schemas.
2. Research state machine and events.
3. Research artifact layout and repository.
4. Evidence ledger foundation.
5. `ResearchTask` + `PlanAgent` schema.
6. `ResearchTaskWorker` structured output.
7. Single `SynthesisWriter`.
8. `CitationResolver`.
9. Basic verifier.
10. Wire the first end-to-end non-UI runtime path behind internal tests.

This order makes the contract stable before model prompts or source adapters become complex.

## Acceptance Gate For Leaving P0

P0 is complete only when a non-UI integration test can:

1. Create a research run from a topic.
2. Propose a brief and stop before research.
3. Reject planning before user approval.
4. Accept user approval.
5. Generate bounded research tasks.
6. Produce structured notes from fake worker outputs.
7. Persist source/span/claim/note records.
8. Generate a single report draft.
9. Bind citations to evidence spans.
10. Pass deterministic verification.
11. Write `report.md`, `brief.md`, `plan.md`, `sources.md`, `notes.md`, and `.kun-research/*` into a temp workspace.

No UI work is required for this gate.

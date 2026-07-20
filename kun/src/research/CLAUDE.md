# research/
> L2 | 父级: /Users/rubick/Documents/kun/AGENTS.md

成员清单

agents/GapAnalyzer.ts: CoverageEvaluator 与 gap loop，按 ResearchFrame、EvidenceEligibility 和预算判断缺口并生成 follow-up tasks。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
agents/HypothesisAgent.ts: hypothesis/VOI/convergence 的确定性 agents，生成假设、测试、绑定和收敛判断。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
agents/PlanAgent.ts: BasicPlanAgent，根据 ResearchFrame 生成结构化研究计划。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
agents/ResearchTaskWorker.ts: WorkerResult 校验边界，阻止 worker 直接输出最终报告 prose。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
agents/ScopeAgent.ts: model/deterministic scope agent，确认需求、核心问题和简报 readiness。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
agents/SupervisorAgent.ts: BasicResearchSupervisor，按 preset、复杂度和 ResearchFrame 拆分并行任务。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
agents/SynthesisWriter.ts: 单一报告合成入口，把结构化 notes/claims/evidence 写成 Markdown draft。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
agents/types.ts: agents 与 runtime 之间的输入输出接口边界。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
core/events.ts: ResearchEvent union 与事件 payload 类型。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
core/hash.ts: research 模块 hash 工具，用于 brief、证据、artifact 稳定标识。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
core/presets.ts: quick/standard/deep preset 与 reasoning stage 映射。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
core/state-machine.ts: ResearchRun 状态转换 reducer 与启动条件校验。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
core/types.ts: ResearchRun、ResearchFrame、ResearchBudget、ledger、verdict 等核心类型中心。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
core/validation.ts: scope、brief、frame、plan 的确定性 schema 防线。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
evidence/CitationResolver.ts: citation placeholder 解析器，生成可点击上标引用和 CitationBinding。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
evidence/EvidenceEligibility.ts: 证据准入门，统一判断 fallback/model/抽取失败片段是否可用于 coverage 和 citation。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
evidence/EvidenceStore.ts: 来源、span、claim、note、citation 的内存索引和 JSONL 落盘。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
evidence/types.ts: SourceRecord、EvidenceSpan、AtomicClaim、ResearchNote、CitationBinding 类型。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
index.ts: research 模块统一导出入口。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
markdown/BriefRenderer.ts: brief.md 渲染器。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
markdown/Frontmatter.ts: Markdown frontmatter 工具。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
markdown/NotesRenderer.ts: notes.md 渲染器。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
markdown/PlanRenderer.ts: plan.md 渲染器。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
markdown/ReportRenderer.ts: 用户可见最终 report Markdown 包装器。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
markdown/SourcesRenderer.ts: sources.md 渲染器。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
markdown/labels.ts: research Markdown 展示标签工具。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
runtime/DeepSeekWebSearchProvider.ts: DeepSeek Web Search provider 适配器。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
runtime/DefaultResearchTaskWorker.ts: deterministic fake/local worker，用于 P0 和测试兜底。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
runtime/ModelResearchTaskWorker.ts: 模型资料卡 worker，用于无外部来源时的非强证据 fallback。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
runtime/ResearchRuntime.ts: DeepResearch 编排核心，控制 scope/brief/research/gap/synthesis/citation/verification/落盘。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
runtime/ResearchRuntimeService.ts: HTTP 服务门面，负责 create/answer/confirm/approve/cancel 和 Frame 映射。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
runtime/SeededWebResearchTaskWorker.ts: 搜索/抓取/抽取增强 worker，生成 web evidence 和 fallback records。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
storage/ResearchRunRepository.ts: research run artifact 目录、JSONL 和 Markdown 落盘仓库。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
verification/QualityJudge.ts: LLM/heuristic Judge，评估报告需求匹配、frame 遵循和证据质量。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
verification/QualityVerifier.ts: 本地确定性质量门，校验引用、coverage、报告结构和 fallback 证据。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

法则: 成员完整·一行一文件·父级链接·技术词前置

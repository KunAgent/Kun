/**
 * [INPUT]: 依赖 research/core、agents、evidence、runtime、storage、verification 的公开导出
 * [OUTPUT]: 对外提供 Kun DeepResearch 模块的统一 TypeScript barrel export
 * [POS]: research 模块边界，被 server routes、runtime factory 和测试消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export * from './core/events.js'
export * from './core/hash.js'
export * from './core/presets.js'
export * from './core/state-machine.js'
export * from './core/types.js'
export * from './core/validation.js'
export * from './agents/GapAnalyzer.js'
export * from './agents/HypothesisAgent.js'
export * from './agents/PlanAgent.js'
export * from './agents/ResearchTaskWorker.js'
export * from './agents/ScopeAgent.js'
export * from './agents/SupervisorAgent.js'
export * from './agents/SynthesisWriter.js'
export * from './agents/types.js'
export * from './evidence/CitationResolver.js'
export * from './evidence/EvidenceStore.js'
export * from './evidence/EvidenceEligibility.js'
export * from './evidence/types.js'
export * from './runtime/ResearchRuntime.js'
export * from './runtime/ResearchRuntimeService.js'
export * from './runtime/DefaultResearchTaskWorker.js'
export * from './runtime/DeepSeekWebSearchProvider.js'
export * from './runtime/ModelResearchTaskWorker.js'
export * from './runtime/SeededWebResearchTaskWorker.js'
export * from './storage/ResearchRunRepository.js'
export * from './verification/QualityJudge.js'
export * from './verification/QualityVerifier.js'

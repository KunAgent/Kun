/**
 * [INPUT]: 依赖 ResearchTaskWorkerInput 的 brief、frame 和 task 信息
 * [OUTPUT]: 对外提供 DefaultResearchTaskWorker，生成 quick diagnostic 用 synthetic 笔记和非关键 claim
 * [POS]: research/runtime 的无外部证据诊断 worker，只用于 P0/dev/quick 链路，不产生可引用强证据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchTaskWorker, ResearchTaskWorkerInput, WorkerResult } from '../agents/types.js'
import { hashText } from '../core/hash.js'
import type { AtomicClaim, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'

export class DefaultResearchTaskWorker implements ResearchTaskWorker {
  async runTask(input: ResearchTaskWorkerInput): Promise<WorkerResult> {
    const now = new Date().toISOString()
    const source: SourceRecord = {
      id: `${input.task.id}_source_1`,
      sourceType: 'local_file',
      title: `调研请求简报：${input.brief.topic}`,
      path: 'synthetic://deep-research/request-brief',
      accessedAt: now,
      importedAt: now,
      reliability: 'unknown',
      reliabilityReason: '第一版运行链路中，由已确认简报生成的模拟来源。',
      sourcePolicyTags: ['synthetic', 'p0-runtime'],
      fingerprint: hashText(`${input.runId}:${input.task.id}:synthetic-source`),
      status: 'fetched',
      kind: 'user_file'
    }
    const spanText = [
      `主题：${input.brief.topic}。`,
      `用户意图：${input.brief.userIntent}。`,
      `核心主线：${input.frame.coreResearchThread}。`,
      `任务目标：${input.task.objective}。`
    ].join(' ')
    const span: EvidenceSpan = {
      id: `${input.task.id}_span_1`,
      sourceId: source.id,
      text: spanText,
      textHash: hashText(spanText),
      location: {
        headingPath: ['已确认简报', input.task.id],
        paragraphIndex: 1
      },
      extractedAt: now,
      extractorRunId: input.runId
    }
    const claim: AtomicClaim = {
      id: `${input.task.id}_claim_1`,
      text: `已确认简报将「${input.brief.topic}」组织在这条主线下：${input.frame.coreResearchThread}`,
      entities: [input.brief.topic],
      claimType: 'inference',
      supportSpanIds: [span.id],
      confidence: 'medium',
      critical: false
    }
    const note: ResearchNote = {
      id: `${input.task.id}_note_1`,
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      claimIds: [claim.id],
      summary: `第一版运行链路已为「${input.task.objective}」记录结构化调研笔记。`,
      implicationForBrief: `报告应以已确认的核心主线组织内容：${input.frame.coreResearchThread}`,
      confidence: 'medium',
      limitations: ['当前第一版使用模拟来源；真实网页、本地文件等来源后续再接入。']
    }
    return {
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      unresolvedQuestions: [],
      conflicts: [],
      suggestedNextQueries: input.task.searchHints
    }
  }
}

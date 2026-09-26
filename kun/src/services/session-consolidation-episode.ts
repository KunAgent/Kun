import { createHash } from 'node:crypto'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnItem } from '../contracts/items.js'
import {
  MEMORY_MAX_SOURCE_EXCERPT_CHARS,
  type MemoryCreateRequest,
  type MemorySourceEvidence
} from '../contracts/memory.js'
import type { ModelClient } from '../ports/model-client.js'
import {
  buildSessionTranscript,
  generateSessionSummary,
  type SessionSummaryOutcome
} from '../loop/session-summary.js'
import { containsSensitiveConsolidationData } from './session-consolidation-safety.js'

export const CONSOLIDATION_EPISODE_MAX_CONTENT_CHARS = 4_096

export type ConsolidationEpisode = {
  input: MemoryCreateRequest
  excerpt: string
  contentHash: string
  source: MemorySourceEvidence
}

export async function buildConsolidationEpisode(input: {
  thread: ThreadRecord
  items: readonly TurnItem[]
  cutoffRevision: string
  modelClient: ModelClient
  model: string
  providerId?: string
  accountId?: string
  systemPrompt?: string
  reasoningEffort?: string
  inputMaxBytes: number
  maxTokens: number
  timeoutMs?: number
  nowIso: string
}): Promise<ConsolidationEpisode | { blocked: 'sensitive' } | { blocked: 'summary_failed'; reason: string }> {
  const excerpt = buildSessionTranscript(input.items, input.inputMaxBytes)
  if (!excerpt.trim() || containsSensitiveConsolidationData(input.thread.title, excerpt)) {
    return { blocked: 'sensitive' }
  }

  const outcome = await generateSessionSummary({
    threadId: input.thread.id,
    modelClient: input.modelClient,
    model: input.model,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    items: input.items,
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    inputMaxBytes: input.inputMaxBytes,
    maxTokens: input.maxTokens,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  })
  if (!outcome.ok) return { blocked: 'summary_failed', reason: summaryFailure(outcome) }
  if (containsSensitiveConsolidationData(outcome.summary)) return { blocked: 'sensitive' }

  const content = `Session episode: ${outcome.summary}`.slice(0, CONSOLIDATION_EPISODE_MAX_CONTENT_CHARS)
  const contentHash = createHash('sha256').update(excerpt, 'utf8').digest('hex')
  const sourceDigest = createHash('sha256')
    .update(JSON.stringify([input.thread.id, input.cutoffRevision, contentHash]), 'utf8')
    .digest('hex')
  const source: MemorySourceEvidence = {
    id: `src_consolidation_${sourceDigest.slice(0, 24)}`,
    kind: 'inference',
    threadId: input.thread.id,
    ...(lastCompletedTurnId(input.thread) ? { turnId: lastCompletedTurnId(input.thread) } : {}),
    excerpt: excerpt.slice(0, MEMORY_MAX_SOURCE_EXCERPT_CHARS),
    contentHash,
    trust: 'inferred'
  }
  return {
    input: {
      content,
      scope: 'workspace',
      workspace: input.thread.workspace,
      sourceThreadId: input.thread.id,
      ...(lastCompletedTurnId(input.thread) ? { sourceTurnId: lastCompletedTurnId(input.thread) } : {}),
      provenance: {
        kind: 'inference',
        ...(lastCompletedTurnId(input.thread) ? { turnId: lastCompletedTurnId(input.thread) } : {})
      },
      tags: ['session-episode', 'archive'],
      confidence: 0.7,
      type: 'episode',
      authority: 'reference',
      importance: 0.5,
      observedAt: input.nowIso,
      sources: [source]
    },
    excerpt,
    contentHash,
    source
  }
}

function lastCompletedTurnId(thread: ThreadRecord): string | undefined {
  return [...thread.turns]
    .filter((turn) => turn.status === 'completed' && Boolean(turn.finishedAt))
    .sort((left, right) => Date.parse(right.finishedAt!) - Date.parse(left.finishedAt!))[0]?.id
}

function summaryFailure(outcome: Extract<SessionSummaryOutcome, { ok: false }>): string {
  return outcome.reason === 'model_error'
    ? outcome.message ?? outcome.reason
    : outcome.reason
}

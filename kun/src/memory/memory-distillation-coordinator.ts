import { createHash } from 'node:crypto'
import type { TurnItem } from '../contracts/items.js'
import {
  MemoryDistillationExtractionResponse,
  type MemoryDistillationDecisionRequest,
  type PendingMemoryCandidate
} from '../contracts/memory-distillation-runtime.js'
import type { MemoryCandidate, MemoryCandidateAssessmentInput } from '../contracts/memory-distillation.js'
import type { MemoryRecord, MemorySourceEvidence } from '../contracts/memory.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { UsageService } from '../services/usage-service.js'
import { decideMemoryCandidate, MemoryDistillationDecisionError } from './memory-distillation.js'
import {
  applyMemoryDistillationCandidate,
  buildMemoryDistillationApplyReceipt,
  MemoryDistillationConflictError,
  memoryRecordMatchesDistillationCandidate,
  validateMemoryDistillationApplyIntent
} from './memory-distillation-apply.js'
import {
  MemoryDistillationPendingStore,
  type PendingMemoryCandidateInsert
} from './memory-distillation-pending-store.js'
import type { MemoryStore } from './memory-store.js'

export const MEMORY_DISTILLATION_MAX_INPUT_CHARS = 24_000
export const MEMORY_DISTILLATION_MAX_OUTPUT_TOKENS = 2_048
export const MEMORY_DISTILLATION_TIMEOUT_MS = 15_000
const MEMORY_DISTILLATION_MAX_OUTPUT_CHARS = 32_768

const SYSTEM_PROMPT = `Extract only durable user facts, preferences, and decisions from the current
turn. Return one strict JSON object: {"candidates":[...]}. Each candidate must contain content,
type, confidence, importance, tags, sourceIds, durability, and comparisons. sourceIds may only name
ids from currentTurn and comparisons may only name ids from authorizedMemories. Do not include
credentials, temporary requests, scope, paths, observation time, full source records, or authority.
Return at most 8 candidates. If none qualify, return {"candidates":[]}.`

export type MemoryDistillationCoordinatorOptions = {
  threads: ThreadStore
  model: ModelClient
  pending: MemoryDistillationPendingStore
  memoryStore: () => MemoryStore | undefined
  enabled: () => boolean
  nowIso?: () => string
  timeoutMs?: number
  usage?: UsageService
  events?: RuntimeEventRecorder
  onDiagnostic?: (input: { threadId: string; turnId: string; message: string }) => void
}

export class MemoryDistillationCoordinator {
  private approvalMutation = Promise.resolve()
  private readonly activeRuns = new Set<Promise<unknown>>()
  private readonly extractionControllers = new Set<AbortController>()
  private shuttingDown = false

  constructor(private readonly options: MemoryDistillationCoordinatorOptions) {}

  async ready(): Promise<void> {
    await this.options.pending.ready()
    if (!this.options.memoryStore()) return
    const applying = await this.options.pending.list({ status: 'applying' })
    for (const candidate of applying) {
      await this.withApprovalMutation(() => this.reconcileApplying(candidate)).catch((error) => {
        this.diagnose(candidate.threadId, candidate.turnId, error)
      })
    }
  }

  schedule(input: {
    threadId: string
    turnId: string
    status: 'completed' | 'failed' | 'aborted'
  }): void {
    if (this.shuttingDown || input.status !== 'completed' || !this.options.enabled()) return
    const run = this.distill(input.threadId, input.turnId).catch((error) => {
      this.diagnose(input.threadId, input.turnId, error)
    })
    this.activeRuns.add(run)
    void run.finally(() => this.activeRuns.delete(run))
  }

  async distill(threadId: string, turnId: string): Promise<PendingMemoryCandidate[]> {
    if (this.shuttingDown || !this.options.enabled()) return []
    const memoryStore = this.options.memoryStore()
    if (!memoryStore) return []
    const thread = await this.options.threads.get(threadId)
    const turn = thread?.turns.find((entry) => entry.id === turnId)
    if (!thread?.workspace || !turn || turn.status !== 'completed' || turn.messageSource) return []
    const userText = turn.prompt.trim()
    const assistantText = turn.items
      .flatMap((item) => item.kind === 'assistant_text' && item.status === 'completed' ? [item.text] : [])
      .join('\n')
      .trim()
    if (!userText || !assistantText) return []
    if (!await this.options.pending.beginRun(threadId, turnId)) {
      return this.options.pending.list({ workspace: thread.workspace })
        .then((entries) => entries.filter((entry) => entry.turnId === turnId))
    }

    try {
      const authorized = (await memoryStore.retrieve({
        query: `${userText}\n${assistantText}`.slice(0, 4_096),
        workspace: thread.workspace,
        limit: 8,
        promptCharacterBudget: 8_192
      })).filter((record) => record.scope === 'workspace')
      const route = turn.actingModelRoute ?? {
        model: turn.model ?? thread.model,
        providerId: turn.providerId ?? thread.providerId,
        accountId: turn.accountId ?? thread.accountId
      }
      if (!route.model) throw new Error('initiating model route is unavailable')
      const sources = buildSources({ threadId, turnId, userText, assistantText })
      const extraction = await this.extract({
        threadId,
        turnId,
        userText,
        assistantText,
        sources,
        authorized,
        route,
        serviceTier: turn.serviceTier
      })
      const observedAt = this.now()
      const inserts: PendingMemoryCandidateInsert[] = []
      for (const extracted of extraction.candidates) {
        const assessment: MemoryCandidateAssessmentInput = {
          candidate: {
            content: extracted.content,
            type: extracted.type,
            confidence: extracted.confidence,
            importance: extracted.importance,
            tags: extracted.tags,
            sourceIds: extracted.sourceIds
          },
          durability: extracted.durability,
          comparisons: extracted.comparisons
        }
        try {
          const decision = decideMemoryCandidate(
            assessment,
            authorized,
            { observedAt, sources },
            Date.parse(observedAt)
          )
          if (decision.action === 'skip') continue
          const proposedAction = decision.action === 'create'
            ? { action: 'create' as const }
            : {
                action: decision.action,
                memoryId: decision.memoryId,
                targetUpdatedAt: authorizedTarget(authorized, decision.memoryId).updatedAt
              }
          inserts.push({
            threadId,
            turnId,
            target: { scope: 'workspace', workspace: thread.workspace },
            candidate: decision.candidate,
            proposedAction
          })
        } catch (error) {
          if (!(error instanceof MemoryDistillationDecisionError)) throw error
          this.diagnose(threadId, turnId, error)
        }
      }
      return await this.options.pending.completeRun(threadId, turnId, inserts)
    } catch (error) {
      const diagnostic = sanitizeMemoryDistillationDiagnostic(error)
      await this.options.pending.failRun(threadId, turnId, diagnostic)
      this.options.onDiagnostic?.({ threadId, turnId, message: diagnostic })
      return []
    }
  }

  async list(workspace: string, status?: PendingMemoryCandidate['status']) {
    return this.options.pending.list({ workspace, ...(status ? { status } : {}) })
  }

  async decide(
    id: string,
    request: MemoryDistillationDecisionRequest,
    workspace: string
  ): Promise<PendingMemoryCandidate> {
    return this.withApprovalMutation(async () => {
      const current = await this.options.pending.get(id)
      if (!current || current.target.workspace !== workspace) {
        throw new Error(`memory distillation candidate not found: ${id}`)
      }
      if (request.decision === 'deny') {
        return this.options.pending.transition(id, ['pending'], 'denied')
      }
      if (request.decision === 'withdraw') {
        return this.options.pending.transition(id, ['pending'], 'withdrawn')
      }
      if (current.status === 'applying') return this.reconcileApplying(current)
      if (current.status !== 'pending') {
        throw new Error(`memory distillation candidate is already ${current.status}`)
      }
      return this.allow(current)
    })
  }

  async markTimedOut(id: string): Promise<PendingMemoryCandidate> {
    return this.withApprovalMutation(() =>
      this.options.pending.transition(id, ['pending'], 'timed-out')
    )
  }

  private async allow(current: PendingMemoryCandidate): Promise<PendingMemoryCandidate> {
    const memoryStore = this.options.memoryStore()
    if (!memoryStore) throw new Error('memory store is unavailable')
    try {
      const target = await validateMemoryDistillationApplyIntent(
        memoryStore,
        current,
        Date.parse(this.now())
      )
      const applying = await this.options.pending.transition(
        current.id,
        ['pending'],
        'applying',
        { applyReceipt: buildMemoryDistillationApplyReceipt(current) }
      )
      const record = await applyMemoryDistillationCandidate(memoryStore, applying, target)
      return await this.options.pending.transition(
        current.id,
        ['applying'],
        'allowed',
        { memoryId: record.id }
      )
    } catch (error) {
      await this.recordApplyFailure(current.id, error).catch(() => undefined)
      throw error
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const reason = new Error('runtime is shutting down during memory distillation')
    for (const controller of this.extractionControllers) controller.abort(reason)
    await Promise.allSettled([...this.activeRuns])
  }

  private async reconcileApplying(
    current: PendingMemoryCandidate
  ): Promise<PendingMemoryCandidate> {
    const memoryStore = this.options.memoryStore()
    if (!memoryStore) throw new Error('memory store is unavailable')
    try {
      if (!current.applyReceipt) {
        throw new MemoryDistillationConflictError('apply receipt is missing')
      }
      const records = await memoryStore.list({
        workspace: current.target.workspace,
        includeDeleted: true
      })
      const expected = records.find((record) =>
        record.id === current.applyReceipt!.expectedMemoryId
      )
      if (expected && memoryRecordMatchesDistillationCandidate(expected, current)) {
        const action = current.proposedAction
        if (action.action === 'supersede') {
          const target = records.find((record) =>
            record.id === action.memoryId
          )
          if (!target) {
            throw new MemoryDistillationConflictError('the supersede target is unavailable')
          }
          if (!target.supersededAt) {
            await applyMemoryDistillationCandidate(memoryStore, current, target)
          }
        }
        return this.options.pending.transition(
          current.id,
          ['applying'],
          'allowed',
          { memoryId: expected.id }
        )
      }
      if (expected && current.proposedAction.action !== 'update') {
        throw new MemoryDistillationConflictError('the expected Memory record changed')
      }

      const target = await validateMemoryDistillationApplyIntent(
        memoryStore,
        current,
        Date.parse(this.now())
      )
      const record = await applyMemoryDistillationCandidate(memoryStore, current, target)
      return this.options.pending.transition(
        current.id,
        ['applying'],
        'allowed',
        { memoryId: record.id }
      )
    } catch (error) {
      await this.recordApplyFailure(current.id, error).catch(() => undefined)
      throw error
    }
  }

  private async recordApplyFailure(id: string, error: unknown): Promise<void> {
    const current = await this.options.pending.get(id)
    if (!current || (current.status !== 'pending' && current.status !== 'applying')) return
    const diagnostic = sanitizeMemoryDistillationDiagnostic(error)
    await this.options.pending.transition(
      id,
      [current.status],
      error instanceof MemoryDistillationConflictError ? 'conflicted' : current.status,
      { reason: diagnostic }
    )
  }

  private withApprovalMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.approvalMutation.then(operation, operation)
    this.approvalMutation = run.then(() => undefined, () => undefined)
    return run
  }

  private async extract(input: {
    threadId: string
    turnId: string
    userText: string
    assistantText: string
    sources: readonly MemorySourceEvidence[]
    authorized: readonly MemoryRecord[]
    route: { model: string; providerId?: string; accountId?: string }
    serviceTier?: ModelRequest['serviceTier']
  }) {
    const payload = buildExtractionPayload(
      input.userText,
      input.assistantText,
      input.sources,
      input.authorized
    )
    if (payload.truncated) {
      this.options.onDiagnostic?.({
        threadId: input.threadId,
        turnId: input.turnId,
        message: 'memory distillation input was truncated to 24000 characters'
      })
    }
    const controller = new AbortController()
    this.extractionControllers.add(controller)
    if (this.shuttingDown) {
      controller.abort(new Error('runtime is shutting down during memory distillation'))
    }
    const timeout = setTimeout(
      () => controller.abort(new Error('memory distillation timed out')),
      this.options.timeoutMs ?? MEMORY_DISTILLATION_TIMEOUT_MS
    )
    const requestItem = makeUserItem(
      input.threadId,
      `${input.turnId}__memory_distillation`,
      payload.text
    )
    let output = ''
    try {
      const request: ModelRequest = {
        threadId: input.threadId,
        turnId: `${input.turnId}__memory_distillation`,
        model: input.route.model,
        ...(input.route.providerId ? { providerId: input.route.providerId } : {}),
        ...(input.route.accountId ? { accountId: input.route.accountId } : {}),
        systemPrompt: SYSTEM_PROMPT,
        contextInstructions: [],
        prefix: [],
        history: [requestItem],
        tools: [],
        stream: false,
        maxTokens: MEMORY_DISTILLATION_MAX_OUTPUT_TOKENS,
        temperature: 0,
        topP: 1,
        responseFormat: 'json_object',
        reasoningEffort: 'off',
        ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
        abortSignal: controller.signal
      }
      for await (const chunk of this.options.model.stream(request)) {
        if (chunk.kind === 'assistant_text_delta') {
          output += chunk.text
          if (output.length > MEMORY_DISTILLATION_MAX_OUTPUT_CHARS) {
            throw new Error('memory distillation output exceeded its limit')
          }
        } else if (chunk.kind === 'tool_call_delta' || chunk.kind === 'tool_call_complete') {
          throw new Error('memory distillation model attempted a tool call')
        } else if (chunk.kind === 'usage' && this.options.usage && this.options.events) {
          const usage = this.options.usage.record(input.threadId, chunk.usage)
          await this.options.events.record({
            kind: 'usage',
            threadId: input.threadId,
            turnId: input.turnId,
            model: input.route.model,
            ...(input.route.providerId ? { providerId: input.route.providerId } : {}),
            ...(input.route.accountId ? { accountId: input.route.accountId } : {}),
            attribution: 'memory-distillation',
            usage
          })
        } else if (chunk.kind === 'error') {
          throw new Error(chunk.message)
        }
      }
      controller.signal.throwIfAborted()
      return MemoryDistillationExtractionResponse.parse(JSON.parse(output))
    } finally {
      clearTimeout(timeout)
      this.extractionControllers.delete(controller)
    }
  }

  private diagnose(threadId: string, turnId: string, error: unknown): void {
    this.options.onDiagnostic?.({
      threadId,
      turnId,
      message: sanitizeMemoryDistillationDiagnostic(error)
    })
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

export function sanitizeMemoryDistillationDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/\b(api[ _-]?key|token|secret|password)\s*[:=]\s*\S+/giu, '$1=[redacted]')
    .replace(/file:\/\/\/?[^\s"']+/giu, '[path]')
    .replace(/\\\\[^\s\\/]+[\\/][^\s"']+/gu, '[path]')
    .replace(/\b[A-Za-z]:[\\/][^\s"']+/gu, '[path]')
    .replace(/(^|\s)\/(?:[^\s/]+\/)*[^\s"']*/gu, '$1[path]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 512) || 'memory distillation failed'
}

function makeUserItem(threadId: string, turnId: string, text: string): TurnItem {
  const createdAt = new Date().toISOString()
  return {
    id: `${turnId}_input`,
    turnId,
    threadId,
    role: 'user',
    status: 'completed',
    kind: 'user_message',
    text,
    createdAt,
    finishedAt: createdAt
  }
}

function buildSources(input: {
  threadId: string
  turnId: string
  userText: string
  assistantText: string
}): MemorySourceEvidence[] {
  return [
    source('user', 'explicit-user', input.userText, input.threadId, input.turnId),
    source('inference', 'inferred', input.assistantText, input.threadId, input.turnId)
  ]
}

function source(
  kind: 'user' | 'inference',
  trust: 'explicit-user' | 'inferred',
  text: string,
  threadId: string,
  turnId: string
): MemorySourceEvidence {
  const contentHash = createHash('sha256').update(text, 'utf8').digest('hex')
  const identityHash = createHash('sha256')
    .update([threadId, turnId, kind, contentHash].join('\0'), 'utf8')
    .digest('hex')
  return {
    id: `src_${identityHash.slice(0, 24)}`,
    kind,
    threadId,
    turnId,
    excerpt: text.slice(0, 512),
    contentHash,
    trust
  }
}

function authorizedTarget(records: readonly MemoryRecord[], id: string): MemoryRecord {
  const target = records.find((record) => record.id === id)
  if (!target) {
    throw new MemoryDistillationDecisionError(
      `comparison target is not an authorized active memory: ${id}`
    )
  }
  return target
}

function buildExtractionPayload(
  userText: string,
  assistantText: string,
  sources: readonly MemorySourceEvidence[],
  authorized: readonly MemoryRecord[]
): { text: string; truncated: boolean } {
  let userLimit = 8_000
  let assistantLimit = 8_000
  let memoryLimit = 800
  const sourceLength = userText.length + assistantText.length +
    authorized.reduce((sum, record) => sum + record.content.length, 0)
  while (true) {
    const text = JSON.stringify({
      currentTurn: {
        user: {
          sourceId: sources[0]?.id,
          text: userText.slice(0, userLimit)
        },
        assistant: {
          sourceId: sources[1]?.id,
          text: assistantText.slice(0, assistantLimit)
        }
      },
      authorizedMemories: authorized.map((record) => ({
        id: record.id,
        content: record.content.slice(0, memoryLimit),
        type: record.type
      }))
    })
    if (text.length <= MEMORY_DISTILLATION_MAX_INPUT_CHARS) {
      return { text, truncated: text.length < sourceLength }
    }
    if (assistantLimit > 1_000) assistantLimit = Math.floor(assistantLimit * 0.75)
    else if (userLimit > 1_000) userLimit = Math.floor(userLimit * 0.75)
    else if (memoryLimit > 100) memoryLimit = Math.floor(memoryLimit * 0.75)
    else throw new Error('memory distillation input cannot fit its hard limit')
  }
}

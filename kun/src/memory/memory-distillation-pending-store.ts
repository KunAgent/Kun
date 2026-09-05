import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  MEMORY_DISTILLATION_PENDING_TTL_MS,
  MEMORY_DISTILLATION_STORE_VERSION,
  MemoryDistillationStoreState,
  PendingMemoryCandidate,
  type MemoryDistillationApplyReceipt,
  type MemoryDistillationCandidateStatus,
  type MemoryDistillationRun,
  type MemoryDistillationStoreState as MemoryDistillationStoreStateValue,
  type PendingMemoryCandidate as PendingMemoryCandidateValue
} from '../contracts/memory-distillation-runtime.js'
import type { MemoryCandidate } from '../contracts/memory-distillation.js'
import { MemoryDistillationCandidateInsert as CandidateInsert } from '../contracts/memory-distillation-storage.js'
import { withMemoryMutation } from './memory-mutation-queue.js'

export type PendingMemoryCandidateInsert = z.input<typeof CandidateInsert>

export class MemoryDistillationPendingStore {
  private state: MemoryDistillationStoreStateValue | undefined

  constructor(private readonly options: {
    dataDir: string
    nowIso?: () => string
    pendingTtlMs?: number
    writeState?: (path: string, contents: string) => Promise<void>
  }) {}

  async ready(): Promise<void> {
    await this.withMutation(async () => {
      await this.load()
      await this.recoverInterruptedLocked()
      await this.expireDueLocked()
    })
  }

  async beginRun(threadId: string, turnId: string): Promise<boolean> {
    return this.withMutation(async () => {
      const state = copyState(await this.load())
      if (state.runs.some((run) => run.threadId === threadId && run.turnId === turnId)) {
        return false
      }
      const createdAt = this.now()
      state.runs.push({
        schemaVersion: MEMORY_DISTILLATION_STORE_VERSION,
        id: stableId('run', threadId, turnId),
        threadId,
        turnId,
        status: 'processing',
        createdAt
      })
      await this.persist(state)
      return true
    })
  }

  async completeRun(
    threadId: string,
    turnId: string,
    inserts: readonly PendingMemoryCandidateInsert[]
  ): Promise<PendingMemoryCandidateValue[]> {
    return this.withMutation(async () => {
      const state = copyState(await this.load())
      const run = mustFindRun(state, threadId, turnId)
      if (run.status !== 'processing') return candidatesForTurn(state, threadId, turnId)
      const createdAt = this.now()
      const expiresAt = new Date(
        Date.parse(createdAt) + (this.options.pendingTtlMs ?? MEMORY_DISTILLATION_PENDING_TTL_MS)
      ).toISOString()
      for (const raw of inserts) {
        const input = CandidateInsert.parse(raw)
        const fingerprint = candidateFingerprint(input.threadId, input.turnId, input.candidate)
        if (state.candidates.some((candidate) => candidate.fingerprint === fingerprint)) continue
        const candidate = PendingMemoryCandidate.parse({
          schemaVersion: MEMORY_DISTILLATION_STORE_VERSION,
          id: `mdc_${fingerprint.slice(0, 24)}`,
          fingerprint,
          ...input,
          status: 'pending',
          createdAt,
          expiresAt,
          history: [{ status: 'pending', at: createdAt }]
        })
        state.candidates.push(candidate)
      }
      replaceRun(state, run, {
        ...run,
        status: 'completed',
        completedAt: createdAt,
        candidateCount: candidatesForTurn(state, threadId, turnId).length
      })
      await this.persist(state)
      return candidatesForTurn(state, threadId, turnId)
    })
  }

  async failRun(threadId: string, turnId: string, diagnostic: string): Promise<void> {
    await this.withMutation(async () => {
      const state = copyState(await this.load())
      const run = mustFindRun(state, threadId, turnId)
      if (run.status !== 'processing') return
      const completedAt = this.now()
      replaceRun(state, run, {
        ...run,
        status: 'failed',
        completedAt,
        diagnostic: diagnostic.slice(0, 512)
      })
      await this.persist(state)
    })
  }

  async list(input: {
    workspace?: string
    status?: MemoryDistillationCandidateStatus
  } = {}): Promise<PendingMemoryCandidateValue[]> {
    return this.withMutation(async () => {
      await this.load()
      await this.expireDueLocked()
      const state = await this.load()
      return state.candidates
        .filter((candidate) => !input.workspace || candidate.target.workspace === input.workspace)
        .filter((candidate) => !input.status || candidate.status === input.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) ||
          left.id.localeCompare(right.id))
        .map((candidate) => PendingMemoryCandidate.parse(candidate))
    })
  }

  async get(id: string): Promise<PendingMemoryCandidateValue | null> {
    return this.withMutation(async () => {
      await this.load()
      await this.expireDueLocked()
      const state = await this.load()
      const candidate = state.candidates.find((entry) => entry.id === id)
      return candidate ? PendingMemoryCandidate.parse(candidate) : null
    })
  }

  async transition(
    id: string,
    from: readonly MemoryDistillationCandidateStatus[],
    to: MemoryDistillationCandidateStatus,
    options: {
      reason?: string
      memoryId?: string
      applyReceipt?: MemoryDistillationApplyReceipt
    } = {}
  ): Promise<PendingMemoryCandidateValue> {
    return this.withMutation(async () => {
      await this.expireDueLocked()
      const state = copyState(await this.load())
      const index = state.candidates.findIndex((candidate) => candidate.id === id)
      if (index < 0) throw new Error(`memory distillation candidate not found: ${id}`)
      const current = state.candidates[index]!
      if (!from.includes(current.status)) {
        throw new Error(`memory distillation candidate is already ${current.status}`)
      }
      const at = this.now()
      const next = PendingMemoryCandidate.parse({
        ...current,
        status: to,
        history: [...current.history, {
          status: to,
          at,
          ...(options.reason ? { reason: options.reason.slice(0, 512) } : {})
        }],
        ...(options.applyReceipt ? { applyReceipt: options.applyReceipt } : {}),
        ...(options.memoryId ? { memoryId: options.memoryId } : {})
      })
      state.candidates[index] = next
      await this.persist(state)
      return next
    })
  }

  async expireDue(): Promise<number> {
    return this.withMutation(() => this.expireDueLocked())
  }

  private async expireDueLocked(): Promise<number> {
    const current = await this.load()
    const now = this.now()
    const hasDue = current.candidates.some((candidate) =>
      candidate.status === 'pending' && candidate.expiresAt <= now
    )
    if (!hasDue) return 0
    const state = copyState(current)
    let count = 0
    state.candidates = state.candidates.map((candidate) => {
      if (candidate.status !== 'pending' || candidate.expiresAt > now) return candidate
      count += 1
      return PendingMemoryCandidate.parse({
        ...candidate,
        status: 'expired',
        history: [...candidate.history, { status: 'expired', at: now, reason: 'approval expired' }]
      })
    })
    if (count > 0) await this.persist(state)
    return count
  }

  private async recoverInterruptedLocked(): Promise<void> {
    const current = await this.load()
    if (!current.runs.some((run) => run.status === 'processing')) return
    const state = copyState(current)
    const at = this.now()
    state.runs = state.runs.map((run) => {
      if (run.status !== 'processing') return run
      return {
        ...run,
        status: 'failed',
        completedAt: at,
        diagnostic: 'runtime restarted during memory distillation'
      }
    })
    await this.persist(state)
  }

  private async load(): Promise<MemoryDistillationStoreStateValue> {
    if (this.state) return this.state
    try {
      const text = await readFile(this.path(), 'utf8')
      this.state = MemoryDistillationStoreState.parse(JSON.parse(text))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = MemoryDistillationStoreState.parse({
        schemaVersion: MEMORY_DISTILLATION_STORE_VERSION,
        runs: [],
        candidates: []
      })
    }
    return this.state
  }

  private async persist(state: MemoryDistillationStoreStateValue): Promise<void> {
    const parsed = MemoryDistillationStoreState.parse(state)
    const contents = `${JSON.stringify(parsed, null, 2)}\n`
    if (this.options.writeState) {
      await this.options.writeState(this.path(), contents)
    } else {
      await atomicWriteFile(this.path(), contents, {
        durable: true,
        allowDirectWriteFallback: false
      })
    }
    this.state = parsed
  }

  private path(): string {
    return join(this.options.dataDir, 'memory-distillation', 'state.json')
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }

  private withMutation<T>(operation: () => Promise<T>): Promise<T> {
    return withMemoryMutation(this.path(), async () => {
      // Another adapter in this owner may have committed since our last read.
      this.state = undefined
      return operation()
    })
  }
}

function copyState(state: MemoryDistillationStoreStateValue): MemoryDistillationStoreStateValue {
  return MemoryDistillationStoreState.parse(structuredClone(state))
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex')
  return `${prefix}_${digest.slice(0, 24)}`
}

function candidateFingerprint(threadId: string, turnId: string, candidate: MemoryCandidate): string {
  return createHash('sha256')
    .update(JSON.stringify({ threadId, turnId, candidate }), 'utf8')
    .digest('hex')
}

function mustFindRun(
  state: MemoryDistillationStoreStateValue,
  threadId: string,
  turnId: string
): MemoryDistillationRun {
  const run = state.runs.find((entry) => entry.threadId === threadId && entry.turnId === turnId)
  if (!run) throw new Error(`memory distillation run not found: ${threadId}/${turnId}`)
  return run
}

function replaceRun(
  state: MemoryDistillationStoreStateValue,
  current: MemoryDistillationRun,
  next: MemoryDistillationRun
): void {
  state.runs[state.runs.indexOf(current)] = next
}

function candidatesForTurn(
  state: MemoryDistillationStoreStateValue,
  threadId: string,
  turnId: string
): PendingMemoryCandidateValue[] {
  return state.candidates.filter((candidate) =>
    candidate.threadId === threadId && candidate.turnId === turnId
  )
}

export type MemoryDistillationPendingStorePort = Pick<MemoryDistillationPendingStore,
  'ready' | 'beginRun' | 'completeRun' | 'failRun' | 'list' | 'get' | 'transition' | 'expireDue'>

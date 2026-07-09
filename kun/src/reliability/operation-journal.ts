import { createHash } from 'node:crypto'

export type ToolOperationIdentity = {
  threadId: string
  turnId: string
  callId: string
  toolName: string
  argsHash: string
}

export type ToolOperationResult = {
  output: unknown
  isError?: boolean
}

export type ToolOperationRecord =
  | {
      status: 'started'
      identity: ToolOperationIdentity
      startedAt: string
    }
  | {
      status: 'completed'
      identity: ToolOperationIdentity
      startedAt: string
      completedAt: string
      result: ToolOperationResult
    }
  | {
      status: 'failed'
      identity: ToolOperationIdentity
      startedAt: string
      failedAt: string
      error: string
    }
  | {
      status: 'unknown'
      identity: ToolOperationIdentity
      startedAt: string
      updatedAt: string
      reason: string
    }

export type ToolOperationJournalOptions = {
  nowIso?: () => string
}

export class ToolOperationJournal {
  private readonly records = new Map<string, ToolOperationRecord>()
  private readonly nowIso: () => string

  constructor(options: ToolOperationJournalOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  static argsHash(args: Record<string, unknown>): string {
    return createHash('sha256').update(stableStringify(args)).digest('hex')
  }

  static key(identity: ToolOperationIdentity): string {
    return [
      identity.threadId,
      identity.turnId,
      identity.callId,
      identity.toolName,
      identity.argsHash
    ].join('\u0000')
  }

  get(identity: ToolOperationIdentity): ToolOperationRecord | undefined {
    return this.records.get(ToolOperationJournal.key(identity))
  }

  getCompleted(identity: ToolOperationIdentity): ToolOperationResult | null {
    const record = this.get(identity)
    return record?.status === 'completed' ? record.result : null
  }

  begin(identity: ToolOperationIdentity): void {
    const key = ToolOperationJournal.key(identity)
    const existing = this.records.get(key)
    if (existing?.status === 'completed') return
    this.records.set(key, {
      status: 'started',
      identity,
      startedAt: this.nowIso()
    })
  }

  complete(identity: ToolOperationIdentity, result: ToolOperationResult): void {
    const key = ToolOperationJournal.key(identity)
    const existing = this.records.get(key)
    this.records.set(key, {
      status: 'completed',
      identity,
      startedAt: existing?.startedAt ?? this.nowIso(),
      completedAt: this.nowIso(),
      result
    })
  }

  fail(identity: ToolOperationIdentity, error: unknown): void {
    const key = ToolOperationJournal.key(identity)
    const existing = this.records.get(key)
    this.records.set(key, {
      status: 'failed',
      identity,
      startedAt: existing?.startedAt ?? this.nowIso(),
      failedAt: this.nowIso(),
      error: error instanceof Error ? error.message : String(error)
    })
  }

  unknown(identity: ToolOperationIdentity, reason: string): void {
    const key = ToolOperationJournal.key(identity)
    const existing = this.records.get(key)
    this.records.set(key, {
      status: 'unknown',
      identity,
      startedAt: existing?.startedAt ?? this.nowIso(),
      updatedAt: this.nowIso(),
      reason
    })
  }

  clear(): void {
    this.records.clear()
  }
}

export function createToolOperationIdentity(input: {
  threadId: string
  turnId: string
  callId: string
  toolName: string
  args: Record<string, unknown>
}): ToolOperationIdentity {
  return {
    threadId: input.threadId,
    turnId: input.turnId,
    callId: input.callId,
    toolName: input.toolName,
    argsHash: ToolOperationJournal.argsHash(input.args)
  }
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'string') return JSON.stringify(value)
  if (type === 'number' || type === 'boolean') return JSON.stringify(value)
  if (type === 'bigint') return JSON.stringify(String(value))
  if (type === 'undefined') return '"[undefined]"'
  if (type === 'function') return '"[function]"'
  if (type === 'symbol') return JSON.stringify(String(value))
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value && type === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

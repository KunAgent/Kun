import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'

const MAX_STORED_RESULT_BYTES = 64 * 1024

const OperationResult = z.object({
  output: z.unknown(),
  isError: z.boolean().optional()
}).strict()

export const OperationRecord = z.object({
  operationId: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  toolName: z.string().min(1),
  inputHash: z.string().min(1),
  replaySafe: z.boolean(),
  status: z.enum(['started', 'completed', 'failed']),
  attempt: z.number().int().positive(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  resultStored: z.boolean().default(false),
  result: OperationResult.optional(),
  error: z.string().optional()
}).strict()
export type OperationRecord = z.infer<typeof OperationRecord>

export type OperationIdentity = {
  threadId: string
  turnId: string
  callId: string
  toolName: string
  arguments: Record<string, unknown>
  replaySafe: boolean
}

export type OperationInspection =
  | { kind: 'new'; operationId: string }
  | { kind: 'reuse'; record: OperationRecord; result: z.infer<typeof OperationResult> }
  | { kind: 'replay-safe'; record: OperationRecord }
  | { kind: 'uncertain'; record: OperationRecord }
  | { kind: 'collision'; record: OperationRecord }

export interface OperationJournal {
  inspect(input: OperationIdentity): Promise<OperationInspection>
  start(input: OperationIdentity): Promise<OperationRecord>
  complete(operationId: string, result: { output: unknown; isError?: boolean }): Promise<OperationRecord>
  fail(operationId: string, error: string): Promise<OperationRecord>
}

export class FileOperationJournal implements OperationJournal {
  constructor(
    private readonly rootDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async inspect(input: OperationIdentity): Promise<OperationInspection> {
    const operationId = operationIdFor(input.threadId, input.callId)
    const record = await this.read(operationId)
    if (!record) return { kind: 'new', operationId }
    if (record.toolName !== input.toolName || record.inputHash !== hashOperationInput(input.toolName, input.arguments)) {
      return { kind: 'collision', record }
    }
    if (record.status === 'completed' && record.resultStored && record.result) {
      return { kind: 'reuse', record, result: record.result }
    }
    if (input.replaySafe) return { kind: 'replay-safe', record }
    return { kind: 'uncertain', record }
  }

  async start(input: OperationIdentity): Promise<OperationRecord> {
    const operationId = operationIdFor(input.threadId, input.callId)
    const existing = await this.read(operationId)
    const record = OperationRecord.parse({
      operationId,
      threadId: input.threadId,
      turnId: input.turnId,
      callId: input.callId,
      toolName: input.toolName,
      inputHash: hashOperationInput(input.toolName, input.arguments),
      replaySafe: input.replaySafe,
      status: 'started',
      attempt: (existing?.attempt ?? 0) + 1,
      startedAt: this.nowIso(),
      resultStored: false
    })
    await this.write(record)
    return record
  }

  async complete(
    operationId: string,
    result: { output: unknown; isError?: boolean }
  ): Promise<OperationRecord> {
    const current = await this.mustRead(operationId)
    const stored = storableResult(result)
    const record = OperationRecord.parse({
      ...current,
      status: 'completed',
      finishedAt: this.nowIso(),
      resultStored: stored !== undefined,
      result: stored,
      error: undefined
    })
    await this.write(record)
    return record
  }

  async fail(operationId: string, error: string): Promise<OperationRecord> {
    const current = await this.mustRead(operationId)
    const record = OperationRecord.parse({
      ...current,
      status: 'failed',
      finishedAt: this.nowIso(),
      resultStored: false,
      result: undefined,
      error
    })
    await this.write(record)
    return record
  }

  private async read(operationId: string): Promise<OperationRecord | null> {
    try {
      return OperationRecord.parse(JSON.parse(await readFile(this.path(operationId), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async mustRead(operationId: string): Promise<OperationRecord> {
    const record = await this.read(operationId)
    if (!record) throw new Error(`operation journal record not found: ${operationId}`)
    return record
  }

  private async write(record: OperationRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    await atomicWriteFile(this.path(record.operationId), JSON.stringify(record, null, 2))
  }

  private path(operationId: string): string {
    const key = createHash('sha256').update(operationId).digest('hex')
    return join(this.rootDir, `${key}.json`)
  }
}

export function operationIdFor(threadId: string, callId: string): string {
  return `op_${createHash('sha256').update(`${threadId}\n${callId}`).digest('hex').slice(0, 32)}`
}

export function hashOperationInput(toolName: string, input: unknown): string {
  return createHash('sha256')
    .update(`${toolName}\n${JSON.stringify(sortKeys(input))}`)
    .digest('hex')
    .slice(0, 32)
}

function storableResult(result: { output: unknown; isError?: boolean }): z.infer<typeof OperationResult> | undefined {
  try {
    const json = JSON.stringify(result)
    if (Buffer.byteLength(json, 'utf8') > MAX_STORED_RESULT_BYTES) return undefined
    return OperationResult.parse(JSON.parse(json))
  } catch {
    return undefined
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}

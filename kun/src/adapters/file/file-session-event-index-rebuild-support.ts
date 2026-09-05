import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { eventIndexPaths } from './file-session-event-index.js'
import { parseReplayEventRecord } from './file-session-jsonl.js'

const RebuildTailSchema = z.object({
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  firstSeenMs: z.number().int().nonnegative(),
  sampleSha256: z.string()
}).strict()

const RebuildSkipSchema = z.object({
  offset: z.number().int().nonnegative(),
  bytesSkipped: z.number().int().nonnegative()
}).strict()

const RebuildStateSchema = z.object({
  version: z.literal(2),
  dev: z.number().int().nonnegative(),
  ino: z.number().int().nonnegative(),
  byteCursor: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
  lastOffset: z.number().int().nonnegative(),
  invalidRecords: z.number().int().nonnegative(),
  oversizedRecords: z.number().int().nonnegative(),
  firstCorruptOffset: z.number().int().nonnegative().optional(),
  tail: RebuildTailSchema.optional(),
  skip: RebuildSkipSchema.optional()
}).strict()

export type RebuildState = z.infer<typeof RebuildStateSchema>

const SweepInProgressSchema = z.object({
  threadId: z.string(),
  failureCount: z.number().int().nonnegative(),
  blockedReason: z.string().optional(),
  sourceFingerprint: z.string().optional()
}).strict()

const SweepBlockedSchema = z.record(z.string(), z.object({
  sourceFingerprint: z.string(),
  blockedReason: z.string(),
  blockedAt: z.string()
}).strict())

const SweepStateSchema = z.object({
  version: z.literal(2),
  generation: z.number().int().nonnegative(),
  cursor: z.string().optional(),
  inProgress: SweepInProgressSchema.optional(),
  inProgressSource: z.enum(['priority', 'sequential']).optional(),
  blocked: SweepBlockedSchema.optional()
}).strict()

export type SweepState = z.infer<typeof SweepStateSchema>

export type GrindResult = {
  staging: RebuildState
  streamEnded: boolean
  tail?: { offset: number; length: number; sampleSha256: string }
}

export type ProcessOutcome = {
  status: 'pending' | 'done' | 'skipped'
  fingerprint: string
}

export function freshSweep(): SweepState {
  return { version: 2, generation: 0 }
}

export function nextAfter(threads: string[], cursor: string | undefined): string | undefined {
  if (!cursor) return threads[0]
  return threads.find((id) => id > cursor)
}

export function classifyLine(
  line: Buffer,
  maxRecordBytes: number
): { seq: number | null; reason?: 'oversized' | 'invalid' } {
  if (line.length === 0) return { seq: null }
  if (line.length > maxRecordBytes) return { seq: null, reason: 'oversized' }
  const event = parseReplayEventRecord(line.toString('utf8'), maxRecordBytes)
  return event ? { seq: event.seq } : { seq: null, reason: 'invalid' }
}

/** Parse a v1 or v2 sweep file, migrating a legacy string `inProgress`. */
export function parseSweep(text: string): SweepState {
  const raw = JSON.parse(text) as Record<string, unknown>
  const migrated: Record<string, unknown> = { ...raw, version: 2 }
  if (typeof migrated.inProgress === 'string') {
    migrated.inProgress = { threadId: migrated.inProgress, failureCount: 0 }
  }
  return SweepStateSchema.parse(migrated)
}

export async function readRebuildState(path: string): Promise<RebuildState | undefined> {
  try {
    const parsed = RebuildStateSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export async function binBytes(eventsPath: string, explicitPath?: string): Promise<number> {
  const path = explicitPath ?? eventIndexPaths(eventsPath).bin
  try {
    return (await stat(path)).size
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return 0
    throw error
  }
}

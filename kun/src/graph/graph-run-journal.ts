import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import {
  GraphEventEnvelopeV1Schema,
  GraphRunV1Schema,
  type GraphEventEnvelopeV1,
  type GraphRunV1
} from '../contracts/graph.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { checksumJson } from './graph-run-store-support.js'

const GraphJournalRecordSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  envelope: GraphEventEnvelopeV1Schema
}).strict()
export type GraphJournalRecord = z.infer<typeof GraphJournalRecordSchema>

const PersistedGraphJournalRecordSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  envelope: z.unknown()
}).strict()

const GraphSnapshotRecordSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  state: GraphRunV1Schema,
  recentCommands: z.array(z.object({
    commandId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/),
    envelope: GraphEventEnvelopeV1Schema
  }).strict()).max(2_048).default([])
}).strict()
export type GraphSnapshotRecord = z.infer<typeof GraphSnapshotRecordSchema>

const PersistedGraphSnapshotRecordSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.unknown(),
  recentCommands: z.unknown().optional()
}).strict()

export class GraphRunJournal {
  constructor(private readonly options: {
    rootDir: string
    config: () => GraphRuntimeConfig
  }) {}

  async read(runId: string): Promise<GraphJournalRecord[]> {
    let text: string
    try {
      text = await readFile(this.journalPath(runId), 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
    const rawLines = text.split('\n')
    const records: GraphJournalRecord[] = []
    for (let index = 0; index < rawLines.length; index += 1) {
      const line = rawLines[index]!.trim()
      if (!line) continue
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch {
        if (index === rawLines.length - 1) break
        throw corruption(`invalid journal JSON at ${runId}:${index + 1}`)
      }
      const persisted = PersistedGraphJournalRecordSchema.safeParse(raw)
      if (!persisted.success) {
        if (index === rawLines.length - 1) break
        throw corruption(`invalid journal record at ${runId}:${index + 1}`)
      }
      if (checksumJson(persisted.data.envelope) !== persisted.data.checksum) {
        throw corruption(`journal checksum mismatch at ${runId}:${index + 1}`)
      }
      const parsed = GraphJournalRecordSchema.safeParse(raw)
      if (!parsed.success) {
        if (index === rawLines.length - 1) break
        throw corruption(`invalid journal record at ${runId}:${index + 1}`)
      }
      const previousSeq = records.at(-1)?.envelope.graphSeq ??
        parsed.data.envelope.graphSeq - 1
      if (parsed.data.envelope.graphSeq !== previousSeq + 1) {
        throw corruption(`journal sequence gap at ${runId}:${index + 1}`)
      }
      records.push(parsed.data)
    }
    return records
  }

  async readSnapshot(
    runId: string,
    journalHighWater: number
  ): Promise<GraphSnapshotRecord | undefined> {
    try {
      const raw = JSON.parse(await readFile(this.snapshotPath(runId), 'utf8')) as unknown
      const persisted = PersistedGraphSnapshotRecordSchema.safeParse(raw)
      if (!persisted.success) return undefined
      const currentChecksum = checksumJson({
        state: persisted.data.state,
        recentCommands: persisted.data.recentCommands ?? []
      })
      const legacyChecksum = checksumJson(persisted.data.state)
      if (currentChecksum !== persisted.data.checksum && legacyChecksum !== persisted.data.checksum) {
        return undefined
      }
      const parsed = GraphSnapshotRecordSchema.safeParse(raw)
      if (!parsed.success || parsed.data.state.lastEventSeq > journalHighWater) return undefined
      return parsed.data
    } catch {
      return undefined
    }
  }

  async append(envelope: GraphEventEnvelopeV1): Promise<GraphEventEnvelopeV1> {
    const record = GraphJournalRecordSchema.parse({
      checksum: checksumJson(envelope),
      envelope
    })
    const handle = await open(this.journalPath(envelope.runId), 'a', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    return envelope
  }

  async writeSnapshot(
    state: GraphRunV1,
    records: GraphJournalRecord[] = []
  ): Promise<void> {
    const parsed = GraphRunV1Schema.parse(state)
    const source = records.length ? records : await this.read(state.id)
    const previous = await this.readSnapshot(
      state.id,
      source.at(-1)?.envelope.graphSeq ?? Number.MAX_SAFE_INTEGER
    )
    const commandRecords = source
      .map(({ envelope }) => envelope)
      .filter((envelope) => envelope.commandId || envelope.idempotencyKey)
      .map((envelope) => ({
        ...(envelope.commandId ? { commandId: envelope.commandId } : {}),
        ...(envelope.idempotencyKey ? { idempotencyKey: envelope.idempotencyKey } : {}),
        resultDigest: checksumJson(envelope),
        envelope
      }))
    const commands = [...(previous?.recentCommands ?? []), ...commandRecords]
    const recentCommands = [...new Map(commands.map((entry) => [
      entry.envelope.eventId,
      entry
    ])).values()].slice(-2_048)
    const record = GraphSnapshotRecordSchema.parse({
      checksum: checksumJson({ state: parsed, recentCommands }),
      state: parsed,
      recentCommands
    })
    await atomicWriteFile(this.snapshotPath(state.id), `${JSON.stringify(record)}\n`, {
      allowDirectWriteFallback: false,
      durable: true
    })
  }

  async compact(state: GraphRunV1, records: GraphJournalRecord[]): Promise<void> {
    const config = this.options.config().retention
    const retained = records.slice(-Math.max(1, config.snapshotEveryEvents))
    await atomicWriteFile(
      this.journalPath(state.id),
      `${retained.map((record) => JSON.stringify(record)).join('\n')}\n`,
      { allowDirectWriteFallback: false, durable: true }
    )
  }

  private journalPath(runId: string): string {
    return join(this.options.rootDir, runId, 'events.jsonl')
  }

  private snapshotPath(runId: string): string {
    return join(this.options.rootDir, runId, 'snapshot.json')
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function corruption(message: string): Error {
  const error = new Error(message)
  error.name = 'GraphStoreCorruptionError'
  return error
}

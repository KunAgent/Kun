import { parseHistoryMigrationState } from './runtime-migration-history-references.js'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import { artifactId } from '../artifacts/artifact-summary.js'
import { RuntimeEvent } from '../contracts/events.js'
import { TurnItem } from '../contracts/items.js'
import {
  RuntimeMigrationImportControl,
  RuntimeMigrationImportPreflight,
  RuntimeMigrationImportResult,
  RuntimeMigrationSnapshotRecord,
  type RuntimeMigrationImportControl as RuntimeMigrationImportControlType,
  type RuntimeMigrationImportPreflight as RuntimeMigrationImportPreflightType,
  type RuntimeMigrationImportResult as RuntimeMigrationImportResultType,
  type RuntimeMigrationSnapshotRecord as RuntimeMigrationSnapshotRecordType
} from '../contracts/migrations.js'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import { MemoryCreateRequest, MemoryRecord } from '../contracts/memory.js'
import { AttachmentMetadata as AttachmentMetadataSchema, type AttachmentMetadata } from '../contracts/attachments.js'
import type { AgentSession } from '../domain/session.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ScopedMigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { sanitizeMigrationValue } from './runtime-migration-service.js'
import { type ImportState, MAX_IMPORT_RECORD_BYTES } from './runtime-migration-import-service-core.js'
import { isRecord, isWorkspacePathKey, rewriteWorkspace } from './runtime-migration-import-service-content-support.js'

export async function parseRuntimeMigrationImportRequest(request: Request): Promise<{
  control: RuntimeMigrationImportControlType
  records: AsyncIterable<RuntimeMigrationSnapshotRecordType>
}> {
  if (!request.body) throw new Error('runtime migration import body is required')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let remainder = ''
  let control: RuntimeMigrationImportControlType | undefined
  const queue: RuntimeMigrationSnapshotRecordType[] = []
  let done = false
  const readNextLine = async (): Promise<string | null> => {
    while (true) {
      const newline = remainder.indexOf('\n')
      if (newline >= 0) {
        const line = remainder.slice(0, newline)
        remainder = remainder.slice(newline + 1)
        return line
      }
      if (done) {
        const line = remainder
        remainder = ''
        return line || null
      }
      const chunk = await reader.read()
      done = chunk.done
      if (chunk.value) remainder += decoder.decode(chunk.value, { stream: !done })
      if (Buffer.byteLength(remainder) > MAX_IMPORT_RECORD_BYTES) throw new Error('runtime migration import record exceeds byte limit')
    }
  }
  let firstLine: string | null
  try {
    firstLine = await readNextLine()
    if (!firstLine) throw new Error('runtime migration import control record is missing')
    control = RuntimeMigrationImportControl.parse(JSON.parse(firstLine))
  } catch (error) {
    reader.releaseLock()
    throw error
  }
  const records: AsyncIterable<RuntimeMigrationSnapshotRecordType> = {
    async *[Symbol.asyncIterator]() {
      try {
        for (const record of queue) yield record
        let line: string | null
        while ((line = await readNextLine()) !== null) {
          if (!line.trim()) continue
          yield RuntimeMigrationSnapshotRecord.parse(JSON.parse(line))
        }
      } finally {
        reader.releaseLock()
      }
    }
  }
  return { control, records }
}

export async function *iterateSnapshotFile(path: string): AsyncIterable<RuntimeMigrationSnapshotRecordType> {
  let remainder = ''
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
    remainder += chunk
    let newline = remainder.indexOf('\n')
    while (newline >= 0) {
      const line = remainder.slice(0, newline)
      remainder = remainder.slice(newline + 1)
      if (line.trim()) yield RuntimeMigrationSnapshotRecord.parse(JSON.parse(line))
      newline = remainder.indexOf('\n')
    }
    if (Buffer.byteLength(remainder) > MAX_IMPORT_RECORD_BYTES) throw new Error('stored migration record exceeds byte limit')
  }
  if (remainder.trim()) yield RuntimeMigrationSnapshotRecord.parse(JSON.parse(remainder))
}

export function rewriteImportedValue(value: unknown, maps: {
  threadIdMap: Readonly<Record<string, string>>
  workspacePathMap: Readonly<Record<string, string>>
  attachmentIdMap: Readonly<Record<string, string>>
  artifactIdMap: Readonly<Record<string, string>>
  memoryIdMap: Readonly<Record<string, string>>
}): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteImportedValue(item, maps))
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value
    return maps.threadIdMap[value] ?? maps.attachmentIdMap[value] ?? maps.artifactIdMap[value] ?? maps.memoryIdMap[value] ?? value
  }
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && isWorkspacePathKey(key)) {
      output[key] = rewriteWorkspace(child, maps.workspacePathMap)
    } else {
      output[key] = rewriteImportedValue(child, maps)
    }
  }
  return output
}

export function rewriteImportedSession(value: unknown, targetThreadId: string, state: ImportState): AgentSession {
  const rewritten = rewriteImportedValue(value, {
    threadIdMap: state.preflight.threadIdMap,
    workspacePathMap: state.control.workspacePathMap,
    attachmentIdMap: state.attachmentIdMap,
    artifactIdMap: state.artifactIdMap,
    memoryIdMap: state.memoryIdMap
  })
  if (!rewritten || typeof rewritten !== 'object' || Array.isArray(rewritten)) {
    throw new Error('invalid migration session record')
  }
  const record = rewritten as Record<string, unknown>
  if (typeof record.turnId !== 'string' || typeof record.startedAt !== 'string' || typeof record.updatedAt !== 'string') {
    throw new Error('invalid migration session record')
  }
  return {
    threadId: targetThreadId,
    ...(typeof record.historyRefId === 'string' ? { historyRefId: record.historyRefId } : {}),
    ...(typeof record.workspace === 'string' ? { workspace: record.workspace } : {}),
    turnId: record.turnId,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    items: Array.isArray(record.items) ? record.items.map((item) => TurnItem.parse(item)) : [],
    events: Array.isArray(record.events) ? record.events.map((event) => RuntimeEvent.parse(event)) : [],
    closed: true
  }
}

export function parseImportState(value: unknown, rootDir: string, importId: string): ImportState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('runtime migration state is malformed')
  const record = value as Record<string, unknown>
  if (record.importId !== importId) throw new Error('runtime migration state import id mismatch')
  const status = record.status
  if (!['preflighted', 'committing', 'committed', 'verified', 'rolled-back'].includes(String(status))) {
    throw new Error('runtime migration state status is malformed')
  }
  const stringArray = (key: string): string[] => {
    const child = record[key]
    if (!Array.isArray(child) || !child.every((item) => typeof item === 'string')) {
      throw new Error(`runtime migration state ${key} is malformed`)
    }
    return child
  }
  const stringMap = (key: string): Record<string, string> => {
    const child = record[key]
    if (!child || typeof child !== 'object' || Array.isArray(child) || !Object.values(child).every((item) => typeof item === 'string')) {
      throw new Error(`runtime migration state ${key} is malformed`)
    }
    return child as Record<string, string>
  }
  const control = RuntimeMigrationImportControl.parse({
    schemaVersion: 1,
    type: 'import-control',
    value: record.control
  }).value
  const preflight = RuntimeMigrationImportPreflight.parse(record.preflight)
  const attachmentBeforeRaw = isRecord(record.attachmentBefore) ? record.attachmentBefore : {}
  const attachmentAfterRaw = isRecord(record.attachmentAfter) ? record.attachmentAfter : {}
  const memoryAfterRaw = isRecord(record.memoryAfter) ? record.memoryAfter : {}
  const threadAfterRaw = isRecord(record.threadAfter) ? record.threadAfter : {}
  const countsRaw = isRecord(record.counts) ? record.counts : {}
  if (!Object.values(countsRaw).every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 0)) {
    throw new Error('runtime migration state counts are malformed')
  }
  return {
    importId,
    historyReferences: parseHistoryMigrationState(record.historyReferences),
    filePath: join(rootDir, `${importId}.jsonl`),
    statePath: join(rootDir, `${importId}.state.json`),
    control,
    preflight,
    status: status as ImportState['status'],
    introducedThreadIds: stringArray('introducedThreadIds'),
    deduplicatedThreadIds: stringArray('deduplicatedThreadIds'),
    attachmentIdMap: stringMap('attachmentIdMap'),
    artifactIdMap: stringMap('artifactIdMap'),
    memoryIdMap: stringMap('memoryIdMap'),
    attachmentBefore: Object.fromEntries(Object.entries(attachmentBeforeRaw).map(([id, item]) => [
      id,
      item === null ? null : AttachmentMetadataSchema.parse(item)
    ])),
    attachmentAfter: Object.fromEntries(Object.entries(attachmentAfterRaw).map(([id, item]) => [id, AttachmentMetadataSchema.parse(item)])),
    memoryAfter: Object.fromEntries(Object.entries(memoryAfterRaw).map(([id, item]) => [id, MemoryRecord.parse(item)])),
    threadAfter: Object.fromEntries(Object.entries(threadAfterRaw).map(([id, item]) => [id, ThreadSchema.parse(item)])),
    introducedAttachmentIds: stringArray('introducedAttachmentIds'),
    introducedArtifactIds: stringArray('introducedArtifactIds'),
    introducedMemoryIds: stringArray('introducedMemoryIds'),
    counts: countsRaw as Record<string, number>,
    warnings: stringArray('warnings')
  }
}

import type { RuntimeMigrationImportControl, RuntimeMigrationImportPreflight, RuntimeMigrationImportResult } from '../contracts/migrations.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { MemoryRecord } from '../contracts/memory.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { HistoryMigrationState } from './runtime-migration-history-references.js'

export const MAX_IMPORT_RECORD_BYTES = 8 * 1024 * 1024

export const MAX_IMPORT_RECORDS = 1_000_000

export const MAX_IMPORT_CONTENT_BYTES = 512 * 1024 * 1024

export type ChunkedContentDescriptor = {
  encoding: 'base64-chunks'
  byteSize: number
  sha256: string
  chunkCount: number
}

export type PendingChunkedContent = {
  kind: 'attachment' | 'artifact'
  sourceId: string
  ownerId?: string
  contentId?: string
  descriptor: ChunkedContentDescriptor
  metadata: unknown
  nextIndex: number
  byteSize: number
  chunks: Buffer[]
}

export type ImportState = {
  historyReferences: HistoryMigrationState
  importId: string
  filePath: string
  statePath: string
  control: RuntimeMigrationImportControl['value']
  preflight: RuntimeMigrationImportPreflight
  status: RuntimeMigrationImportResult['status'] | 'committing'
  introducedThreadIds: string[]
  deduplicatedThreadIds: string[]
  attachmentIdMap: Record<string, string>
  artifactIdMap: Record<string, string>
  memoryIdMap: Record<string, string>
  attachmentBefore: Record<string, AttachmentMetadata | null>
  attachmentAfter: Record<string, AttachmentMetadata>
  memoryAfter: Record<string, MemoryRecord>
  threadAfter: Record<string, ThreadRecord>
  introducedAttachmentIds: string[]
  introducedArtifactIds: string[]
  introducedMemoryIds: string[]
  counts: Record<string, number>
  warnings: string[]
}

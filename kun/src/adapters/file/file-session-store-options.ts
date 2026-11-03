import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'

export type FileSessionStoreOptions = {
  dataDir: string
  usageEventCompaction?: {
    maxBytes?: number
    retentionDays?: number
    nowIso?: () => string
  }
  itemsCacheMaxBytes?: number
  itemHistoryCompactionMinBytes?: number
  eventHistoryCompaction?: { maxBytes?: number; retainBytes?: number }
  compactionDelayMs?: number
  fileAccess?: JsonlFileAccessCoordinator
}

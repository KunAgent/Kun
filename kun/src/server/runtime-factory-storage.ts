import {
  join,
  FileAttachmentStore,
  type AttachmentStore,
  FileSessionStore,
  FileThreadStore,
  JsonlFileAccessCoordinator,
  HybridSessionStore,
  HybridMemoryStore,
  HybridThreadStore,
  createManagerRemoteStores,
  ManagerRemoteAttachmentStore,
  ManagerRemoteMemoryStore,
  type ServiceManagerConnection,
  DEFAULT_STORAGE_CONFIG,
  expandHomePath,
  type StorageConfig,
  type SessionStore,
  type ThreadStore,
  UsageService,
  FileMemoryStore,
  type MemoryStore
} from './runtime-factory-dependencies.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { findLatestUsageEvent } from '../adapters/session-event-query.js'

export async function createPersistentStores(input: {
  dataDir: string
  storage?: StorageConfig
  nowIso: () => string
  serviceManager?: ServiceManagerConnection
}): Promise<{ threadStore: ThreadStore; sessionStore: SessionStore; shutdown?: () => Promise<void> }> {
  if (input.serviceManager) return createManagerRemoteStores(input.serviceManager)
  const storage = input.storage ?? DEFAULT_STORAGE_CONFIG
  if (storage.backend === 'file') {
    const sessionStore = new FileSessionStore({ dataDir: input.dataDir })
    return {
      sessionStore,
      threadStore: new FileThreadStore({ dataDir: input.dataDir }),
      shutdown: () => sessionStore.close()
    }
  }

  const fileAccess = new JsonlFileAccessCoordinator()
  const threadStore = new HybridThreadStore({
    dataDir: input.dataDir,
    sqlitePath: storage.sqlitePath ? expandHomePath(storage.sqlitePath) : undefined,
    nowIso: input.nowIso,
    fileAccess
  })
  await threadStore.ready()
  const sessionStore = new HybridSessionStore({
    dataDir: input.dataDir,
    index: threadStore,
    fileAccess
  })
  return {
    threadStore,
    sessionStore,
    shutdown: async () => {
      try {
        await sessionStore.close()
      } finally {
        await threadStore.shutdown()
      }
    }
  }
}

export async function seedUsageCarryover(input: {
  threadStore: ThreadStore
  sessionStore: SessionStore
  usageService: UsageService
}): Promise<void> {
  if (typeof input.sessionStore.loadLatestUsageSnapshots === 'function') {
    try {
      const latest = await input.sessionStore.loadLatestUsageSnapshots()
      for (const record of latest) {
        input.usageService.seedThread(record.threadId, record.usage)
      }
      return
    } catch {
      // Fall through to JSONL replay when the optional index is unavailable.
    }
  }
  const threadSummaries = await input.threadStore.list({ includeSide: true })
  for (let offset = 0; offset < threadSummaries.length; offset += 8) {
    await Promise.all(threadSummaries.slice(offset, offset + 8).map(async (thread) => {
      const latestUsage = await findLatestUsageEvent(input.sessionStore, thread.id)
      if (latestUsage) input.usageService.seedThread(thread.id, latestUsage.usage)
    }))
  }
}

export function createPersistentMemoryStore(
  options: KunServeRuntimeOptions,
  nowIso: () => string
): MemoryStore | undefined {
  const config = options.capabilities?.memory
  if (!config?.enabled) return undefined
  return options.serviceManager
    ? new ManagerRemoteMemoryStore(options.serviceManager, config)
    : process.env.KUN_MEMORY_STORE_BACKEND === 'file'
      ? new FileMemoryStore({
          rootDir: join(options.dataDir, 'memory'),
          config,
          nowIso
        })
      : new HybridMemoryStore({
          dataDir: options.dataDir,
          config,
          nowIso
        })
}

export function createPersistentAttachmentStore(
  options: KunServeRuntimeOptions,
  nowIso: () => string
): AttachmentStore | undefined {
  const config = options.capabilities?.attachments
  if (!config?.enabled) return undefined
  return options.serviceManager
    ? new ManagerRemoteAttachmentStore(options.serviceManager, config)
    : new FileAttachmentStore({
        rootDir: join(options.dataDir, 'attachments'),
        config,
        nowIso
      })
}

export function runtimeBaseUrl(host: string, port: number): string {
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${urlHost}:${port}`
}

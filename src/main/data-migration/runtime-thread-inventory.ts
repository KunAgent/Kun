import type { RuntimeThreadForMigration } from './export-orchestrator'

type RuntimeFetch = (path: string) => Promise<Response>
type InventoryThread = Record<string, unknown> & { id: string }

function migrationThread(thread: InventoryThread): RuntimeThreadForMigration {
  return {
    id: thread.id,
    title: typeof thread.title === 'string' ? thread.title : '',
    ...(typeof thread.workspace === 'string' ? { workspace: thread.workspace } : {}),
    status: thread.status === 'archived' || thread.status === 'running' ? thread.status : 'idle',
    ...(thread.relation === 'fork' || thread.relation === 'side' ? { relation: thread.relation } : {}),
    ...(typeof thread.parentThreadId === 'string' ? { parentThreadId: thread.parentThreadId } : {}),
    ...(typeof thread.model === 'string' ? { model: thread.model } : {}),
    ...(typeof thread.providerId === 'string' ? { providerId: thread.providerId } : {}),
    createdAt: typeof thread.createdAt === 'string' ? thread.createdAt : new Date(0).toISOString(),
    updatedAt: typeof thread.updatedAt === 'string' ? thread.updatedAt : new Date(0).toISOString()
  }
}

async function readRuntimeThreadInventory(
  runtimeFetch: RuntimeFetch,
  accept: (thread: InventoryThread) => void
): Promise<void> {
  const query = new URLSearchParams({ include_archived: 'true', include: 'side', lean: 'true', limit: '500' })
  const cursors = new Set<string>()
  while (true) {
    const response = await runtimeFetch(`/v1/threads?${query}`)
    if (!response.ok) throw new Error(`Kun thread inventory failed (${response.status})`)
    const page = await response.json() as { threads?: unknown; nextCursor?: unknown; hasMore?: unknown }
    if (!Array.isArray(page?.threads)) throw new Error('Runtime thread inventory response has no threads array')
    for (const entry of page.threads) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) throw new Error('Invalid Runtime thread inventory entry')
      accept(entry)
    }
    if (page.nextCursor == null && page.hasMore !== true) return
    if (typeof page.nextCursor !== 'string' || !page.nextCursor || cursors.has(page.nextCursor)) {
      throw new Error('Runtime thread inventory has an invalid continuation cursor')
    }
    cursors.add(page.nextCursor)
    query.set('cursor', page.nextCursor)
  }
}

export async function listRuntimeThreadsForMigration(runtimeFetch: RuntimeFetch): Promise<RuntimeThreadForMigration[]> {
  const threads = new Map<string, RuntimeThreadForMigration>()
  await readRuntimeThreadInventory(runtimeFetch, thread => { threads.set(thread.id, migrationThread(thread)) })
  return [...threads.values()]
}

export async function listRuntimeThreadIdsForMigration(runtimeFetch: RuntimeFetch): Promise<Set<string>> {
  const ids = new Set<string>()
  await readRuntimeThreadInventory(runtimeFetch, thread => { ids.add(thread.id) })
  return ids
}

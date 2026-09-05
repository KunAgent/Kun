import { rm } from 'node:fs/promises'
import { vi } from 'vitest'
import type { ThreadService } from '../services/thread-service.js'
import { MAINTENANCE_SLICE_MAX_THREADS } from './runtime-maintenance-slices.js'

export const roots: string[] = []

export async function cleanupRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}

export function threadHarness(count: number) {
  const ids = Array.from({ length: count }, (_, index) => `thread-${index}`)
  const listPage = vi.fn(async (options?: { cursor?: string; limit?: number }) => {
    const start = Number(options?.cursor ?? 0)
    const limit = options?.limit ?? MAINTENANCE_SLICE_MAX_THREADS
    const page = ids.slice(start, start + limit)
    const next = start + page.length
    return {
      threads: page.map((id) => ({ id, status: 'idle', updatedAt: id })),
      hasMore: next < ids.length,
      ...(next < ids.length ? { nextCursor: String(next) } : {})
    }
  })
  const get = vi.fn(async (id: string) => ({
    id,
    turns: [{ attachmentIds: [`attachment-${id}`] }]
  }))
  return { ids, listPage, get, service: { listPage, get } as unknown as ThreadService }
}

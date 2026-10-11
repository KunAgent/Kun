import { MemoryErasureIncompleteError } from '../memory/memory-erasure-error.js'
import { z } from 'zod'
import { MemoryCreateRequest } from '../contracts/memory.js'
import { MemoryLifecycleRequest } from '../contracts/memory-lifecycle.js'
import { AgentMemoryAccessSchema } from '../memory/agent-memory-scope.js'
import { MemoryRevisionConflictError } from '../memory/memory-revisions.js'
import type { MemoryStore } from '../memory/memory-store.js'

const Access = z.object({ workspace: z.string().optional(), project: z.string().optional(),
  projectIdentity: z.string().optional(), agent: AgentMemoryAccessSchema.optional() }).strict()

export async function executeMemoryLifecycleOperation(store: MemoryStore,
  operation: 'history' | 'lifecycle' | 'isForgotten' | 'erasureReceipt', raw: unknown): Promise<unknown> {
  if (operation === 'erasureReceipt') {
    const input = z.object({ operationId: z.string().min(1).max(256) }).strict().parse(raw)
    if (!store.erasureReceipt) throw new Error('memory erasure receipts unavailable')
    return store.erasureReceipt(input.operationId)
  }
  if (operation === 'isForgotten') {
    const input = z.object({ input: MemoryCreateRequest, id: z.string().optional() }).strict().parse(raw)
    if (!store.isForgotten) throw new Error('memory forgetting checks unavailable')
    return store.isForgotten(input.input, input.id)
  }
  if (operation === 'history') {
    const input = z.object({ id: z.string().min(1), access: Access.optional() }).strict().parse(raw)
    if (!store.history) throw new Error('memory history unavailable')
    return store.history(input.id, input.access)
  }
  const input = z.object({ id: z.string().min(1), request: MemoryLifecycleRequest,
    access: Access.optional() }).strict().parse(raw)
  if (!store.lifecycle) throw new Error('memory lifecycle unavailable')
  try { return { ok: true, result: await store.lifecycle(input.id, input.request, input.access) } }
  catch (error) {
    if (error instanceof MemoryErasureIncompleteError) return { ok: false, conflict: error.message, incomplete: true }
    if (error instanceof MemoryRevisionConflictError) return { ok: false, conflict: error.message }
    throw error
  }
}

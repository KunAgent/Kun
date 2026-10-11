import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { MemoryScope, type MemoryRecord } from '../contracts/memory.js'
import type { MemoryLifecycleRequest } from '../contracts/memory-lifecycle.js'
import { AgentMemoryOwnershipSchema, agentMemoryVisible } from './agent-memory-scope.js'
import { memoryInScope } from './memory-ranking.js'
import { MemoryRevisionConflictError } from './memory-revisions.js'
import { MemoryNotFoundError } from './memory-not-found-error.js'
import type { MemoryAccess } from './memory-store.js'

const Visibility = z.object({
  id: z.string(), scope: MemoryScope, workspace: z.string().optional(), project: z.string().optional(),
  projectIdentity: z.string().optional(), agentContext: AgentMemoryOwnershipSchema.optional()
}).strict()
const ErasureOperation = z.object({
  version: z.literal(1), operationId: z.string().min(1).max(256), memoryId: z.string(),
  expectedRevision: z.number().int().positive(), visibility: Visibility,
  affectedIds: z.array(z.string()), preparedAt: z.string()
}).strict()
export type MemoryErasureOperation = z.infer<typeof ErasureOperation>

export function memoryErasureOperationId(id: string, revision: number, access?: MemoryAccess): string {
  return access?.agent?.operationId ?? 'erase_' + createHash('sha256').update(JSON.stringify([id, revision])).digest('hex')
}
function pathFor(root: string, operationId: string): string {
  return join(root, 'lifecycle', 'erasure-operations', createHash('sha256').update(operationId).digest('hex') + '.json')
}
export async function readMemoryErasureOperation(root: string, operationId: string): Promise<MemoryErasureOperation | undefined> {
  try { return ErasureOperation.parse(JSON.parse(await readFile(pathFor(root, operationId), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
export async function prepareMemoryErasureOperation(root: string, operationId: string,
  memory: MemoryRecord, affectedIds: string[], now: string): Promise<void> {
  const previous = await readMemoryErasureOperation(root, operationId)
  if (previous && (previous.memoryId !== memory.id || previous.expectedRevision !== memory.revision)) {
    throw new MemoryRevisionConflictError('memory erasure operation identity changed')
  }
  const record = ErasureOperation.parse({ version: 1, operationId, memoryId: memory.id,
    expectedRevision: memory.revision, preparedAt: previous?.preparedAt ?? now,
    visibility: { id: memory.id, scope: memory.scope, workspace: memory.workspace, project: memory.project,
      projectIdentity: memory.projectIdentity, agentContext: memory.agentContext },
    affectedIds: [...new Set([...(previous?.affectedIds ?? []), ...affectedIds])]
  })
  // This receipt contains scope and IDs only, never memory bodies, excerpts or revision snapshots.
  await atomicWriteFile(pathFor(root, operationId), JSON.stringify(record), { durable: true, allowDirectWriteFallback: false })
}
export function authorizeMemoryErasureRetry(operation: MemoryErasureOperation, id: string,
  request: MemoryLifecycleRequest, access: MemoryAccess | undefined): void {
  if (request.confirmation?.memoryId !== id || !request.confirmation.irreversible ||
    operation.memoryId !== id || operation.visibility.id !== id || operation.expectedRevision !== request.expectedRevision ||
    !agentMemoryVisible(operation.visibility, access ?? {}) || access && !memoryInScope(operation.visibility, access)) {
    throw new MemoryNotFoundError()
  }
}

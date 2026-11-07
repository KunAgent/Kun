import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import { hasRemoteForkProof } from './history/fork-proof.js'
/** Top-level Code and Work sessions share the same remote history, turn and approval surface; Work's home lists its own. */
export function isRemoteCode(thread: Pick<ThreadRecord, 'roomContext' | 'workspaceMode' | 'parentThreadId' | 'executionUnit' | 'agentSurface'>) {
  return !thread.roomContext && thread.workspaceMode !== 'ade' && !thread.parentThreadId &&
    thread.executionUnit?.kind !== 'worker' && (!thread.agentSurface || thread.agentSurface === 'code' || thread.agentSurface === 'write')
}
export async function isRemoteCodeAllowed(runtime: ServerRuntime, candidate: Pick<ThreadRecord, 'id' | 'roomContext' | 'workspaceMode' | 'parentThreadId' | 'executionUnit' | 'agentSurface'>) {
  if (isRemoteCode(candidate)) return true
  if (!candidate.parentThreadId || !candidate.id.startsWith('thr_mobile_fork_') ||
    !isRemoteCode({ ...candidate, parentThreadId: undefined })) return false
  const thread = await runtime.threadService.getMetadata(candidate.id)
  return Boolean(thread && await hasRemoteForkProof(runtime, thread))
}
export async function requireCode(runtime: ServerRuntime, id: string) {
  const thread = await (runtime.threadService.getMetadata?.(id) ?? runtime.threadService.get(id))
  if (!thread) throw new Error('NOT_FOUND')
  if (!await isRemoteCodeAllowed(runtime, thread)) throw new Error('NOT_A_CODE_TASK')
  return thread
}

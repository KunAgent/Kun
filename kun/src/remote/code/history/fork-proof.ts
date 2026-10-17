import { createHash } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import type { ThreadRecord } from '../../../contracts/threads.js'
import type { RemoteFork } from '../../../contracts/remote-history.js'
import { receiptKey } from '../../requests/receipts.js'
export type RemoteForkProof = { version: 1; kind: 'fork'; state: 'prepared' | 'applied'; accountId: string; deviceId: string;
  requestId: string; requestKey: string; childId: string; provenance: RemoteFork; fingerprint: string }
export const remoteForkId = (key: string) => 'thr_mobile_fork_' + createHash('sha256').update(key).digest('hex').slice(0, 32)
export const remoteForkProofId = (id: string) => 'remote-fork:' + id
export function matchesRemoteFork(thread: ThreadRecord, proof: RemoteForkProof): boolean {
  return proof?.version === 1 && proof.kind === 'fork' && Boolean(proof.provenance) && proof.childId === thread.id &&
    remoteForkId(proof.requestKey) === thread.id &&
    receiptKey({ accountId: proof.accountId, deviceId: proof.deviceId, authorizationId: '' }, proof.requestId) === proof.requestKey &&
    thread.parentThreadId === proof.provenance.sourceThreadId && thread.relation === 'fork' &&
    Boolean(thread.remoteFork) && canonical(thread.remoteFork) === canonical(proof.provenance)
}
export async function hasRemoteForkProof(runtime: ServerRuntime, thread: ThreadRecord): Promise<boolean> {
  if (!thread.remoteFork || !thread.id.startsWith('thr_mobile_fork_') || !runtime.rooms) return false
  const row = await runtime.rooms.deps.store.get<RemoteForkProof>('remote_history', remoteForkProofId(thread.id))
  return Boolean(row && row.value.state === 'applied' && matchesRemoteFork(thread, row.value))
}

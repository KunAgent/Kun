import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { MANAGER_MUTATION_REPLAY_CAPABILITY } from '../contracts/manager-request-replay.js'
import { requestManagerJson, type ServiceManagerConnection } from './manager-client.js'
import { isSessionMutation, isThreadMutation } from './shared-data-store-contracts.js'
import { mutationFenceForValue } from './turn-mutation-context.js'

type ManagerStore = 'thread' | 'session' | 'artifact' | 'memory' | 'graph' | 'attachment'

const ResultSchema = z.object({ result: z.unknown() }).strict()
export const MANAGER_USAGE_REQUEST_TIMEOUT_MS = 30_000
const MANAGER_TIMELINE_DATA_REQUEST_TIMEOUT_MS = 120_000

export async function callManagerStore(
  manager: ServiceManagerConnection,
  store: ManagerStore,
  operation: string,
  value?: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const turnFence = shouldFenceManagerStoreMutation(store, operation)
    ? mutationFenceForValue(value)
    : undefined
  const timeoutMs = resolveManagerDataRequestTimeoutMs(store, operation)
  const replay = shouldFenceManagerStoreMutation(store, operation) &&
    manager.discovery.capabilities?.includes(MANAGER_MUTATION_REPLAY_CAPABILITY)
    ? { requestId: randomUUID(), managerInstanceId: manager.discovery.instanceId, expiresAt: Date.now() + timeoutMs }
    : undefined
  const response = await requestManagerJson(manager, `/v1/data/${store}/${operation}`, {
    method: 'POST',
    signal,
    retrySafe: isManagerStoreRead(store, operation) || replay !== undefined,
    ...(replay ? { maxAttempts: 5 } : {}),
    body: store === 'thread' || store === 'session'
      ? { value: value ?? {}, ...(turnFence ? { turnFence } : {}), ...(replay ? { replay } : {}) }
      : value ?? {},
    timeoutMs
  })
  return ResultSchema.parse(response).result
}

function shouldFenceManagerStoreMutation(store: ManagerStore, operation: string): boolean {
  if (store === 'thread') return isThreadMutation(operation as Parameters<typeof isThreadMutation>[0])
  if (store === 'session') {
    return operation === 'allocateEventSeq' ||
      isSessionMutation(operation as Parameters<typeof isSessionMutation>[0])
  }
  return false
}

export function resolveManagerDataRequestTimeoutMs(
  store: ManagerStore,
  operation: string
): number {
  if (store === 'session' && operation === 'aggregateUsage') {
    return MANAGER_USAGE_REQUEST_TIMEOUT_MS
  }
  if (store === 'session' && (operation === 'loadItemPage' || operation === 'highestSeq')) {
    return MANAGER_TIMELINE_DATA_REQUEST_TIMEOUT_MS
  }
  return MANAGER_USAGE_REQUEST_TIMEOUT_MS
}

/** Explicit read allowlist: new/unknown RPCs fail closed rather than replay writes. */
export function isManagerStoreRead(store: ManagerStore, operation: string): boolean {
  const reads: Record<ManagerStore, readonly string[]> = {
    thread: ['list', 'listPage', 'get', 'getMetadata', 'hasHistoryReference'],
    session: ['itemHistoryVersion', 'loadItemSnapshot', 'loadEventsSince', 'loadEventPage', 'eventReplayFloorSeq',
      'loadItems', 'searchItemText', 'loadItemPage', 'loadSession', 'highestSeq',
      'loadUsageRecords', 'aggregateUsage', 'loadLatestContextSnapshot', 'loadLatestUsageSnapshots'],
    artifact: ['list', 'get', 'readRange', 'stat'],
    memory: [
      'relationContext',
      'list', 'listDirectives', 'retrieve', 'diagnostics', 'distillationPending', 'getById', 'history', 'isForgotten', 'erasureReceipt',
      'feedbackEvent', 'feedbackAggregate', 'feedbackAggregates', 'feedbackDiagnostics'
    ],
    graph: ['get', 'list', 'events', 'eventReplay', 'snapshot', 'diagnostics'],
    attachment: ['get', 'resolveContent', 'diagnostics']
  }
  return reads[store].includes(operation)
}

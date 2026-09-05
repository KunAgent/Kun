import { z } from 'zod'
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
  value?: unknown
): Promise<unknown> {
  const turnFence = shouldFenceManagerStoreMutation(store, operation)
    ? mutationFenceForValue(value)
    : undefined
  const response = await requestManagerJson(manager, `/v1/data/${store}/${operation}`, {
    method: 'POST',
    body: store === 'thread' || store === 'session'
      ? { value: value ?? {}, ...(turnFence ? { turnFence } : {}) }
      : value ?? {},
    timeoutMs: resolveManagerDataRequestTimeoutMs(store, operation)
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

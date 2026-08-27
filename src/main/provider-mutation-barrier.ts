import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import type {
  ProviderMutationFlushRequest,
  ProviderMutationFlushResult
} from '../shared/provider-mutation-barrier'

const CHANNEL = 'provider-mutation:flush-request'
const ACK_CHANNEL = 'provider-mutation:flush-ack'
const MAX_PROVIDER_IDS = 256
const MAX_TIMEOUT_MS = 5_000

type PendingRequest = {
  senderId: number
  resolve: (result: ProviderMutationFlushResult) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingRequests = new Map<string, PendingRequest>()
let handlersRegistered = false

export function registerProviderMutationBarrierIpc(getMainWindow: () => BrowserWindow | null): void {
  if (handlersRegistered) return
  handlersRegistered = true
  ipcMain.handle(ACK_CHANNEL, (event, payload: unknown) => {
    const result = parseFlushResult(payload)
    const pending = result ? pendingRequests.get(result.requestId) : undefined
    const window = getMainWindow()
    if (!result || !pending || !window || event.sender.id !== pending.senderId) return { ok: false }
    clearTimeout(pending.timer)
    pendingRequests.delete(result.requestId)
    pending.resolve(result)
    return { ok: true }
  })
}

export function requestProviderMutationFlush(
  getMainWindow: () => BrowserWindow | null,
  timeoutMs = MAX_TIMEOUT_MS
): Promise<ProviderMutationFlushResult> {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return Promise.resolve({ requestId: '', ok: false, pendingProviderIds: [], mutationKinds: [], errorCode: 'renderer-unavailable' })
  }
  const request: ProviderMutationFlushRequest = {
    requestId: randomUUID(),
    deadlineMs: Math.min(Math.max(timeoutMs, 1), MAX_TIMEOUT_MS)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(request.requestId)
      resolve({ requestId: request.requestId, ok: false, pendingProviderIds: [], mutationKinds: [], errorCode: 'timeout' })
    }, request.deadlineMs)
    pendingRequests.set(request.requestId, { senderId: window.webContents.id, resolve, timer })
    window.webContents.send(CHANNEL, request)
  })
}

function parseFlushResult(payload: unknown): ProviderMutationFlushResult | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  const kinds = ['profile', 'catalog', 'credential', 'deletion'] as const
  const errors = ['renderer-unavailable', 'timeout', 'flush-failed', 'invalid-ack'] as const
  if (typeof value.requestId !== 'string' || value.requestId.length > 128 || typeof value.ok !== 'boolean') return null
  if (!Array.isArray(value.pendingProviderIds) || value.pendingProviderIds.length > MAX_PROVIDER_IDS ||
      !value.pendingProviderIds.every((id) => typeof id === 'string' && id.length <= 160)) return null
  if (!Array.isArray(value.mutationKinds) || !value.mutationKinds.every((kind) => kinds.includes(kind as typeof kinds[number]))) return null
  if (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !errors.includes(value.errorCode as typeof errors[number]))) return null
  return {
    requestId: value.requestId,
    ok: value.ok,
    pendingProviderIds: value.pendingProviderIds as string[],
    mutationKinds: value.mutationKinds as ProviderMutationFlushResult['mutationKinds'],
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode as ProviderMutationFlushResult['errorCode'] } : {})
  }
}

import type { AgentIdentity } from '@shared/rooms-api'

export type CreationModelRequest = {
  key: string; id: string; name: string; modelRef: NonNullable<AgentIdentity['modelRef']>
}
const KEY = 'kun.agent-creation.pending-confirmed-request'
/** Only called after explicit Continue, never while browsing choices. */
export function saveCreationModelRequest(request: CreationModelRequest): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(request)) } catch { /* Storage may be unavailable. */ }
}
export function clearCreationModelRequest(): void {
  try { window.sessionStorage.removeItem(KEY) } catch { /* Storage may be unavailable. */ }
}
export function readCreationModelRequest(): CreationModelRequest | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as CreationModelRequest | null
    return value && typeof value.id === 'string' && typeof value.key === 'string' && typeof value.name === 'string'
      && typeof value.modelRef?.providerId === 'string' && typeof value.modelRef?.model === 'string'
      && (value.modelRef.accountId === undefined || typeof value.modelRef.accountId === 'string') ? value : null
  } catch { return null }
}

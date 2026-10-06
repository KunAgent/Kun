import type { ProviderConfigurationPreview, ProviderConfigurationSnapshot } from '@shared/provider-configuration'
export type SecretSlot = { id: string; connectionId: string; kind: 'credential' | 'headers'; names?: string[]; bound: boolean }
export type ImportPreview = ProviderConfigurationPreview & { secretSlots: SecretSlot[] }
export type SecretBinding = { slotId: string; kind: 'credential'; credential?: string; sourceConnectionId?: string } | { slotId: string; kind: 'headers'; headers: Record<string, string> }
async function call<T>(action: string, body: unknown): Promise<T> {
  const result = await window.kunGui.runtimeRequest(`/v1/provider-config/${action}`, 'POST', JSON.stringify(body))
  const value = JSON.parse(result.body) as T & { message?: string }
  if (!result.ok) throw new Error(value.message ?? `Provider configuration failed (${result.status})`)
  return value
}
export const previewProviderExchange = (revision: number, document: Record<string, unknown>, password: string) => document.format === 'kun-provider-backup'
  ? call<ImportPreview>('backup/preview', { expectedRevision: revision, backup: document, password })
  : call<ImportPreview>('import/preview', { ...document, expectedRevision: revision })
export const commitProviderExchange = (preview: ImportPreview, bindings: SecretBinding[]) =>
  call<{ applied: boolean; snapshot: ProviderConfigurationSnapshot }>('import/commit', { expectedRevision: preview.expectedRevision,
    previewId: preview.previewId, idempotencyKey: preview.previewId, bindings })
export const createProviderEncryptedBackup = (password: string) => call<{ backup: unknown; missingSlots: string[] }>('backup', { password })
export const previewProviderRecovery = () => call<{ canDowngrade: boolean; revision: number;
  blockingReasons: Array<{ path: string; reason: string }> }>('recovery/preview', {})
export const exportProviderRecovery = (expectedRevision: number) => call<unknown>('recovery/export', { expectedRevision })

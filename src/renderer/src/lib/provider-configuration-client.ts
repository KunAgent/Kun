import type { ProviderConfigurationSnapshot, ProviderConfigurationOperation,
  ProviderConfigurationPreview } from '@shared/provider-configuration'

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await window.kunGui.runtimeRequest(`/v1/provider-config${path}`, method,
    body === undefined ? undefined : JSON.stringify(body))
  if (!response.ok) {
    let message = `Provider configuration failed (${response.status})`
    try { message = JSON.parse(response.body).message ?? message } catch { /* Preserve status. */ }
    throw new Error(message)
  }
  return JSON.parse(response.body) as T
}
export const loadProviderConfiguration = () => call<ProviderConfigurationSnapshot>('?limit=500&schema_version=2', 'GET')
export const previewProviderConfiguration = (revision: number, operations: ProviderConfigurationOperation[]) =>
  call<ProviderConfigurationPreview>('/transactions/preview', 'POST', { expectedRevision: revision, operations })
export const commitProviderConfiguration = (preview: ProviderConfigurationPreview) =>
  call<{ applied: boolean; committedRevision: number; snapshot: ProviderConfigurationSnapshot }>('/transactions/commit', 'POST', {
    expectedRevision: preview.expectedRevision, previewId: preview.previewId, idempotencyKey: preview.previewId
  })
export const exportProviderConfiguration = () => call<unknown>('/export', 'POST', {})
export const previewProviderConfigurationImport = (revision: number, value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a provider configuration object')
  return call<ProviderConfigurationPreview>('/import/preview', 'POST', { ...value, expectedRevision: revision })
}

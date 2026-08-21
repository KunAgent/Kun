import type { ModelConnectionConnectRequest } from '../contracts/model-connections.js'

type StoredSeedIdentity = {
  id: string
  kind: string
  authType: 'api-key' | 'oauth' | 'subscription'
  presetSource?: string
  presetMode?: 'api' | 'token-plan'
}

/**
 * Registry seeds can enrich legacy identity fields but must not replace an
 * already-owned transport, catalog, selection, or credential binding.
 */
export function reconciledSeedIdentity(
  existing: StoredSeedIdentity,
  request: ModelConnectionConnectRequest
): Partial<StoredSeedIdentity> {
  const migrateGeminiSubscription =
    existing.id === 'gemini-subscription' &&
    existing.kind === 'gemini-code-assist' &&
    request.kind === 'antigravity-cli'
  if (migrateGeminiSubscription) {
    return {
      kind: request.kind,
      authType: request.authType,
      ...(request.presetSource ? { presetSource: request.presetSource } : {}),
      ...(request.presetMode ? { presetMode: request.presetMode } : {})
    }
  }
  const backfillPresetSource = !existing.presetSource && request.presetSource
  const backfillPresetMode = !existing.presetMode && request.presetMode
  return {
    ...(backfillPresetSource ? { presetSource: request.presetSource } : {}),
    ...(backfillPresetMode ? { presetMode: request.presetMode } : {}),
    ...(existing.authType === 'api-key' && request.authType === 'subscription' &&
      (backfillPresetSource || backfillPresetMode)
      ? { authType: 'subscription' as const }
      : {})
  }
}

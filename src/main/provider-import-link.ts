import { randomUUID } from 'node:crypto'
import type { AppSettingsV1, ModelProviderProfileV1 } from '../shared/app-settings'
import { defaultModelRequestRetrySettings } from '../shared/app-settings'
import { getModelProviderPreset, modelProviderPresetProfile } from '../shared/model-provider-preset-operations'
import {
  parseProviderImportLink,
  type ProviderImportLinkDraft
} from '../shared/provider-import-link'

/**
 * `kun://import` link staging (plan §6.12): the link's API key never reaches
 * the renderer. The renderer receives a sanitized draft (key replaced by a
 * hint) plus an opaque token; on confirm the commit IPC resolves the token
 * back to the staged draft inside this process and writes the profile.
 */
const PENDING_TTL_MS = 10 * 60 * 1_000
const pendingImports = new Map<string, { draft: ProviderImportLinkDraft; expiresAt: number }>()

export type StagedProviderImportLink = {
  token: string
  draft: Omit<ProviderImportLinkDraft, 'key'> & { keyHint?: string; hasKey: boolean }
  warnings: string[]
}

function prunePending(): void {
  const now = Date.now()
  for (const [token, entry] of pendingImports) {
    if (entry.expiresAt <= now) pendingImports.delete(token)
  }
}

function maskKey(key: string): string | undefined {
  const trimmed = key.trim()
  if (!trimmed) return undefined
  return trimmed.length <= 8
    ? `${trimmed.slice(0, 2)}…`
    : `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

/**
 * Parses and stages a link. Returns the sanitized draft the renderer shows
 * in the confirmation sheet, or an error message.
 */
export function stageProviderImportLink(
  raw: string
): { ok: true; staged: StagedProviderImportLink } | { ok: false; message: string } {
  const parsed = parseProviderImportLink(raw)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  prunePending()
  const token = randomUUID()
  pendingImports.set(token, { draft: parsed.draft, expiresAt: Date.now() + PENDING_TTL_MS })
  const { key, ...rest } = parsed.draft
  return {
    ok: true,
    staged: {
      token,
      draft: {
        ...rest,
        hasKey: Boolean(key),
        ...(key && maskKey(key) ? { keyHint: maskKey(key) } : {})
      },
      warnings: parsed.warnings
    }
  }
}

function presetProfileFor(draft: ProviderImportLinkDraft): ModelProviderProfileV1 | null {
  const preset = draft.presetId ? getModelProviderPreset(draft.presetId) : null
  if (!preset) return null
  const profile = modelProviderPresetProfile(preset, draft.key ?? '')
  // A link may still override the preset base URL (self-hosted gateways).
  if (draft.chatBaseUrl) {
    profile.baseUrl = draft.chatBaseUrl
  }
  return profile
}

function customProfileFor(draft: ProviderImportLinkDraft): ModelProviderProfileV1 {
  const baseUrl = draft.chatBaseUrl ?? draft.anthropicBaseUrl ?? draft.responsesBaseUrl ?? ''
  const endpoints: ModelProviderProfileV1['endpoints'] = {
    ...(draft.chatBaseUrl ? { chat_completions: draft.chatBaseUrl } : {}),
    ...(draft.anthropicBaseUrl ? { messages: draft.anthropicBaseUrl } : {}),
    ...(draft.responsesBaseUrl ? { responses: draft.responsesBaseUrl } : {})
  }
  const hasEndpoints = Object.values(endpoints).some(Boolean)
  return {
    id: '',
    name: (draft.name ?? '').slice(0, 80),
    apiKey: draft.key ?? '',
    baseUrl,
    endpointFormat: draft.anthropicBaseUrl && !draft.chatBaseUrl ? 'messages' : 'chat_completions',
    ...(hasEndpoints ? { endpoints } : {}),
    useProxy: false,
    retry: defaultModelRequestRetrySettings(),
    models: draft.models,
    modelProfiles: {}
  }
}

/**
 * Resolves a staged link into a provider profile. The caller merges it into
 * the settings store; the credential rides the ordinary migration into the
 * protected account store.
 */
export function commitProviderImportLink(
  token: string,
  settings: AppSettingsV1
): { ok: true; profile: ModelProviderProfileV1 } | { ok: false; message: string } {
  prunePending()
  const staged = pendingImports.get(token)
  if (!staged) return { ok: false, message: 'The import link expired or was already used.' }
  pendingImports.delete(token)
  const draft = staged.draft
  const profile = presetProfileFor(draft) ?? customProfileFor(draft)
  if (!profile.baseUrl.trim()) {
    return { ok: false, message: 'The link did not resolve to a usable endpoint.' }
  }
  const taken = new Set(
    settings.provider.providers.map((provider) => provider.id.toLowerCase())
  )
  const base = profile.id || (profile.name || 'imported').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported'
  let id = base.slice(0, 96)
  for (let n = 2; taken.has(id) && n < 100; n += 1) id = `${base.slice(0, 96)}-${n}`
  profile.id = id
  if (!profile.name.trim()) profile.name = id
  return { ok: true, profile }
}

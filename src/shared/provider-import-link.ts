import { isLocalModelProviderBaseUrl } from './app-settings-provider-failover'

/**
 * `kun://import` deep-link parsing and validation (plan §6.12). Two forms:
 *
 *   kun://import?preset=<presetId>&key=<apiKey>
 *   kun://import?name=<name>&chat=<baseUrl>&anthropic=<baseUrl>&responses=<baseUrl>&models=a,b&key=<apiKey>
 *
 * The parsed result is a draft for the add-provider confirmation sheet; it
 * is never applied without explicit user confirmation.
 */
export type ProviderImportLinkDraft = {
  presetId?: string
  name?: string
  key?: string
  /** OpenAI-compatible chat completions base URL. */
  chatBaseUrl?: string
  /** Anthropic messages base URL. */
  anthropicBaseUrl?: string
  /** OpenAI responses base URL. */
  responsesBaseUrl?: string
  models: string[]
}

export type ProviderImportLinkResult =
  | { ok: true; draft: ProviderImportLinkDraft; warnings: string[] }
  | { ok: false; message: string }

const MAX_NAME = 80
const MAX_MODELS = 200
const MAX_KEY_LENGTH = 8_192
// Keys are printable ASCII without whitespace or delimiters.
const KEY_PATTERN = /^[!-~]+$/

export function isProviderImportLink(raw: string): boolean {
  return /^kun:\/\/import(?:[/?#]|$)/iu.test(raw.trim())
}

function validateEndpointUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: `Endpoint URL is not valid: ${raw.slice(0, 120)}` }
  }
  if (url.username || url.password) {
    return { ok: false, message: 'Endpoint URLs must not embed credentials.' }
  }
  if (url.search || url.hash) {
    return { ok: false, message: 'Endpoint URLs must not contain a query or fragment.' }
  }
  if (url.protocol === 'https:') return { ok: true, url: url.toString() }
  if (url.protocol === 'http:' && isLocalModelProviderBaseUrl(url.toString())) {
    return { ok: true, url: url.toString() }
  }
  return {
    ok: false,
    message: 'Endpoint URLs require https (http is allowed only for loopback/LAN hosts).'
  }
}

export function parseProviderImportLink(raw: string): ProviderImportLinkResult {
  const trimmed = raw.trim()
  if (!isProviderImportLink(trimmed)) {
    return { ok: false, message: 'Not a kun://import link.' }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, message: 'The import link is malformed.' }
  }
  const params = url.searchParams
  const draft: ProviderImportLinkDraft = { models: [] }
  const warnings: string[] = []

  const preset = params.get('preset')?.trim()
  if (preset) {
    if (!/^[a-z0-9][a-z0-9._-]{0,96}$/iu.test(preset)) {
      return { ok: false, message: 'The preset id in the link is invalid.' }
    }
    draft.presetId = preset
  }

  const name = params.get('name')?.trim()
  if (name) draft.name = name.slice(0, MAX_NAME)

  const key = params.get('key')
  if (key !== null) {
    const trimmedKey = key.trim()
    if (trimmedKey) {
      if (trimmedKey.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(trimmedKey)) {
        return { ok: false, message: 'The API key in the link is invalid.' }
      }
      draft.key = trimmedKey
    }
  }

  for (const [param, field] of [
    ['chat', 'chatBaseUrl'],
    ['anthropic', 'anthropicBaseUrl'],
    ['responses', 'responsesBaseUrl']
  ] as const) {
    const value = params.get(param)?.trim()
    if (!value) continue
    const validated = validateEndpointUrl(value)
    if (!validated.ok) return { ok: false, message: validated.message }
    draft[field] = validated.url
  }

  const models = params.get('models')
  if (models) {
    const list = models.split(',').map((model) => model.trim()).filter(Boolean)
    draft.models = list.slice(0, MAX_MODELS)
    if (list.length > MAX_MODELS) {
      warnings.push(`The model list was truncated to ${MAX_MODELS} entries.`)
    }
  }

  if (!draft.presetId && !draft.chatBaseUrl && !draft.anthropicBaseUrl && !draft.responsesBaseUrl) {
    return { ok: false, message: 'The link contains neither a preset nor an endpoint.' }
  }
  return { ok: true, draft, warnings }
}

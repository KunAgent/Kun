import type { ProviderCatalogPreset } from './index.js'

const kinds = new Set(['http', 'agent-sdk', 'antigravity-cli', 'gemini-cli-api', 'cursor-sdk'])
const formats = new Set(['chat_completions', 'responses', 'messages', 'custom_endpoint'])
const authFlows = new Set(['api-key', 'chatgpt-oauth', 'grok-oauth', 'claude-subscription',
  'gemini-subscription', 'gemini-cli-subscription', 'cursor-api-key'])
const fields = new Set(['schemaVersion', 'id', 'name', 'category', 'kind', 'authFlow', 'authType',
  'credentialRequirement', 'baseUrl', 'endpointFormat', 'models', 'docsUrl', 'credentialUrl', 'tokenPlan'])

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected provider object')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, empty = false): asserts value is string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 2_048) {
    throw new Error(`Invalid provider ${label}`)
  }
}
function url(value: unknown, label: string, empty = false): void {
  text(value, label, empty)
  if (empty && !value) return
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Invalid provider ${label} URL`)
  }
}
function models(value: unknown): void {
  if (!Array.isArray(value) || value.length > 2_000) throw new Error('Invalid provider models')
  for (const model of value) text(model, 'model id')
  if (new Set(value).size !== value.length) throw new Error('Duplicate provider model id')
}

/** Validate data at the package boundary; descriptors never contain executable hooks or secrets. */
export function validateProviderCatalog(input: readonly unknown[]): readonly ProviderCatalogPreset[] {
  const ids = new Set<string>()
  return input.map((raw) => {
    const row = object(raw)
    for (const key of Object.keys(row)) if (!fields.has(key)) throw new Error(`Unknown provider field: ${key}`)
    if (row.schemaVersion !== 1) throw new Error('Unsupported provider descriptor version')
    text(row.id, 'id')
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(row.id) || ids.has(row.id)) throw new Error(`Invalid or duplicate provider id: ${row.id}`)
    ids.add(row.id)
    text(row.name, 'name')
    if (!['api', 'free', 'subscription'].includes(String(row.category))) throw new Error('Invalid provider category')
    if (!kinds.has(String(row.kind)) || !formats.has(String(row.endpointFormat)) || !authFlows.has(String(row.authFlow))) {
      throw new Error(`Invalid provider adapter: ${row.id}`)
    }
    if (!['api-key', 'oauth', 'subscription'].includes(String(row.authType))) throw new Error('Invalid provider authentication')
    if (row.credentialRequirement !== undefined && !['required', 'optional', 'none'].includes(String(row.credentialRequirement))) {
      throw new Error('Invalid provider credential requirement')
    }
    url(row.baseUrl, 'base', row.kind !== 'http')
    url(row.docsUrl, 'documentation')
    url(row.credentialUrl, 'credentials')
    models(row.models)
    if (row.tokenPlan !== undefined) {
      const plan = object(row.tokenPlan)
      const allowed = new Set(['displayName', 'baseUrl', 'regions', 'endpointFormat', 'models', 'credentialUrl'])
      for (const key of Object.keys(plan)) if (!allowed.has(key)) throw new Error(`Unknown token-plan field: ${key}`)
      url(plan.baseUrl, 'token-plan base')
      url(plan.credentialUrl, 'token-plan credentials')
      if (!formats.has(String(plan.endpointFormat))) throw new Error('Invalid token-plan protocol')
      models(plan.models)
      if (plan.displayName !== undefined) text(plan.displayName, 'token-plan name')
      if (plan.regions !== undefined) {
        if (!Array.isArray(plan.regions) || plan.regions.length > 32) throw new Error('Invalid token-plan regions')
        const regions = new Set<string>()
        for (const entry of plan.regions) {
          const region = object(entry)
          if (Object.keys(region).some((key) => key !== 'id' && key !== 'baseUrl')) throw new Error('Unknown region field')
          text(region.id, 'region id')
          if (regions.has(region.id)) throw new Error('Duplicate region id')
          regions.add(region.id)
          url(region.baseUrl, 'region base')
        }
      }
    }
    const { schemaVersion: _version, ...preset } = row
    return preset as ProviderCatalogPreset
  })
}

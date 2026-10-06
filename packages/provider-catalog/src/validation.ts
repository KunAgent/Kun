import type { ProviderCatalogPreset } from './index.js'

const kinds = new Set(['http', 'agent-sdk', 'antigravity-cli', 'gemini-cli-api', 'cursor-sdk'])
const formats = new Set(['chat_completions', 'responses', 'messages', 'custom_endpoint'])
const authFlows = new Set(['api-key', 'chatgpt-oauth', 'grok-oauth', 'claude-subscription',
  'gemini-subscription', 'gemini-cli-subscription', 'cursor-api-key'])
const v1Fields = ['schemaVersion', 'id', 'name', 'category', 'kind', 'authFlow', 'authType',
  'credentialRequirement', 'baseUrl', 'endpointFormat', 'models', 'docsUrl', 'credentialUrl', 'tokenPlan']
/** Schema v2 adds declarative picker, endpoint and account-observation metadata. */
const v2Fields = ['origin', 'regions', 'regionLabel', 'endpoints', 'headerHints', 'noList', 'endpointHint',
  'balance', 'planQuota']
const balanceSources = new Set(['deepseek', 'moonshot', 'openrouter', 'siliconflow', 'stepfun', 'aihubmix', 'new-api'])
const planQuotaSources = new Set(['zhipu', 'zai', 'kimi-code', 'minimax'])
const endpointKeys = new Set(['chat_completions', 'responses', 'messages'])

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected provider object')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, empty = false): asserts value is string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 2_048) {
    throw new Error(`Invalid provider ${label}`)
  }
}
/** Link URLs (docs, key pages) may carry a fragment; request endpoints may not carry a query or fragment. */
function link(value: unknown, label: string): void {
  text(value, label)
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Invalid provider ${label} URL`)
  }
}
function url(value: unknown, label: string, empty = false): void {
  text(value, label, empty)
  if (empty && !value) return
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`Invalid provider ${label} URL`)
  }
}
function models(value: unknown): void {
  if (!Array.isArray(value) || value.length > 2_000) throw new Error('Invalid provider models')
  for (const model of value) text(model, 'model id')
  if (new Set(value).size !== value.length) throw new Error('Duplicate provider model id')
}
function endpoints(value: unknown, label: string): void {
  const row = object(value)
  if (Object.keys(row).length === 0) throw new Error(`Empty ${label} endpoints`)
  for (const [key, entry] of Object.entries(row)) {
    if (!endpointKeys.has(key)) throw new Error(`Unknown ${label} endpoint: ${key}`)
    url(entry, `${label} ${key} endpoint`)
  }
}
function regions(value: unknown, label: string, firstBaseUrl?: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new Error(`Invalid ${label} regions`)
  const ids = new Set<string>()
  for (const entry of value) {
    const region = object(entry)
    for (const key of Object.keys(region)) {
      if (!['id', 'name', 'baseUrl', 'endpoints'].includes(key)) throw new Error('Unknown region field')
    }
    text(region.id, 'region id')
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(region.id) || ids.has(region.id)) throw new Error('Duplicate region id')
    ids.add(region.id)
    if (region.name !== undefined) text(region.name, 'region name')
    url(region.baseUrl, 'region base')
    if (region.endpoints !== undefined) endpoints(region.endpoints, `region ${region.id}`)
  }
  if (firstBaseUrl !== undefined && object(value[0]).baseUrl !== firstBaseUrl) {
    throw new Error(`The first ${label} region must equal its base URL`)
  }
}

function validateTokenPlan(raw: unknown, version: number): void {
  const plan = object(raw)
  const allowed = new Set(['displayName', 'baseUrl', 'regions', 'endpointFormat', 'models', 'credentialUrl',
    ...(version >= 2 ? ['endpoints', 'planQuota'] : [])])
  for (const key of Object.keys(plan)) if (!allowed.has(key)) throw new Error(`Unknown token-plan field: ${key}`)
  url(plan.baseUrl, 'token-plan base')
  link(plan.credentialUrl, 'token-plan credentials')
  if (!formats.has(String(plan.endpointFormat))) throw new Error('Invalid token-plan protocol')
  models(plan.models)
  if (plan.displayName !== undefined) text(plan.displayName, 'token-plan name')
  if (plan.regions !== undefined) regions(plan.regions, 'token-plan')
  if (plan.endpoints !== undefined) endpoints(plan.endpoints, 'token-plan')
  if (plan.planQuota !== undefined && !planQuotaSources.has(String(plan.planQuota))) throw new Error('Invalid plan quota source')
}

/** Validate data at the package boundary; descriptors never contain executable hooks or secrets. */
export function validateProviderCatalog(input: readonly unknown[]): readonly ProviderCatalogPreset[] {
  const ids = new Set<string>()
  return input.map((raw) => {
    const row = object(raw)
    if (row.schemaVersion !== 1 && row.schemaVersion !== 2) throw new Error('Unsupported provider descriptor version')
    const version = row.schemaVersion
    const fields = new Set(version === 2 ? [...v1Fields, ...v2Fields] : v1Fields)
    for (const key of Object.keys(row)) if (!fields.has(key)) throw new Error(`Unknown provider field: ${key}`)
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
    link(row.docsUrl, 'documentation')
    link(row.credentialUrl, 'credentials')
    models(row.models)
    if (row.tokenPlan !== undefined) validateTokenPlan(row.tokenPlan, version)
    if (row.origin !== undefined && !['vendor', 'relay', 'local'].includes(String(row.origin))) throw new Error('Invalid provider origin')
    if (row.regions !== undefined) regions(row.regions, 'API', row.baseUrl)
    if (row.regionLabel !== undefined) text(row.regionLabel, 'region label')
    if (row.endpoints !== undefined) endpoints(row.endpoints, 'API')
    if (row.headerHints !== undefined) {
      if (!Array.isArray(row.headerHints) || row.headerHints.length > 16) throw new Error('Invalid header hints')
      for (const name of row.headerHints) {
        text(name, 'header hint')
        if (!/^[A-Za-z0-9-]{1,128}$/.test(name) || /^(authorization|x-api-key|api-key|cookie)$/i.test(name)) {
          throw new Error(`Header hint may not name a credential: ${name}`)
        }
      }
    }
    if (row.noList !== undefined && typeof row.noList !== 'boolean') throw new Error('Invalid noList flag')
    if (row.noList === true && (row.models as unknown[]).length === 0) throw new Error('A noList provider must declare its models')
    if (row.endpointHint !== undefined) text(row.endpointHint, 'endpoint hint')
    if (row.balance !== undefined && !balanceSources.has(String(row.balance))) throw new Error('Invalid balance source')
    if (row.planQuota !== undefined && !planQuotaSources.has(String(row.planQuota))) throw new Error('Invalid plan quota source')
    const { schemaVersion: _version, ...preset } = row
    return preset as ProviderCatalogPreset
  })
}

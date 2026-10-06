import { ProviderDiscoveryResponseError } from './provider-discovery-error.js'
import type { ProviderDiscovery } from '../contracts/provider-configuration.js'
import { readLimitedResponseText } from '../adapters/model/compat-model-support.js'

function atPointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value
  let current = value
  for (const segment of pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export async function discoverCustomModels(input: {
  discovery: Extract<ProviderDiscovery, { mode: 'custom' }>
  baseUrl: string
  headers: Record<string, string>
  fetcher: typeof fetch
  signal?: AbortSignal
}): Promise<string[]> {
  const { discovery } = input
  const endpoint = new URL(discovery.modelsUrl)
  const base = new URL(input.baseUrl)
  const authenticated = endpoint.origin === base.origin || discovery.credentialHosts.includes(endpoint.host)
  if (!authenticated && Object.keys(input.headers).some((name) => name.toLowerCase() !== 'accept')) {
    throw new Error('The model-list origin has not been approved for provider credentials')
  }
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  const models = new Set<string>(), cursors = new Set<string>()
  let cursor: string | undefined
  let remainingBytes = 2_000_000
  for (let page = 0; page < discovery.maxPages; page++) {
    const url = new URL(endpoint)
    if (cursor && discovery.cursorParameter) url.searchParams.set(discovery.cursorParameter, cursor)
    const response = await input.fetcher(url, { method: 'GET', headers: input.headers, signal, redirect: 'error' })
    if (!response.ok) throw new ProviderDiscoveryResponseError(`Model discovery failed with HTTP ${response.status}`, response.status)
    const body = await readLimitedResponseText(response, remainingBytes)
    if (body.exceeded) throw new ProviderDiscoveryResponseError('Model discovery response exceeds its size limit')
    remainingBytes -= new TextEncoder().encode(body.text).byteLength
    const value: unknown = JSON.parse(body.text)
    const rows = atPointer(value, discovery.itemsPointer)
    if (!Array.isArray(rows)) throw new ProviderDiscoveryResponseError('The configured model-list pointer is not an array')
    for (const row of rows) {
      const id = atPointer(row, discovery.idPointer)
      if (typeof id !== 'string' || !id.trim() || id.length > 512) throw new ProviderDiscoveryResponseError('Model discovery returned an invalid model identifier')
      models.add(id.trim())
      if (models.size > 2_000) throw new ProviderDiscoveryResponseError('Model discovery exceeded its model limit')
    }
    const next = discovery.nextCursorPointer ? atPointer(value, discovery.nextCursorPointer) : undefined
    if (next === undefined || next === null || next === '') return [...models]
    if (typeof next !== 'string' || next.length > 2_048 || !discovery.cursorParameter || cursors.has(next)) {
      throw new ProviderDiscoveryResponseError('Model discovery returned an invalid or repeated pagination cursor')
    }
    cursors.add(next); cursor = next
  }
  throw new ProviderDiscoveryResponseError('Model discovery exceeded its pagination limit')
}

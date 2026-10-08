import { GeminiCliOAuthSource } from '../adapters/model/gemini-cli-oauth.js'
import { geminiCliRequestHeaders } from '../adapters/model/provider-cli-identity.js'
import { readLimitedResponseText } from '../adapters/model/compat-model-support.js'
import { ProviderDiscoveryResponseError } from './provider-discovery-error.js'
import { parseProviderModelDescriptor, type ModelDiscoveryResult } from './provider-model-descriptors.js'

const ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

/** Reads the existing Gemini CLI account channel; never uses Antigravity credentials. */
export async function discoverGeminiCliModels(options: {
  fetchImpl?: typeof fetch
  tokenSource?: Pick<GeminiCliOAuthSource, 'accessToken'>
  fallbackModels: readonly string[]
  signal?: AbortSignal
}): Promise<ModelDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const tokenSource = options.tokenSource ?? new GeminiCliOAuthSource({ fetchImpl })
  const token = await tokenSource.accessToken()
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  const request = async (operation: string, body: object): Promise<unknown> => {
    const response = await fetchImpl(`${ENDPOINT}${operation}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...geminiCliRequestHeaders() },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new ProviderDiscoveryResponseError(`Gemini CLI catalog request failed (HTTP ${response.status})`, response.status)
    const responseBody = await readLimitedResponseText(response, 4 * 1024 * 1024)
    if (responseBody.exceeded) throw new Error('Gemini CLI catalog exceeds the response limit')
    return JSON.parse(responseBody.text) as unknown
  }
  try {
    const setup = record(await request('loadCodeAssist', {
      metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }
    }))
    const projectValue = setup.cloudaicompanionProject
    const project = typeof projectValue === 'string' ? projectValue : record(projectValue).id ?? record(projectValue).projectId
    if (typeof project !== 'string' || !project.trim()) throw new Error('Gemini CLI account setup is incomplete; finish Google sign-in and retry.')
    try {
      const payload = await request('retrieveUserQuota', { project })
      const catalog = parseGeminiCliAccountModels(payload)
      // A present, empty bucket array is an explicit account observation.
      if (catalog.models.length || Array.isArray(record(payload).buckets)) return catalog
    } catch (error) {
      if (isAuthError(error) || signal.aborted) throw error
    }
    return parseGeminiCliAccountModels(await request('fetchAvailableModels', { project }))
  } catch (error) {
    if (isAuthError(error) || signal.aborted && options.signal?.aborted) throw error
    return { models: [...options.fallbackModels], modelProfiles: {}, source: 'preset', lastAttemptStatus: 'fallback' }
  }
}

/** Only explicit account model IDs are accepted; quota labels do not invent variants. */
export function parseGeminiCliAccountModels(payload: unknown): ModelDiscoveryResult {
  const root = record(payload)
  const rows = Array.isArray(root.buckets) ? root.buckets : Array.isArray(root.models) ? root.models
    : Object.entries(record(root.models)).map(([id, value]) => ({ ...record(value), modelId: id }))
  const modelProfiles: ModelDiscoveryResult['modelProfiles'] = Object.create(null)
  for (const raw of rows.slice(0, 2_000)) {
    const row = record(raw)
    const id = row.modelId ?? row.id ?? row.model
    if (typeof id !== 'string' || !/^gemini-[\w.-]+$/.test(id) || id.length > 512) continue
    modelProfiles[id] = { ...modelProfiles[id], ...parseProviderModelDescriptor(row) }
  }
  return { models: Object.keys(modelProfiles), modelProfiles, source: 'provider', lastAttemptStatus: 'success' }
}

function isAuthError(error: unknown): boolean {
  return error instanceof ProviderDiscoveryResponseError && (error.httpStatus === 401 || error.httpStatus === 403)
}

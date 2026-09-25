/**
 * OpenAI-compatible URL construction delegates to the shared
 * `resolveModelEndpointUrl` contract so the GUI and the Kun runtime always
 * build identical request/model-list URLs.
 */
import { resolveModelEndpointUrl } from '../../kun/src/contracts/model-endpoint-format.js'

function splitUrlSuffix(url: string): { path: string; suffix: string } {
  const query = url.search(/[?#]/)
  if (query < 0) return { path: url, suffix: '' }
  return { path: url.slice(0, query), suffix: url.slice(query) }
}

function appendUrlPath(baseUrl: string, path: string): string {
  const split = splitUrlSuffix(baseUrl)
  return `${split.path.replace(/\/+$/, '')}/${path}${split.suffix}`
}

function lastPathSegment(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl.trim())
  return split.path.replace(/\/+$/, '').split('/').pop() ?? ''
}

function isVersionSegment(segment: string): boolean {
  const s = segment.toLowerCase()
  if (s === 'beta') return true
  return /^v\d+$/i.test(segment)
}

function unversionedBaseUrl(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl)
  const trimmed = split.path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash < 0) return `${trimmed}${split.suffix}`
  const seg = trimmed.slice(slash + 1)
  if (isVersionSegment(seg)) return `${trimmed.slice(0, slash)}${split.suffix}`
  return `${trimmed}${split.suffix}`
}

export function upstreamOpenAiModelsUrl(baseUrl: string): string {
  return resolveModelEndpointUrl(baseUrl, 'chat_completions', 'models')
}

export function upstreamOpenAiChatCompletionsUrl(baseUrl: string): string {
  return resolveModelEndpointUrl(baseUrl, 'chat_completions', 'generate')
}

export function upstreamOpenAiCustomEndpointUrl(baseUrl: string): string {
  return resolveModelEndpointUrl(baseUrl, 'custom_endpoint', 'generate')
}

/**
 * DeepSeek's FIM completion lives under `/beta/completions`, not the
 * versioned chat path — it keeps its own builder.
 */
export function upstreamDeepSeekFimCompletionsUrl(baseUrl: string): string {
  const path = 'completions'
  const trimmed = resolveModelEndpointUrl(baseUrl, 'custom_endpoint', 'generate')
  const base = trimmed || 'https://api.deepseek.com/beta'
  const segment = lastPathSegment(base).toLowerCase()
  const betaBase = segment === 'beta'
    ? base
    : isVersionSegment(segment)
      ? appendUrlPath(unversionedBaseUrl(base), 'beta')
      : appendUrlPath(base, 'beta')
  return appendUrlPath(betaBase, path)
}

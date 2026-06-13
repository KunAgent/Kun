/**
 * Build `.../models` URL for OpenAI-compatible providers, matching
 * DeepSeek-TUI `client::api_url(base, "models")` so `/beta` bases still hit `/v1/models`.
 */
function splitUrlSuffix(url: string): { path: string; suffix: string } {
  const query = url.search(/[?#]/)
  if (query < 0) return { path: url, suffix: '' }
  return { path: url.slice(0, query), suffix: url.slice(query) }
}

function appendUrlPath(baseUrl: string, path: string): string {
  const split = splitUrlSuffix(baseUrl)
  return `${split.path.replace(/\/+$/, '')}/${path}${split.suffix}`
}

function trimUrlPathEnd(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl.trim())
  return `${split.path.replace(/\/+$/, '')}${split.suffix}`
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

function versionedBaseUrl(baseUrl: string): string {
  const trimmed = trimUrlPathEnd(baseUrl)
  const seg = lastPathSegment(trimmed)
  if (isVersionSegment(seg)) return trimmed
  return appendUrlPath(trimmed, 'v1')
}

export function upstreamOpenAiModelsUrl(baseUrl: string): string {
  const path = 'models'
  const endpointBase = baseUrl.trim()
  let versioned = versionedBaseUrl(endpointBase)
  if (lastPathSegment(versioned).toLowerCase() === 'beta') {
    versioned = appendUrlPath(unversionedBaseUrl(endpointBase), 'v1')
  }
  return appendUrlPath(versioned, path)
}

export function upstreamOpenAiChatCompletionsUrl(baseUrl: string): string {
  const path = 'chat/completions'
  const trimmed = baseUrl.trim()
  let versioned = versionedBaseUrl(trimmed)
  if (lastPathSegment(versioned).toLowerCase() === 'beta') {
    versioned = appendUrlPath(unversionedBaseUrl(trimmed), 'v1')
  }
  return appendUrlPath(versioned, path)
}

export function upstreamOpenAiCustomEndpointUrl(baseUrl: string): string {
  return trimUrlPathEnd(baseUrl)
}

export function upstreamDeepSeekFimCompletionsUrl(baseUrl: string): string {
  const path = 'completions'
  const trimmed = trimUrlPathEnd(baseUrl)
  const base = trimmed || 'https://api.deepseek.com/beta'
  const segment = lastPathSegment(base).toLowerCase()
  const betaBase = segment === 'beta'
    ? base
    : isVersionSegment(segment)
      ? appendUrlPath(unversionedBaseUrl(base), 'beta')
      : appendUrlPath(base, 'beta')
  return appendUrlPath(betaBase, path)
}

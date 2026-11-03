import { parse } from 'smol-toml'

/** Parse the same TOML shapes as the CLI, then inspect only the effective route. */
export function codexUsesOfficialSubscriptionConfig(sources: readonly string[], args: readonly string[] = []): boolean {
  let config: Record<string, unknown> = {}
  let selectedProfile: string | undefined
  try {
    for (const source of sources) config = merge(config, parse(source, { unsafeKeyBehaviour: 'throw' }))
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]!
      if (arg === '--profile' || arg === '-p') { selectedProfile = args[++index]; if (!selectedProfile) return false }
      else if (arg.startsWith('--profile=')) selectedProfile = arg.slice('--profile='.length)
      else if (arg === '--config' || arg === '-c' || arg.startsWith('--config=')) {
        const assignment = arg.startsWith('--config=') ? arg.slice('--config='.length) : args[++index]
        if (!assignment) return false
        config = merge(config, parse(assignment, { unsafeKeyBehaviour: 'throw' }))
      }
    }
  } catch { return false }
  if (config.profile !== undefined && typeof config.profile !== 'string') return false
  const profileName = selectedProfile ?? config.profile as string | undefined
  const profile = profileName ? record(record(config.profiles)?.[profileName]) : undefined
  if (profileName && !profile) return false
  const providerName = profile?.model_provider ?? config.model_provider ?? 'openai'
  if (providerName !== 'openai') return false
  const providerValue = record(config.model_providers)?.openai
  const provider = record(providerValue)
  if (providerValue !== undefined && !provider) return false
  if (['env_key', 'api_key', 'experimental_bearer_token'].some((key) => provider?.[key] !== undefined && provider[key] !== '')) return false
  if (provider?.requires_openai_auth === false) return false
  for (const name of ['http_headers', 'env_http_headers']) {
    if (Object.keys(record(provider?.[name]) ?? {}).some((key) => /^(authorization|api[-_]key|x-api-key)$/i.test(key))) return false
  }
  for (const value of [config.openai_base_url, provider?.base_url]) {
    if (value === undefined) continue
    if (typeof value !== 'string') return false
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || !['api.openai.com', 'chatgpt.com'].includes(url.host) || url.username || url.password) return false
    } catch { return false }
  }
  return true
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) ? value as Record<string, unknown> : undefined
}
function merge(base: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const next = { ...base }
  for (const [key, value] of Object.entries(incoming)) {
    const nested = record(value), previous = record(next[key])
    next[key] = nested && previous ? merge(previous, nested) : value
  }
  return next
}

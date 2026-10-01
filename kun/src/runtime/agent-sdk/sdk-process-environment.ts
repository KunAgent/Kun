import { shellSpawnEnv } from '../../adapters/tool/builtin-shell-utils.js'

const PROXY_ENV_KEYS = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'])

/** Keep native networking preferences without exposing the runtime's credentials. */
export function sdkProcessBaseEnv(
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const env = shellSpawnEnv(source, platform)
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && PROXY_ENV_KEYS.has(name.toUpperCase())) env[name] = value
  }
  return env
}

/** The authenticated local gateway must never be sent through an upstream proxy. */
export function withLoopbackProxyBypass(
  source: Record<string, string | undefined>
): Record<string, string | undefined> {
  const bypass = new Set<string>()
  for (const [name, value] of Object.entries(source)) {
    if (name.toUpperCase() !== 'NO_PROXY') continue
    for (const entry of value?.split(',') ?? []) {
      if (entry.trim()) bypass.add(entry.trim())
    }
  }
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) bypass.add(host)
  const value = [...bypass].join(',')
  const env = { ...source }
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === 'NO_PROXY') delete env[name]
  }
  return { ...env, NO_PROXY: value, no_proxy: value }
}

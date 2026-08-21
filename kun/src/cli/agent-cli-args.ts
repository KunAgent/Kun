const VALUE_FLAGS = new Set([
  'config', 'config-file', 'host', 'port', 'data-dir', 'dataDir',
  'runtime-token', 'runtimeToken', 'api-key', 'apiKey', 'base-url', 'baseUrl',
  'model-proxy-url', 'modelProxyUrl', 'endpoint-format', 'endpointFormat', 'model',
  'provider-id', 'account-id', 'approval-policy', 'sandbox-mode', 'approval-reviewer',
  'workspace', 'prompt', 'p', 'prompt-file', 'reasoning-effort', 'service-tier',
  'max-steps', 'max-wall-time-ms', 'max-tool-calls-per-step', 'args', 'title',
  'storage-backend', 'storageBackend', 'sqlite-path', 'sqlitePath',
  'observability-output', 'observabilityOutput', 'observability-exporter',
  'bundled-extensions-dir', 'bundledExtensionsDir'
])

export function positionals(argv: readonly string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      out.push(...argv.slice(index + 1))
      break
    }
    if (token.startsWith('--')) {
      const flag = token.slice(2).split('=')[0] ?? ''
      if (!token.includes('=') && VALUE_FLAGS.has(flag)) index += 1
      continue
    }
    if (token.startsWith('-') && token.length > 1) {
      const flag = token.slice(1)
      if (VALUE_FLAGS.has(flag)) index += 1
      continue
    }
    out.push(token)
  }
  return out
}

export function stringFlag(argv: readonly string[], names: readonly string[]): string | undefined {
  const nameSet = new Set(names)
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const key = eq >= 0 ? token.slice(2, eq) : token.slice(2)
      if (nameSet.has(key)) return eq >= 0 ? token.slice(eq + 1) : argv[index + 1]
    } else if (token.startsWith('-') && nameSet.has(token.slice(1))) {
      return argv[index + 1]
    }
  }
  return undefined
}

export function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.some((token) => token === `--${name}` || token === `--${name}=true`)
}

export function optionProvided(argv: readonly string[], name: string): boolean {
  return argv.some((token) => token === `--${name}` || token.startsWith(`--${name}=`))
}

import type {
  MarketMcpEntry,
  MarketMcpInstallPlan,
  MarketMcpInstallResult
} from '../../../shared/market/market-types'
import type { MarketFetch } from './market-source'
import type { MarketService } from './market-service'

const REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'] as const
const REGISTRY_TIMEOUT_MS = 6_000
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export type NpmSpec = { name: string; version: string }

/** Splits `name`, `name@tag` or `@scope/name@1.2.3`; the version is '' when absent. */
export function parseNpmSpec(spec: string): NpmSpec {
  const at = spec.lastIndexOf('@')
  if (at <= 0) return { name: spec, version: '' }
  return { name: spec.slice(0, at), version: spec.slice(at + 1) }
}

function executableName(command: string): string {
  const normalized = command.trim().replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase().replace(/\.(?:cmd|exe)$/, '')
}

/** Index of the package spec in `npx` args (the first non-flag argument), or -1. */
function npxSpecIndex(args: readonly string[]): number {
  return args.findIndex((arg) => arg.length > 0 && !arg.startsWith('-'))
}

/** Asks the npm registry (with a China-friendly mirror fallback) for `name`'s latest version. */
export async function resolveLatestNpmVersion(name: string, fetcher: MarketFetch): Promise<string> {
  const path = name.replace('/', '%2F')
  let lastError = 'unknown error'
  for (const registry of REGISTRIES) {
    try {
      const response = await fetcher(`${registry}/${path}/latest`, {
        signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
        headers: { accept: 'application/json' }
      })
      if (!response.ok) {
        lastError = `${registry} responded HTTP ${response.status}`
        continue
      }
      const body = (await response.json()) as { version?: unknown }
      if (typeof body.version === 'string' && EXACT_VERSION.test(body.version)) return body.version
      lastError = `${registry} returned no usable version`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`Could not look up the latest version of ${name}: ${lastError}`)
}

/**
 * Builds the install plan for one market MCP server. Kun refuses `npx` servers
 * without an exact package version, but markets publish `@latest`/unversioned
 * specs, so the version is resolved and pinned here at install time.
 */
export async function planMarketMcpInstall(
  entry: MarketMcpEntry,
  fetcher: MarketFetch
): Promise<MarketMcpInstallPlan> {
  if (entry.transport === 'remote') {
    return {
      transport: 'remote',
      id: entry.id,
      url: entry.url,
      requiredEnvKeys: entry.requiredEnvKeys,
      optionalEnvKeys: entry.optionalEnvKeys
    }
  }
  const base = {
    transport: 'stdio' as const,
    id: entry.id,
    command: entry.command,
    requiredEnvKeys: entry.requiredEnvKeys,
    optionalEnvKeys: entry.optionalEnvKeys
  }
  const index = executableName(entry.command) === 'npx' ? npxSpecIndex(entry.args) : -1
  if (index < 0) return { ...base, args: [...entry.args] }
  const spec = parseNpmSpec(entry.args[index] as string)
  if (EXACT_VERSION.test(spec.version)) return { ...base, args: [...entry.args] }
  const version = await resolveLatestNpmVersion(spec.name, fetcher)
  const args = [...entry.args]
  args[index] = `${spec.name}@${version}`
  return { ...base, args, pinned: { packageName: spec.name, version } }
}

export async function planMarketMcpInstallFromCatalog(
  request: { sourceId: string; serverId: string },
  deps: { service: MarketService; fetcher: MarketFetch }
): Promise<MarketMcpInstallResult> {
  const catalog = await deps.service.getCatalog(request.sourceId, 'auto')
  if (!catalog.ok) return { ok: false, message: catalog.message }
  const entry = catalog.catalog.mcpServers.find((server) => server.id === request.serverId)
  if (!entry) return { ok: false, message: `"${request.serverId}" is not in the market catalog.` }
  try {
    return { ok: true, plan: await planMarketMcpInstall(entry, deps.fetcher) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

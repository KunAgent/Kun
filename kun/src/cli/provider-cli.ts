import type { RuntimeRequest } from '../agent-wiring/bridge.js'
import { GATEWAY_CLI_USAGE, json, table, type GatewayCliIo } from './gateway-cli.js'

/**
 * `kun provider list|models|test` and `kun gateway route <alias>`, served by
 * the running runtime's admin API through its discovery record. Read-only
 * except `test`, which sends one tiny request to the named provider.
 */
type Provider = { id: string; name: string; kind?: string; configured?: boolean; credentialStatus?: string; enabled?: boolean
  models?: string[]; selectedModel?: string; modelCapabilities?: Record<string, { contextWindowTokens?: number; maxOutputTokens?: number
    pricing?: { inputUsdPerMillion?: number; outputUsdPerMillion?: number } }> }

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

async function providers(request: RuntimeRequest): Promise<Provider[]> {
  const snapshot = await json(request, '/v1/model-connections')
  return (Array.isArray(snapshot.providers) ? snapshot.providers : []) as Provider[]
}

const k = (tokens: number | undefined): string => tokens ? `${Math.round(tokens / 1_000)}K` : '-'

export async function providerCommand(argv: readonly string[], io: GatewayCliIo, request: RuntimeRequest): Promise<number> {
  const [sub = 'list', id] = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--model')
  if (sub === 'list') {
    const list = await providers(request)
    if (argv.includes('--json')) { io.stdout.write(JSON.stringify(list, null, 2) + '\n'); return 0 }
    io.stdout.write(list.length ? table([['ID', 'NAME', 'KIND', 'MODELS', 'CREDENTIAL'], ...list.map((provider) => [provider.id, provider.name,
      provider.kind ?? 'http', String(provider.models?.length ?? 0),
      provider.enabled === false ? 'disabled' : provider.credentialStatus ?? (provider.configured ? 'ready' : 'missing')])]) : 'No providers are connected.\n')
    return 0
  }
  if ((sub === 'models' || sub === 'test') && !id) { io.stderr.write(GATEWAY_CLI_USAGE); return 2 }
  if (sub === 'models') {
    const provider = (await providers(request)).find((entry) => entry.id === id)
    if (!provider) { io.stderr.write(`kun: no provider '${id}'\n`); return 2 }
    const rows = (provider.models ?? []).map((model) => {
      const caps = provider.modelCapabilities?.[model]
      const price = caps?.pricing?.inputUsdPerMillion !== undefined
        ? `$${caps.pricing.inputUsdPerMillion}/$${caps.pricing.outputUsdPerMillion ?? '?'} per M` : '-'
      return [model + (model === provider.selectedModel ? ' *' : ''), k(caps?.contextWindowTokens), k(caps?.maxOutputTokens), price]
    })
    io.stdout.write(rows.length ? table([['MODEL', 'WINDOW', 'OUTPUT', 'PRICE (IN/OUT)'], ...rows]) : 'This provider lists no models.\n')
    return 0
  }
  if (sub === 'test') {
    const model = flagValue(argv, '--model')
    const result = await json(request, `/v1/model-connections/${encodeURIComponent(id!)}/probe`, 'POST', { mode: 'inference', ...(model ? { model } : {}) })
    const ok = result.ok === true
    io.stdout.write(`${ok ? 'ok' : 'failed'}  ${String(result.model ?? model ?? '')}  ${typeof result.latencyMs === 'number' ? `${result.latencyMs} ms` : ''}\n`)
    if (!ok && typeof result.message === 'string') io.stdout.write(`  ${result.message}\n`)
    if (typeof result.hint === 'string') io.stdout.write(`  ${result.hint}\n`)
    return ok ? 0 : 1
  }
  io.stderr.write(GATEWAY_CLI_USAGE)
  return 2
}

/** `kun gateway route <alias>`: the live order a routed model would try, with reasons for skipped members. */
export async function routePreviewCommand(argv: readonly string[], io: GatewayCliIo, request: RuntimeRequest): Promise<number> {
  const alias = argv.find((arg) => !arg.startsWith('--'))
  if (!alias) { io.stderr.write(GATEWAY_CLI_USAGE); return 2 }
  const routes = await json(request, '/v1/model-routes')
  const pools = (Array.isArray(routes.pools) ? routes.pools : []) as { id: string; modelId: string }[]
  const pool = pools.find((entry) => entry.modelId === alias || entry.id === alias)
  if (!pool) { io.stderr.write(`kun: no routed model '${alias}'\n`); return 2 }
  const preview = await json(request, '/v1/provider-config/routes/preview', 'POST', { routeId: pool.id, ...(argv.includes('--tools') ? { tools: true } : {}) })
  if (argv.includes('--json')) { io.stdout.write(JSON.stringify(preview, null, 2) + '\n'); return 0 }
  const targets = (Array.isArray(preview.targets) ? preview.targets : []) as { targetId: string; providerId: string; modelId: string; eligible: boolean; reason: string }[]
  const order = (Array.isArray(preview.orderedTargetIds) ? preview.orderedTargetIds : []) as string[]
  io.stdout.write(`${String(preview.alias)}  strategy ${String(preview.strategy)}, affinity ${String(preview.affinity)}, up to ${String(preview.maxAttempts)} attempts\n`)
  const rows = [...order.map((targetId, index) => {
    const target = targets.find((entry) => entry.targetId === targetId)!
    return [String(index + 1), `${target.providerId}/${target.modelId}`, 'will try']
  }), ...targets.filter((target) => !target.eligible).map((target) => ['-', `${target.providerId}/${target.modelId}`, `skipped: ${target.reason}`])]
  io.stdout.write(table([['#', 'MEMBER', 'STATE'], ...rows]))
  return 0
}

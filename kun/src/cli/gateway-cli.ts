import { AgentWiringBridge, type RuntimeRequest } from '../agent-wiring/bridge.js'
import { providerCommand, routePreviewCommand } from './provider-cli.js'
import type { AgentWiringAction, AgentWiringResult } from '../agent-wiring/protocol.js'
import { readRuntimeDiscovery } from '../server/runtime-discovery.js'
import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { runtimeDiscoveryDirectory } from './shared-runtime-support.js'
import { defaultKunDataDir } from './kun-data-dir.js'

/**
 * `kun gateway|agents|quota` — the local gateway and agent wiring from a
 * terminal. Every command goes through the running runtime's admin API, the
 * same path the desktop app uses; nothing here edits Kun's own state files.
 */
export type GatewayCliIo = {
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
  env: Record<string, string | undefined>
  /** Test seam: the runtime admin request function. */
  runtimeRequest?: RuntimeRequest
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export const GATEWAY_CLI_USAGE = `Gateway and agents:
  kun gateway status                     Address, discovery and whether the gateway is on
  kun gateway models [--json]            Models the gateway serves, with windows and reasoning
  kun gateway keys                       Client keys
  kun gateway keys create <name> [--model <id>]   Create a key (printed once)
  kun gateway keys limit <client-id> [--json]   Window usage, remaining allowance and reset time
  kun gateway keys revoke <client-id>
  kun gateway keys rotate <client-id>    Rotate a key (printed once)
  kun gateway route <alias>              Which members a routed model would try now, in order, and why others are skipped
  kun gateway routes [--json]            Recent requests: model asked, served, why and fallbacks
  kun gateway middleware                 Middleware counters
  kun agents                             Agents on this computer and their models
  kun agents connect <agent> <model> [--effort <level>] [--small <model>] [--dry-run]
  kun agents disconnect <agent>
  kun agents sync                        Rewrite model lists in agents that keep a copy
  kun agents profiles                    Saved profiles
  kun agents save <name> | use <name> | forget <name>
  kun provider list                      Connected providers, their models and credential state
  kun provider models <provider-id>      Models with windows, output limits and prices
  kun provider test <provider-id> [--model <id>]   Send one tiny request to that provider (uses a few tokens)
  kun quota [--refresh] [--json]         Balances and allowance windows
  kun quota wait <provider> [--timeout <minutes>]   Wait until an allowance is available again
`

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function positional(argv: readonly string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index]!.startsWith('--')) { if (!['--json', '--refresh', '--dry-run'].includes(argv[index]!)) index += 1; continue }
    out.push(argv[index]!)
  }
  return out
}

/** Finds the running runtime through its discovery record and calls it with the admin token. */
export async function discoveredRuntimeRequest(env: Record<string, string | undefined>): Promise<RuntimeRequest> {
  const flavor: RuntimeFlavor = env.KUN_RUNTIME_FLAVOR === 'development' ? 'development' : 'production'
  const dataDir = env.KUN_DATA_DIR?.trim() || defaultKunDataDir()
  const record = await readRuntimeDiscovery(env.KUN_RUNTIME_DISCOVERY_DIR?.trim() || runtimeDiscoveryDirectory(dataDir, flavor), flavor)
  if (!record) throw new Error('No running Kun runtime was found. Start the Kun app or run `kun serve` first.')
  return async (path, method = 'GET', body) => {
    const response = await fetch(`${record.baseUrl.replace(/\/+$/, '')}${path}`, {
      method, signal: AbortSignal.timeout(130_000),
      headers: { authorization: `Bearer ${record.runtimeToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body } : {})
    })
    return { ok: response.ok, status: response.status, body: await response.text() }
  }
}

export async function json(request: RuntimeRequest, path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
  const response = await request(path, method, body === undefined ? undefined : JSON.stringify(body))
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(response.body) as Record<string, unknown> } catch { /* keep empty */ }
  if (!response.ok) throw new Error(typeof parsed.message === 'string' ? parsed.message : `Kun runtime request failed (HTTP ${response.status})`)
  return parsed
}

export function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)))
  return rows.map((row) => row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column]!)).join('  ')).join('\n') + '\n'
}

async function gatewayCommand(argv: readonly string[], io: GatewayCliIo, request: RuntimeRequest): Promise<number> {
  const [sub = 'status', action, target] = positional(argv)
  if (sub === 'status') {
    const hello = await json(request, '/api/hello')
    const gateway = (hello.gateway ?? {}) as Record<string, unknown>
    io.stdout.write(`Kun ${String(hello.version ?? '')}\n  gateway: ${gateway.enabled ? 'on' : 'off'}\n  OpenAI base:    ${String(gateway.v1 ?? '')}\n  Anthropic base: ${String(gateway.anthropic ?? '')}\n  Gemini base:    ${String(gateway.anthropic ?? '')}\n  route trace:    ${String(gateway.routeTrace ?? '')}\n  key limits:     ${String(gateway.limit ?? '')}\n`)
    return 0
  }
  if (sub === 'models') {
    const catalog = await json(request, '/v1/model-gateway/catalog')
    const data = (Array.isArray(catalog.data) ? catalog.data : []) as Record<string, unknown>[]
    if (argv.includes('--json')) { io.stdout.write(JSON.stringify(data, null, 2) + '\n'); return 0 }
    if (!data.length) { io.stdout.write('The gateway serves no models yet.\n'); return 0 }
    io.stdout.write(table([['MODEL', 'WINDOW', 'REASONING', 'NAME'], ...data.map((row) => [String(row.id),
      typeof row.context_window === 'number' ? `${Math.round(row.context_window / 1000)}K` : '-',
      Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels.map((level) => (level as { effort: string }).effort).join('/') : '-',
      String(row.display_name ?? '')])]))
    return 0
  }
  if (sub === 'keys') {
    if (!action) {
      const listed = await json(request, '/v1/model-gateway/clients')
      const clients = (Array.isArray(listed.clients) ? listed.clients : []) as Record<string, unknown>[]
      io.stdout.write(clients.length ? table([['ID', 'NAME', 'STATE'], ...clients.map((client) => [String(client.clientId), String(client.name),
        client.revokedAt ? 'revoked' : 'active'])]) : 'No client keys.\n')
      return 0
    }
    if (action === 'create' && target) {
      const model = flag(argv, '--model')
      const created = await json(request, '/v1/model-gateway/clients', 'POST', { name: target, ...(model ? { modelId: model } : {}) })
      io.stdout.write(`${String(created.key)}\n`)
      io.stderr.write('This key is shown once. Store it now.\n')
      return 0
    }
    if (action === 'limit' && target) {
      const limit = await json(request, `/v1/model-gateway/clients/${encodeURIComponent(target)}/limit`)
      if (argv.includes('--json')) { io.stdout.write(JSON.stringify(limit, null, 2) + '\n'); return 0 }
      io.stdout.write(formatLimit(limit))
      return 0
    }
    if ((action === 'revoke' || action === 'rotate') && target) {
      const result = await json(request, `/v1/model-gateway/clients/${encodeURIComponent(target)}${action === 'rotate' ? '/rotate' : ''}`,
        action === 'rotate' ? 'POST' : 'DELETE', action === 'rotate' ? {} : undefined)
      io.stdout.write(action === 'rotate' ? `${String(result.key)}\n` : 'Revoked.\n')
      return 0
    }
  }
  if (sub === 'routes') {
    const result = await json(request, '/v1/model-gateway/route-traces')
    const traces = (Array.isArray(result.traces) ? result.traces : []) as Record<string, unknown>[]
    if (argv.includes('--json')) { io.stdout.write(JSON.stringify(traces, null, 2) + '\n'); return 0 }
    io.stdout.write(traces.length ? table([['TIME', 'AGENT', 'ASKED', 'SERVED', 'WHY', 'TRIES', 'STATUS'], ...traces.slice(-30).map((trace) => [
      String(trace.startedAt).slice(11, 19), String(trace.agent ?? trace.client ?? '-'), String(trace.asked),
      String(trace.served ?? trace.model ?? '-'), String(trace.decision ?? '-') + (trace.rule ? `:${String(trace.rule)}` : ''),
      String((trace.tries as unknown[] | undefined)?.length ?? 0), String(trace.status ?? 'running')])]) : 'No gateway requests yet.\n')
    return 0
  }
  if (sub === 'middleware') {
    const result = await json(request, '/v1/model-gateway/middleware')
    const rows = (Array.isArray(result.middleware) ? result.middleware : []) as Record<string, unknown>[]
    io.stdout.write(rows.length ? table([['ID', 'TYPE', 'ON', 'CALLS', 'AVG µs', 'FAILED'], ...rows.map((row) => [String(row.id), String(row.type),
      row.enabled ? 'yes' : 'no', String(row.calls), String(Math.round(Number(row.averageMicros))), String(row.failures)])]) : 'No middleware.\n')
    return 0
  }
  io.stderr.write(GATEWAY_CLI_USAGE)
  return 2
}

function formatLimit(limit: Record<string, unknown>): string {
  const lines = [`${limit.limited ? 'LIMITED' : 'ok'}  ${String((limit.client as { name?: string; id?: string } | undefined)?.name ?? '')}`]
  const rate = limit.rate as Record<string, number> | undefined
  if (rate) lines.push(`  rate: ${rate.requestsPerMinute}/min, burst ${rate.burst}, ${rate.active}/${rate.maxConcurrent} in flight`)
  const tokens = limit.tokenBudget as Record<string, unknown> | undefined
  if (tokens) lines.push(`  tokens: ${String(tokens.used)} / ${String(tokens.tokens)} this ${String(tokens.period)} (${String(tokens.mode)}), resets ${String(tokens.resetsAt)}`)
  const cost = limit.cost as Record<string, unknown> | undefined
  if (cost) lines.push(`  cost: $${String(cost.used)} / $${String(cost.usd)} this ${String(cost.period)}${cost.enforce ? ' (enforced)' : ' (alert)'}, resets ${String(cost.resetsAt)}`)
  const models = limit.models
  lines.push(`  models: ${models === 'all' ? 'all' : Array.isArray(models) && models.length ? models.join(', ') : 'none'}`)
  return lines.join('\n') + '\n'
}

function printAgents(result: Extract<AgentWiringResult, { ok: true }>, io: GatewayCliIo): void {
  io.stdout.write(table([['AGENT', 'STATE', 'MODEL', 'CONFIG'], ...result.agents.filter((agent) => agent.installed || agent.connected)
    .map((agent) => [agent.id, agent.drifted ? 'changed outside Kun' : agent.connected ? 'connected' : 'not connected', agent.model ?? '-',
      agent.configFiles[0] ?? ''])]))
}

async function agentsCommand(argv: readonly string[], io: GatewayCliIo, request: RuntimeRequest): Promise<number> {
  const [sub = 'list', first, second] = positional(argv)
  const bridge = new AgentWiringBridge(request)
  let action: AgentWiringAction | undefined
  if (sub === 'list') action = { action: 'list' }
  else if (sub === 'connect' && first && second) {
    const effort = flag(argv, '--effort')
    const small = flag(argv, '--small')
    action = { action: argv.includes('--dry-run') ? 'preview' : 'connect', agentId: first, model: second,
      ...(effort ? { effort } : {}), ...(small ? { smallModel: small } : {}) }
  } else if (sub === 'disconnect' && first) action = { action: 'disconnect', agentId: first }
  else if (sub === 'sync') action = { action: 'sync' }
  else if (sub === 'profiles') action = { action: 'list' }
  else if (sub === 'save' && first) action = { action: 'save-profile', name: first }
  else if (sub === 'use' && first) action = { action: 'apply-profile', name: first }
  else if (sub === 'forget' && first) action = { action: 'delete-profile', name: first }
  if (!action) { io.stderr.write(GATEWAY_CLI_USAGE); return 2 }
  const result = await bridge.handle(action)
  if (!result.ok) { io.stderr.write(`kun: ${result.error}\n`); return 1 }
  if (sub === 'profiles') {
    const names = Object.entries(result.profiles)
    io.stdout.write(names.length ? names.map(([name, profile]) => `${name}: ${Object.entries(profile).map(([agent, selection]) => `${agent}=${selection.model}`).join(', ')}`).join('\n') + '\n' : 'No saved profiles.\n')
    return 0
  }
  if (action.action === 'preview') {
    const files = result.preview?.files ?? []
    io.stdout.write(files.length ? files.map((file) => `${file.created ? '(new file) ' : ''}${file.file}\n${file.diff}`).join('\n')
      : 'Nothing in this agent\'s config needs to change.\n')
    io.stdout.write('Dry run: nothing was written. Keys are masked.\n')
  }
  if (action.action === 'connect') io.stdout.write(`${action.agentId} now uses ${action.model} through Kun.${result.notice === 'restart' ? ' Start a new session to pick it up.' : ''}\n`)
  if (action.action === 'disconnect') io.stdout.write(`${action.agentId} is back on its own settings.\n`)
  if (action.action === 'sync') io.stdout.write(result.applied?.length ? `Updated: ${result.applied.join(', ')}\n` : 'Nothing to update.\n')
  if (action.action === 'apply-profile') {
    io.stdout.write(`Applied to: ${(result.applied ?? []).join(', ') || 'none'}\n`)
    for (const failure of result.failed ?? []) io.stderr.write(`  ${failure.agentId}: ${failure.error}\n`)
  }
  if (action.action === 'list') printAgents(result, io)
  return result.failed?.length ? 1 : 0
}

type QuotaEntry = { providerId: string; providerName: string; status: string; message?: string
  metrics: { label: string; unit: string; remaining?: number; usedPercent?: number; resetsAt?: string }[] }

function quotaAvailable(entry: QuotaEntry, now: number): { available: boolean; nextReset?: number } {
  if (entry.status !== 'available') return { available: false }
  const live = entry.metrics.filter((metric) => !metric.resetsAt || Date.parse(metric.resetsAt) > now)
  const exhausted = live.filter((metric) => (metric.usedPercent !== undefined && metric.usedPercent >= 100) || (metric.remaining !== undefined && metric.remaining <= 0))
  const resets = exhausted.map((metric) => metric.resetsAt ? Date.parse(metric.resetsAt) : NaN).filter(Number.isFinite)
  return { available: exhausted.length === 0, ...(resets.length ? { nextReset: Math.max(...resets) } : {}) }
}

async function quotaCommand(argv: readonly string[], io: GatewayCliIo, request: RuntimeRequest): Promise<number> {
  const [sub, target] = positional(argv)
  const load = async (refresh: boolean): Promise<QuotaEntry[]> =>
    ((await json(request, `/v1/provider-quotas${refresh ? '?refresh=1' : ''}`)).entries ?? []) as QuotaEntry[]
  if (sub === 'wait') {
    if (!target) { io.stderr.write(GATEWAY_CLI_USAGE); return 2 }
    const now = io.now ?? Date.now
    const sleep = io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const timeoutMinutes = Number(flag(argv, '--timeout') ?? 0)
    const deadline = timeoutMinutes > 0 ? now() + timeoutMinutes * 60_000 : Infinity
    for (let attempt = 0; ; attempt += 1) {
      const entry = (await load(attempt > 0)).find((candidate) => candidate.providerId === target)
      if (!entry) { io.stderr.write(`kun: no quota reading for '${target}'\n`); return 2 }
      const state = quotaAvailable(entry, now())
      if (state.available) { io.stdout.write(`${entry.providerName} has allowance again.\n`); return 0 }
      const wait = Math.min(10 * 60_000, Math.max(60_000, state.nextReset ? state.nextReset - now() + 15_000 : 5 * 60_000))
      if (now() + wait > deadline) { io.stderr.write('kun: timed out waiting for allowance\n'); return 1 }
      io.stderr.write(`Waiting ${Math.round(wait / 60_000)} min for ${entry.providerName}${state.nextReset ? ` (resets ${new Date(state.nextReset).toLocaleString()})` : ''}...\n`)
      await sleep(wait)
    }
  }
  const entries = await load(argv.includes('--refresh'))
  if (argv.includes('--json')) { io.stdout.write(JSON.stringify(entries, null, 2) + '\n'); return 0 }
  for (const entry of entries) {
    io.stdout.write(`${entry.providerName} (${entry.providerId}) — ${entry.status}${entry.message ? `: ${entry.message}` : ''}\n`)
    for (const metric of entry.metrics) {
      const value = metric.usedPercent !== undefined ? `${Math.round(metric.usedPercent)}% used` : metric.remaining !== undefined ? `${metric.remaining} ${metric.unit} left` : ''
      io.stdout.write(`  ${metric.label}: ${value}${metric.resetsAt ? `, resets ${new Date(metric.resetsAt).toLocaleString()}` : ''}\n`)
    }
  }
  if (!entries.length) io.stdout.write('No providers report balances or quotas.\n')
  return 0
}

export async function runGatewayCliCommand(group: 'gateway' | 'agents' | 'quota' | 'provider', argv: readonly string[], io: GatewayCliIo): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) { io.stdout.write(GATEWAY_CLI_USAGE); return 0 }
  try {
    const request = io.runtimeRequest ?? await discoveredRuntimeRequest(io.env)
    if (group === 'provider') return await providerCommand(argv, io, request)
    if (group === 'gateway' && argv[0] === 'route') return await routePreviewCommand(argv.slice(1), io, request)
    if (group === 'gateway') return await gatewayCommand(argv, io, request)
    if (group === 'agents') return await agentsCommand(argv, io, request)
    return await quotaCommand(argv, io, request)
  } catch (error) {
    io.stderr.write(`kun: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

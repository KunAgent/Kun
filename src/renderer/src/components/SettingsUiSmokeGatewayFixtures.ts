import type { AgentWiringAction, AgentWiringResult, AgentWiringStatus } from '@shared/agent-wiring'
import type { GatewayClientAction, GatewayClientResult } from '@shared/gateway-clients'

const AT = '2026-01-01T12:00:00.000Z'
const HOME = '/Users/smoke'

/**
 * Offline gateway data for the Settings fixture: recent routes, discovery,
 * middleware, per-key limits and the Agents page, covering the states each
 * panel can show (fallbacks, another Kun holding the discovery file, a
 * keychain agent, a config the agent ignores).
 */
export function createGatewaySmokeFixtures() {
  const traces = [
    { seq: 3, requestId: 'r3', asked: 'coding', agent: 'claude-code', client: 'Agent · Claude Code', startedAt: AT, effort: 'high',
      tries: [{ providerId: 'deepseek', modelId: 'deepseek-chat', decision: 'rule' }], done: false, model: 'deepseek/deepseek-chat', decision: 'rule', rule: 'long-context' },
    { seq: 2, requestId: 'r2', asked: 'coding', agent: 'codex', client: 'Agent · Codex', startedAt: AT,
      tries: [{ providerId: 'moonshot', modelId: 'kimi-k2', fail: 'rate_limit' }, { providerId: 'deepseek', modelId: 'deepseek-chat', decision: 'failover' }],
      done: true, status: 'completed', served: 'deepseek/deepseek-chat', decision: 'failover', firstTokenMs: 640, durationMs: 4_210 },
    { seq: 1, requestId: 'r1', asked: 'fast', agent: 'opencode', client: 'Agent · OpenCode', startedAt: AT,
      tries: [{ providerId: 'zai', modelId: 'glm-4.6', decision: 'rule' }], done: true, status: 'failed', decision: 'rule', intent: 'chat', durationMs: 1_020 }
  ]
  const agent = (id: string, name: string, extra: Partial<AgentWiringStatus> = {}): AgentWiringStatus => ({
    id, name, protocol: 'chat', homepage: 'https://example.invalid', installed: true, configFiles: [`${HOME}/.config/${id}/config.json`],
    connected: false, drifted: false, efforts: [], restartRequired: true, keepsModelList: false, pickInAgent: false, ...extra })
  let agents: AgentWiringStatus[] = [
    agent('codex', 'Codex', { protocol: 'responses', configFiles: [`${HOME}/.codex/config.toml`], connected: true, model: 'coding', efforts: ['low', 'medium', 'high'], effort: 'high', clientId: 'gc_codex' }),
    agent('zed', 'Zed', { configFiles: [`${HOME}/.config/zed/settings.json`], connected: true, model: 'coding', restartRequired: false, keepsModelList: true,
      notice: 'manual-key', keyDelivery: 'clipboard', clientId: 'gc_zed' }),
    agent('claude-code', 'Claude Code', { protocol: 'anthropic', configFiles: [`${HOME}/.claude/settings.json`], efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      error: 'Claude Code ignores settings.json because it is not strict JSON', errorCode: 'strict_json_required', errorFile: `${HOME}/.claude/settings.json` }),
    agent('gemini-cli', 'Gemini CLI', { protocol: 'gemini', configFiles: [`${HOME}/.gemini/settings.json`, `${HOME}/.gemini/.env`], notice: 'trusted-folders' }),
    agent('goose', 'Goose', { installed: false })
  ]
  const models = [{ id: 'coding', displayName: 'Daily coding', contextWindow: 200_000, reasoningLevels: ['low', 'high'], images: true }, { id: 'fast' }]
  const overview = () => ({ origin: 'http://127.0.0.1:18899', gatewayEnabled: true, agents: structuredClone(agents), models, profiles: {} })
  return {
    /** GET routes the gateway panels read; undefined when the path is not a gateway one. */
    runtime(url: URL): unknown {
      if (url.pathname === '/v1/model-gateway/route-traces') {
        const after = Number(url.searchParams.get('after') ?? 0)
        return { seq: 3, traces: traces.filter((trace) => trace.seq > after) }
      }
      if (url.pathname === '/v1/model-gateway/discovery') {
        return { allowed: true, advertised: false, owner: 'other', path: `${HOME}/.kun/gateway.json`, other: { baseUrl: 'http://127.0.0.1:18900', pid: 4242 } }
      }
      if (url.pathname === '/v1/model-gateway/middleware') return { middleware: [], directory: `${HOME}/.kun/gateway-middleware`, files: ['redact.js'] }
      return undefined
    },
    agentWiring(action: AgentWiringAction): AgentWiringResult {
      if (action.action === 'disconnect') agents = agents.map((item) => item.id === action.agentId ? { ...item, connected: false, model: undefined } : item)
      if (action.action === 'copy-key') return { ok: true, notice: 'key-copied', ...overview() }
      if (action.action === 'preview') {
        return { ok: true, preview: { agentId: action.agentId, restartRequired: true, files: [{ file: `${HOME}/.codex/config.toml`, created: false,
          diff: '@@ -1,2 +1,4 @@\n model = "gpt-5"\n+model_provider = "kun"\n+[model_providers.kun]\n+base_url = "http://127.0.0.1:18899/v1"' }] }, ...overview() }
      }
      return { ok: true, ...overview() }
    },
    gatewayClients(action: GatewayClientAction): GatewayClientResult {
      if (action.action === 'list') {
        return { ok: true, status: 200, clients: [{ clientId: 'gc_codex', name: 'Agent · Codex', createdAt: AT, scopeMode: 'scoped' }] }
      }
      if (action.action === 'limit') {
        return { ok: true, status: 200, limit: { client: { id: action.clientId, name: 'Agent · Codex' }, limited: false, models: ['coding'],
          rate: { requestsPerMinute: 60, burst: 20, maxConcurrent: 2, active: 1 },
          tokenBudget: { mode: 'hard', period: 'day', timeZone: 'UTC', tokens: 2_000_000, used: 1_450_000, left: 550_000, resetsAt: '2026-01-02T00:00:00.000Z' },
          cost: { period: 'day', timeZone: 'UTC', usd: 5, used: 4.2, left: 0.8, enforce: true, resetsAt: '2026-01-02T00:00:00.000Z' } } }
      }
      return { ok: false, status: 501, error: 'Unavailable in the offline Settings UI fixture.' }
    }
  }
}

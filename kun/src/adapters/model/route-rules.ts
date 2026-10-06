import { createHash } from 'node:crypto'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import {
  MAX_NESTED_ROUTE_DEPTH,
  NESTED_ROUTE_PROVIDER_ID,
  type ModelRoutePoolConfig,
  type ModelRouteRule,
  type ModelRouteTargetConfig
} from '../../contracts/model-route-pool.js'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'

/**
 * Turn-level routing decisions for a route pool: rules that put a member
 * first, pinned reasoning, overflow demotion and nested aliases. A rule is
 * decided when a turn begins and held for the turn, so tool results return to
 * the model that asked for them.
 */
export type RouteDecision = {
  ruleId?: string
  use?: string
  effort?: string
  intent?: string
}

const DECISION_CAPACITY = 2_000
const DECISION_TTL_MS = 30 * 60_000
const CLASSIFY_TIMEOUT_MS = 8_000
const OVERFLOW_SHARE = 0.95

/** Rough prompt size: four characters a token, plus a flat cost per image. */
export function estimateRequestTokens(request: Pick<ModelRequest, 'systemPrompt' | 'prefix' | 'history' | 'attachments' | 'tools'>): number {
  let chars = (request.systemPrompt ?? '').length
  for (const item of [...request.prefix, ...request.history]) chars += JSON.stringify(item).length
  for (const tool of request.tools) chars += JSON.stringify(tool).length
  return Math.ceil(chars / 4) + (request.attachments?.length ?? 0) * 1_000
}

export function requestHasImages(request: Pick<ModelRequest, 'attachments' | 'messageAttachments'>): boolean {
  return Boolean(request.attachments?.length) || Object.values(request.messageAttachments ?? {}).some((entry) => entry.images.length > 0)
}

export function latestUserText(request: Pick<ModelRequest, 'history'>): string {
  for (let index = request.history.length - 1; index >= 0; index -= 1) {
    const item = request.history[index]!
    if (item.kind === 'user_message') return item.text
  }
  return ''
}

/** A rule's `use` names a target, or a nested alias whose flattened members share its prefix. */
export function targetMatchesUse(targetId: string, use: string): boolean {
  return targetId === use || targetId.startsWith(`${use}>`)
}

export type RuleContext = { agent: string; tokens: number; images: boolean; effort?: string; hour: number; text: string; intent?: string }

export function ruleMatches(rule: ModelRouteRule, context: RuleContext): boolean {
  if (!rule.enabled) return false
  const when = rule.when
  if (when.agents?.length && !when.agents.includes(context.agent)) return false
  if (when.minTokens !== undefined && context.tokens < when.minTokens) return false
  if (when.maxTokens !== undefined && context.tokens > when.maxTokens) return false
  if (when.images !== undefined && when.images !== context.images) return false
  if (when.efforts?.length && !when.efforts.includes((context.effort ?? 'auto') as never)) return false
  if (when.hours) {
    const { from, to } = when.hours
    const inside = from < to ? context.hour >= from && context.hour < to : context.hour >= from || context.hour < to
    if (!inside) return false
  }
  if (when.contains && !context.text.toLowerCase().includes(when.contains.toLowerCase())) return false
  if (when.intent && when.intent !== context.intent) return false
  return true
}

/** Stable order with `predicate` members first. */
function promote<T>(items: readonly T[], predicate: (item: T) => boolean): T[] {
  return [...items.filter(predicate), ...items.filter((item) => !predicate(item))]
}

/**
 * Moves members whose known window this request would fill to 95% or more
 * behind members with room. Unknown windows are never treated as small.
 */
export function demoteOverflow(targets: ModelRouteTargetConfig[], tokens: number,
  capabilities: (modelId: string, providerId?: string) => ModelCapabilityMetadata | undefined): ModelRouteTargetConfig[] {
  const crowded = (target: ModelRouteTargetConfig): boolean => {
    const window = capabilities(target.modelId, target.providerId)?.contextWindowTokens
    return window !== undefined && tokens >= window * OVERFLOW_SHARE
  }
  if (!targets.some(crowded) || targets.every(crowded)) return targets
  return promote(targets, (target) => !crowded(target))
}

export function orderByDecision(targets: ModelRouteTargetConfig[], decision: RouteDecision): ModelRouteTargetConfig[] {
  return decision.use ? promote(targets, (target) => targetMatchesUse(target.id, decision.use!)) : targets
}

/** Reasoning to send a member at: its own pin, else the rule's for the rule's member, else the caller's. */
export function effortFor(target: ModelRouteTargetConfig, decision: RouteDecision, requested?: string): string | undefined {
  if (target.effort) return target.effort
  if (decision.effort && decision.use && targetMatchesUse(target.id, decision.use)) return decision.effort
  return requested
}

type CachedDecision = { decision: RouteDecision; expiresAt: number }

export class RouteRuleEngine {
  private readonly decisions = new Map<string, CachedDecision>()
  private readonly intents = new Map<string, { intent?: string; expiresAt: number }>()

  constructor(private readonly classifierClient: () => ModelClient | undefined, private readonly now: () => number = Date.now) {}

  clear(): void { this.decisions.clear(); this.intents.clear() }

  private turnKey(pool: ModelRoutePoolConfig, request: ModelRequest): string {
    const turn = request.gatewayRouting?.affinity?.turn ?? request.turnId
    return createHash('sha256').update(JSON.stringify([pool.id, request.gatewayRouting?.callerId ?? 'kun', turn])).digest('hex')
  }

  async decide(pool: ModelRoutePoolConfig, request: ModelRequest): Promise<RouteDecision> {
    const rules = (pool.rules ?? []).filter((rule) => rule.enabled)
    if (!rules.length) return {}
    const key = this.turnKey(pool, request)
    const cached = this.decisions.get(key)
    if (cached && cached.expiresAt > this.now()) return cached.decision
    const text = latestUserText(request)
    const intent = rules.some((rule) => rule.when.intent) && pool.classifier ? await this.classify(pool, request, text) : undefined
    const context: RuleContext = {
      agent: request.gatewayRouting?.agent ?? (request.gatewayRouting ? 'unknown' : 'kun'),
      tokens: estimateRequestTokens(request), images: requestHasImages(request),
      ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
      hour: new Date(this.now()).getHours(), text, ...(intent ? { intent } : {})
    }
    const rule = rules.find((candidate) => ruleMatches(candidate, context))
    const decision: RouteDecision = rule
      ? { ruleId: rule.id, use: rule.use, ...(rule.effort ? { effort: rule.effort } : {}), ...(intent ? { intent } : {}) }
      : intent ? { intent } : {}
    this.decisions.delete(key)
    while (this.decisions.size >= DECISION_CAPACITY) this.decisions.delete(this.decisions.keys().next().value!)
    this.decisions.set(key, { decision, expiresAt: this.now() + DECISION_TTL_MS })
    return decision
  }

  /** Asks the pool's classifier which intent the turn's message is; any failure means no intent. */
  private async classify(pool: ModelRoutePoolConfig, request: ModelRequest, text: string): Promise<string | undefined> {
    const classifier = pool.classifier!
    const client = this.classifierClient()
    if (!client || !text.trim()) return undefined
    const key = createHash('sha256').update(JSON.stringify([pool.id, classifier, text.slice(0, 4_000)])).digest('hex')
    const cached = this.intents.get(key)
    if (cached && cached.expiresAt > this.now()) return cached.intent
    let answer = ''
    try {
      const signal = AbortSignal.any([request.abortSignal, AbortSignal.timeout(CLASSIFY_TIMEOUT_MS)])
      const now = new Date(this.now()).toISOString()
      const classification: ModelRequest = {
        threadId: `route-classifier:${pool.id}`, turnId: `route-classifier:${key.slice(0, 16)}`,
        model: classifier.modelId, providerId: classifier.providerId,
        systemPrompt: `Classify the user's message as exactly one of: ${classifier.intents.join(', ')}. Answer with that one word, or none.`,
        prefix: [], tools: [], stream: true, maxTokens: 16, reasoningEffort: 'off', abortSignal: signal,
        history: [{ id: 'route-classifier-message', kind: 'user_message', role: 'user', text: text.slice(0, 4_000),
          threadId: `route-classifier:${pool.id}`, turnId: `route-classifier:${key.slice(0, 16)}`, status: 'completed', createdAt: now }]
      }
      for await (const chunk of client.stream(classification)) {
        if (chunk.kind === 'assistant_text_delta') answer += chunk.text
        if (chunk.kind === 'error' || answer.length > 200) break
        if (chunk.kind === 'completed') break
      }
    } catch { answer = '' }
    const normalized = answer.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '')
    const intent = classifier.intents.find((candidate) => normalized === candidate.toLowerCase() || normalized.split(/\s+/)[0] === candidate.toLowerCase())
    this.intents.set(key, { ...(intent ? { intent } : {}), expiresAt: this.now() + 10 * 60_000 })
    while (this.intents.size > DECISION_CAPACITY) this.intents.delete(this.intents.keys().next().value!)
    return intent
  }
}

function boundedTargetId(parent: string, child: string): string {
  const id = `${parent}>${child}`
  return id.length <= 64 ? id : `${parent.slice(0, 40)}>${createHash('sha256').update(id).digest('hex').slice(0, 20)}`
}

/**
 * Expands targets that name another alias (`@route`) into that route's own
 * targets, depth-first, at most three levels, skipping cycles. Rules and the
 * manual pick keep working through the `parent>child` id prefix.
 */
export function flattenNestedPools(pools: readonly ModelRoutePoolConfig[]): ModelRoutePoolConfig[] {
  const byAlias = new Map(pools.map((pool) => [pool.modelId.toLowerCase(), pool]))
  const expand = (pool: ModelRoutePoolConfig, trail: string[]): ModelRouteTargetConfig[] => pool.targets.flatMap((target) => {
    if (target.providerId !== NESTED_ROUTE_PROVIDER_ID) return [target]
    const child = byAlias.get(target.modelId.toLowerCase())
    if (!child || !child.enabled || !target.enabled || trail.includes(child.id) || trail.length >= MAX_NESTED_ROUTE_DEPTH) return []
    return expand(child, [...trail, child.id]).map((nested) => ({ ...nested, id: boundedTargetId(target.id, nested.id),
      enabled: nested.enabled, ...(target.effort && !nested.effort ? { effort: target.effort } : {}) }))
  })
  return pools.map((pool) => {
    if (!pool.targets.some((target) => target.providerId === NESTED_ROUTE_PROVIDER_ID)) return pool
    const targets = expand(pool, [pool.id])
    return { ...pool, targets, enabled: pool.enabled && targets.some((target) => target.enabled) }
  })
}

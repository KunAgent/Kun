import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import { ModelRoutePoolConfigSchema, type ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { RouteAffinity } from './route-affinity.js'
import { RoutePoolModelClient } from './route-pool-model-client.js'
import { demoteOverflow, flattenNestedPools, ruleMatches, type RuleContext } from './route-rules.js'

const capability = (model: string): ModelCapabilityMetadata => ({
  id: model, inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'],
  contextWindowTokens: model === 'small' ? 1_000 : 100_000,
  reasoning: { supportedEfforts: ['off', 'low', 'high', 'max'], defaultEffort: 'high', requestProtocol: 'openai-chat-completions' }
})

const policies = {
  failurePolicy: { failoverHttpStatusCodes: [429, 500], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
  healthPolicy: { failureThreshold: 2, cooldownMs: 1_000, halfOpenMaxAttempts: 1 }
}

function pool(patch: Partial<ModelRoutePoolConfig> = {}): ModelRoutePoolConfig {
  return { id: 'daily', name: 'Daily', modelId: 'daily', enabled: true, strategy: 'priority', ...policies,
    targets: [
      { id: 'fast', providerId: 'p-fast', modelId: 'fast', enabled: true, weight: 1 },
      { id: 'strong', providerId: 'p-strong', modelId: 'strong', enabled: true, weight: 1 },
      { id: 'small', providerId: 'p-small', modelId: 'small', enabled: true, weight: 1 }
    ], ...patch }
}

function request(text: string, patch: Partial<ModelRequest> = {}): ModelRequest {
  return { threadId: 't', turnId: 'turn-1', model: 'daily', prefix: [], tools: [], abortSignal: new AbortController().signal,
    history: [{ id: 'u', kind: 'user_message', role: 'user', text, threadId: 't', turnId: 'turn-1', status: 'completed', createdAt: new Date(0).toISOString() }],
    ...patch }
}

class Direct implements ModelClient {
  provider = 'fake'
  model = 'fake'
  seen: { target: string; effort?: string }[] = []
  constructor(private readonly classify = 'tests') {}
  async *stream(input: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (input.threadId.startsWith('route-classifier:')) {
      yield { kind: 'assistant_text_delta', text: this.classify }
      yield { kind: 'completed', stopReason: 'stop' }
      return
    }
    this.seen.push({ target: input.model, ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}) })
    yield { kind: 'assistant_text_delta', text: 'ok' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

async function drain(stream: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const out: ModelStreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

const context = (patch: Partial<RuleContext> = {}): RuleContext => ({ agent: 'claude-code', tokens: 500, images: false, hour: 10, text: 'fix the tests', ...patch })

describe('rule matching', () => {
  it('matches every declared condition and nothing else', () => {
    const rule = { id: 'r', enabled: true, use: 'strong', when: { agents: ['claude-code'], minTokens: 100, contains: 'TEST', hours: { from: 22, to: 6 } } }
    expect(ruleMatches(rule, context({ hour: 23 }))).toBe(true)
    expect(ruleMatches(rule, context({ hour: 3 }))).toBe(true)
    expect(ruleMatches(rule, context({ hour: 12 }))).toBe(false)
    expect(ruleMatches(rule, context({ hour: 23, agent: 'codex' }))).toBe(false)
    expect(ruleMatches(rule, context({ hour: 23, tokens: 10 }))).toBe(false)
    expect(ruleMatches({ ...rule, enabled: false }, context({ hour: 23 }))).toBe(false)
    expect(ruleMatches({ id: 'i', enabled: true, use: 'x', when: { images: true, efforts: ['high'] } }, context({ images: true, effort: 'high' }))).toBe(true)
  })
  it('accepts rules, pinned effort, the manual pick and classifier in the runtime contract', () => {
    expect(ModelRoutePoolConfigSchema.parse(pool({ strategy: 'manual', pick: 'strong', overflowMove: false,
      rules: [{ id: 'r', enabled: true, use: 'strong', effort: 'max', when: { intent: 'tests' } }],
      classifier: { providerId: 'p-fast', modelId: 'fast', intents: ['tests', 'chat'] } })).rules).toHaveLength(1)
  })
})

describe('route decisions', () => {
  it('puts the rule member first with its effort and holds the decision for the turn', async () => {
    const direct = new Direct()
    const client = new RoutePoolModelClient(direct, [pool({ rules: [
      { id: 'tests', enabled: true, use: 'strong', effort: 'max', when: { contains: 'test' } }] })], capability)
    const chunks = await drain(client.stream(request('please fix the tests')))
    expect(direct.seen[0]).toEqual({ target: 'strong', effort: 'max' })
    expect(chunks.find((chunk) => chunk.route)?.route?.ruleId).toBe('tests')
    // A tool-result request later in the same turn no longer mentions tests, but the decision holds.
    await drain(client.stream(request('ok, now continue')))
    expect(direct.seen[1]?.target).toBe('strong')
    await drain(client.stream(request('ok, now continue', { turnId: 'turn-2' })))
    expect(direct.seen[2]?.target).toBe('fast')
  })
  it('asks the classifier once per turn for intent rules', async () => {
    const direct = new Direct('tests')
    const client = new RoutePoolModelClient(direct, [pool({
      classifier: { providerId: 'p-fast', modelId: 'fast', intents: ['tests', 'chat'] },
      rules: [{ id: 'by-intent', enabled: true, use: 'strong', when: { intent: 'tests' } }] })], capability)
    await drain(client.stream(request('the suite is red')))
    expect(direct.seen[0]?.target).toBe('strong')
  })
  it('pins a member effort and sends to the manual pick first', async () => {
    const direct = new Direct()
    const client = new RoutePoolModelClient(direct, [pool({ strategy: 'manual', pick: 'strong',
      targets: [{ id: 'fast', providerId: 'p-fast', modelId: 'fast', enabled: true, weight: 1 },
        { id: 'strong', providerId: 'p-strong', modelId: 'strong', enabled: true, weight: 1, effort: 'low' }] })], capability)
    await drain(client.stream(request('hi', { reasoningEffort: 'high' })))
    expect(direct.seen[0]).toEqual({ target: 'strong', effort: 'low' })
  })
  it('moves a request off a member whose window it would nearly fill', () => {
    const targets = pool({ targets: [{ id: 'small', providerId: 'p-small', modelId: 'small', enabled: true, weight: 1 },
      { id: 'fast', providerId: 'p-fast', modelId: 'fast', enabled: true, weight: 1 }] }).targets
    expect(demoteOverflow(targets, 960, capability).map((target) => target.id)).toEqual(['fast', 'small'])
    expect(demoteOverflow(targets, 100, capability).map((target) => target.id)).toEqual(['small', 'fast'])
  })
})

describe('nested routes', () => {
  it('flattens an alias member into its own targets and skips cycles', () => {
    const inner = pool({ id: 'inner', modelId: 'inner', targets: [
      { id: 'x', providerId: 'p-x', modelId: 'x', enabled: true, weight: 1 },
      { id: 'loop', providerId: '@route', modelId: 'outer', enabled: true, weight: 1 }] })
    const outer = pool({ id: 'outer', modelId: 'outer', targets: [
      { id: 'first', providerId: 'p-a', modelId: 'a', enabled: true, weight: 1 },
      { id: 'group', providerId: '@route', modelId: 'inner', enabled: true, weight: 1, effort: 'high' }] })
    const [flatInner, flatOuter] = flattenNestedPools([inner, outer])
    expect(flatOuter!.targets.map((target) => [target.id, target.providerId, target.effort])).toEqual([
      ['first', 'p-a', undefined], ['group>x', 'p-x', 'high']])
    expect(flatInner!.targets.map((target) => target.id)).toEqual(['x', 'loop>first'])
  })
})

describe('affinity persistence', () => {
  it('survives a restart and drops expired entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kun-affinity-'))
    try {
      const file = join(dir, 'affinity.json')
      let now = 1_000
      const routed = pool({ affinity: { mode: 'session', ttlMs: 60_000 } })
      const first = new RouteAffinity(() => now)
      first.persistTo(file)
      first.committed(routed, request('x'), routed.targets[1]!)
      first.flush()
      expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(1)
      const restarted = new RouteAffinity(() => now)
      restarted.persistTo(file)
      expect(restarted.prefer(routed, request('x'), routed.targets).map((target) => target.id)[0]).toBe('strong')
      now = 120_000
      const expired = new RouteAffinity(() => now)
      expired.persistTo(file)
      expect(expired.size()).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('pace account strategy', () => {
  it('prefers the account with the most allowance left per hour until reset', async () => {
    const { orderFailoverGroupTargets, createFailoverGroupRouteState } = await import('./route-pool-failover-groups.js')
    const member = (providerId: string) => ({ id: `member:${providerId}`, providerId, modelId: 'm', enabled: true, weight: 1 })
    const pace: Record<string, number | undefined> = { a: 5, b: 40, c: undefined }
    const ordered = orderFailoverGroupTargets({
      group: { providerId: 'a', strategy: 'pace', fallbackTargets: [], members: [] },
      request: { threadId: 't', model: 'm' }, members: [member('c'), member('a'), member('b')], fallbacks: [],
      usedPercent: () => undefined, pace: (providerId) => pace[providerId], state: createFailoverGroupRouteState(), now: 0
    })
    expect(ordered.map((target) => target.providerId)).toEqual(['b', 'a', 'c'])
  })
})

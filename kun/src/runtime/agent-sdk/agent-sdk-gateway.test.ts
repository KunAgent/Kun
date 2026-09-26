import { describe, expect, test, vi } from 'vitest'
import { AgentSdkGatewayUnavailableError, AgentSdkRuntime } from './agent-sdk-runtime.js'
import { createAgentSdkRuntime } from './agent-sdk-runtime-factory.js'
import { resolveAgentSdkGatewayEnv } from './agent-sdk-gateway.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import { BUILTIN_HARNESSES } from '../../harness/builtin-harnesses.js'
import type { HarnessRoute } from '../../contracts/harness.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { SdkMessage } from './sdk-protocol.js'
import type { SdkRuntimeDeps, SdkTurnContext } from './agent-sdk-runtime-contracts.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

const GATEWAY_DEF = BUILTIN_HARNESSES.find((def) => def.id === 'claude-code')!
if (!GATEWAY_DEF.gateway) throw new Error('claude-code builtin must declare the gateway surface')

function gatewayCatalog() {
  return { get: (id: string) => (id === 'claude-code' ? GATEWAY_DEF : undefined) }
}

describe('resolveAgentSdkGatewayEnv', () => {
  const tokens = () => new HarnessTokenService()

  test('issues a gateway-scoped grant addressed as kun/<provider>/<model>', () => {
    const service = tokens()
    const env = resolveAgentSdkGatewayEnv({
      deps: {
        tokens: service,
        baseUrl: () => 'http://127.0.0.1:18899',
        roles: () => undefined,
        gateway: () => GATEWAY_DEF.gateway
      },
      threadId: 'th',
      harnessId: 'claude-code',
      providerId: 'anthropic-sub',
      model: 'claude-sonnet-4-6'
    })
    expect(env.baseUrl).toBe('http://127.0.0.1:18899')
    expect(env.model).toBe('kun/anthropic-sub/claude-sonnet-4-6')
    expect(env.env.baseUrl).toBe('ANTHROPIC_BASE_URL')
    expect(env.env.token).toBe('ANTHROPIC_AUTH_TOKEN')
    expect(env.stripEnv).toContain('ANTHROPIC_API_KEY')

    const grant = service.verifyScope(env.token, 'gateway')
    expect(grant).not.toBeNull()
    expect(grant?.threadId).toBe('th')
    expect(grant?.harnessId).toBe('claude-code')
    expect(grant?.routes).toEqual([
      { providerId: 'anthropic-sub', model: 'claude-sonnet-4-6', role: 'main' }
    ])
    // The grant is gateway-scoped only: it cannot cross into Kun tools.
    expect(service.verifyScope(env.token, 'kun-tools')).toBeNull()
  })

  test('adds the roles small model as a second route when it differs', () => {
    const service = tokens()
    const env = resolveAgentSdkGatewayEnv({
      deps: {
        tokens: service,
        baseUrl: () => 'http://127.0.0.1:18899',
        roles: () => ({ smallModelProviderId: 'fast', smallModel: 'mini-1' }),
        gateway: () => GATEWAY_DEF.gateway
      },
      threadId: 'th',
      harnessId: 'claude-code',
      providerId: 'anthropic-sub',
      model: 'claude-sonnet-4-6'
    })
    expect(env.smallModel).toBe('kun/fast/mini-1')
    const grant = service.verifyScope(env.token, 'gateway')
    expect(grant?.routes).toHaveLength(2)
    expect(grant?.routes[1]).toEqual({ providerId: 'fast', model: 'mini-1', role: 'small' })
  })

  test('reissue with a different model produces a different token bound to its own routes', () => {
    const service = tokens()
    const first = resolveAgentSdkGatewayEnv({
      deps: { tokens: service, baseUrl: () => 'http://x', gateway: () => GATEWAY_DEF.gateway },
      threadId: 'th', harnessId: 'claude-code', providerId: 'p', model: 'm1'
    })
    const second = resolveAgentSdkGatewayEnv({
      deps: { tokens: service, baseUrl: () => 'http://x', gateway: () => GATEWAY_DEF.gateway },
      threadId: 'th', harnessId: 'claude-code', providerId: 'p', model: 'm2'
    })
    expect(first.token).not.toBe(second.token)
    expect(service.verifyScope(first.token, 'gateway')?.routes[0]?.model).toBe('m1')
  })

  test('fails closed when the endpoint, token service, or gateway surface is absent', () => {
    const base = {
      threadId: 'th',
      harnessId: 'claude-code' as const,
      providerId: 'p',
      model: 'm'
    }
    expect(() => resolveAgentSdkGatewayEnv({
      deps: { tokens: tokens(), baseUrl: () => undefined, gateway: () => GATEWAY_DEF.gateway },
      ...base
    })).toThrow(AgentSdkGatewayUnavailableError)
    expect(() => resolveAgentSdkGatewayEnv({
      deps: { baseUrl: () => 'http://x', gateway: () => GATEWAY_DEF.gateway },
      ...base
    })).toThrow(AgentSdkGatewayUnavailableError)
    expect(() => resolveAgentSdkGatewayEnv({
      deps: { tokens: tokens(), baseUrl: () => 'http://x', gateway: () => undefined },
      ...base
    })).toThrow(/declares no gateway surface/)
  })
})

function threadWith(partial: Partial<ThreadRecord>): ThreadRecord {
  return {
    id: 'th',
    title: 't',
    workspace: '/ws',
    model: 'kun/anthropic-sub/claude-sonnet-4-6',
    providerId: 'anthropic-sub',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    relation: 'primary',
    createdAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:00:00Z',
    turns: [],
    ...partial
  } as ThreadRecord
}

function factoryDeps(overrides: Record<string, unknown> = {}) {
  const userItem = {
    id: 'item_tn',
    turnId: 'tn',
    threadId: 'th',
    kind: 'user_message',
    role: 'user',
    status: 'completed',
    text: 'work',
    createdAt: '2026-06-27T00:00:00Z'
  }
  return {
    registry: CapabilityRegistry.fromLocalTools([]),
    turns: { updateTurnMetadata: async () => undefined } as never,
    sessionStore: { loadItems: async () => [userItem] } as never,
    threadStore: { get: async () => threadWith({}) } as never,
    events: {} as never,
    ids: { next: (prefix: string) => prefix },
    prefix: { systemPrompt: 'Kun system prompt' },
    providerConfigs: {} as never,
    agentSdkProviderIds: new Set(['anthropic-sub']),
    defaultApprovalPolicy: 'auto' as const,
    harnessTokens: new HarnessTokenService(),
    harnessGatewayBaseUrl: () => 'http://127.0.0.1:18899',
    harnessCatalog: gatewayCatalog(),
    ...overrides
  }
}

describe('kun-gateway loadTurnContext', () => {
  function gatewayTurn(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tn',
      prompt: 'work',
      credentialMode: 'kun-gateway',
      harnessId: 'claude-code',
      model: 'kun/anthropic-sub/claude-sonnet-4-6',
      providerId: 'anthropic-sub',
      ...overrides
    } as ThreadRecord['turns'][number]
  }

  async function contextOf(runtime: unknown, threadId = 'th', turnId = 'tn') {
    return (runtime as { deps: { loadTurnContext(t: string, u: string): Promise<SdkTurnContext | null> } })
      .deps.loadTurnContext(threadId, turnId)
  }

  test('binds a scoped gateway grant and skips provider credential resolution', async () => {
    const thread = threadWith({ turns: [gatewayTurn()] })
    const tokens = new HarnessTokenService()
    const resolveCredentialSource = vi.fn(async () => {
      throw new Error('provider credentials must not be read in gateway mode')
    })
    const runtime = createAgentSdkRuntime(factoryDeps({
      threadStore: { get: async () => thread } as never,
      harnessTokens: tokens,
      resolveCredentialSource
    }))
    const ctx = await contextOf(runtime)
    expect(ctx?.gateway).toBeDefined()
    expect(ctx?.oauthToken).toBeUndefined()
    expect(ctx?.model).toBe('kun/anthropic-sub/claude-sonnet-4-6')
    expect(resolveCredentialSource).not.toHaveBeenCalled()

    const grant = tokens.verifyScope(ctx!.gateway!.token, 'gateway')
    expect(grant?.routes).toEqual([
      { providerId: 'anthropic-sub', model: 'claude-sonnet-4-6', role: 'main' }
    ])
    // The grant token is registered for request-value redaction.
    expect(ctx?.redactedRequestValues).toContain(ctx?.gateway?.token)
  })

  test('fails clearly when no serve endpoint is listening', async () => {
    const thread = threadWith({ turns: [gatewayTurn()] })
    const runtime = createAgentSdkRuntime(factoryDeps({
      threadStore: { get: async () => thread } as never,
      harnessGatewayBaseUrl: () => undefined
    }))
    await expect(contextOf(runtime)).rejects.toThrow(AgentSdkGatewayUnavailableError)
  })

  test('fails clearly when the turn carries no resolvable route', async () => {
    const thread = threadWith({
      model: undefined,
      providerId: undefined,
      turns: [gatewayTurn({ model: undefined, providerId: undefined })]
    })
    const runtime = createAgentSdkRuntime(factoryDeps({
      threadStore: { get: async () => thread } as never
    }))
    await expect(contextOf(runtime)).rejects.toThrow(/no provider\/model route/)
  })
})

describe('AgentSdkRuntime gateway routing', () => {
  const runtime = new AgentSdkRuntime({
    handlesProvider: () => true
  } as unknown as SdkRuntimeDeps)

  test('handlesRoute owns claude-code native-login and kun-gateway routes', () => {
    const route = (credentialMode: string, harnessId = 'claude-code'): HarnessRoute =>
      ({ harnessId, credentialMode, providerId: 'anthropic-sub' }) as HarnessRoute
    expect(runtime.handlesRoute(route('native-login'))).toBe(true)
    expect(runtime.handlesRoute(route('kun-gateway'))).toBe(true)
    expect(runtime.handlesRoute(route('provider'))).toBe(false)
    expect(runtime.handlesRoute(route('kun-gateway', 'cursor'))).toBe(false)
  })
})

describe('AgentSdkRuntime gateway env + usage suppression', () => {
  function gatewayContext(): SdkTurnContext {
    return {
      workspace: '/ws',
      userText: 'hi',
      approvalPolicy: 'auto',
      model: 'kun/anthropic-sub/claude-sonnet-4-6',
      gateway: {
        baseUrl: 'http://127.0.0.1:18899',
        token: 'kgw_secret.grant',
        model: 'kun/anthropic-sub/claude-sonnet-4-6',
        env: { baseUrl: 'ANTHROPIC_BASE_URL', token: 'ANTHROPIC_AUTH_TOKEN', model: 'ANTHROPIC_MODEL' },
        stripEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']
      },
      bridgeableTools: []
    }
  }

  const STREAM: SdkMessage[] = [
    { type: 'system', subtype: 'init', session_id: 'sess_gw' } as SdkMessage,
    {
      type: 'result', subtype: 'success', is_error: false, result: 'ok',
      num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 }
    } as SdkMessage
  ]

  function fakeSdk(messages: SdkMessage[], onQuery?: (opts: unknown) => void) {
    const query = (input: { options?: unknown }) => {
      onQuery?.(input.options)
      return (async function* () {
        for (const message of messages) yield message
      })() as never
    }
    return { query } as never
  }

  function deps(overrides: Partial<SdkRuntimeDeps>) {
    const events: RuntimeEventDraft[] = []
    const d: SdkRuntimeDeps = {
      handlesProvider: () => true,
      loadTurnContext: async () => gatewayContext(),
      executeKunTool: async () => ({ output: 'ok' }),
      decideToolApproval: async () => ({ allow: true }),
      recordEvent: async (draft) => { events.push(draft) },
      applyItem: async () => undefined,
      applyAssistantDelta: async () => undefined,
      finishTurn: async () => undefined,
      saveSessionId: async () => undefined,
      loadSdk: async () => fakeSdk(STREAM),
      baseEnv: () => ({ PATH: '/bin', ANTHROPIC_API_KEY: 'leak', CLAUDE_CODE_OAUTH_TOKEN: 'leak2' }),
      kunSystemPrompt: () => 'kun',
      nextId: (p: string) => p,
      ...overrides
    }
    return { d, events }
  }

  test('injects gateway env, strips provider credentials, and keeps tokens off argv', async () => {
    let options: { env?: Record<string, string | undefined>; args?: unknown } = {}
    const sdk = fakeSdk(STREAM, (value) => { options = value as typeof options })
    const { d } = deps({ loadSdk: async () => sdk })
    await expect(new AgentSdkRuntime(d).runTurn('th', 'tn', new AbortController().signal))
      .resolves.toBe('completed')
    expect(options.env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:18899')
    expect(options.env?.ANTHROPIC_AUTH_TOKEN).toBe('kgw_secret.grant')
    expect(options.env?.ANTHROPIC_MODEL).toBe('kun/anthropic-sub/claude-sonnet-4-6')
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('suppresses SDK usage drafts because the gateway already attributed usage', async () => {
    const { d, events } = deps({})
    await expect(new AgentSdkRuntime(d).runTurn('th', 'tn', new AbortController().signal))
      .resolves.toBe('completed')
    expect(events.some((event) => event.kind === 'usage')).toBe(false)
  })

  test('native-login turns still record SDK usage drafts', async () => {
    const { d, events } = deps({
      loadTurnContext: async () => ({
        workspace: '/ws', userText: 'hi', approvalPolicy: 'auto', bridgeableTools: []
      })
    })
    await expect(new AgentSdkRuntime(d).runTurn('th', 'tn', new AbortController().signal))
      .resolves.toBe('completed')
    expect(events.some((event) => event.kind === 'usage')).toBe(true)
  })
})

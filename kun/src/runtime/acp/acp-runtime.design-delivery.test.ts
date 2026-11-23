import { describe, expect, test } from 'vitest'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import type { DelegatedSteering } from '../../services/delegated-steering.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import { KunToolsMcpProvider } from './kun-tools-mcp.js'
import type { AcpDesignDeliveryHost } from './acp-design-delivery.js'
import type { AcpRuntimeDeps } from './acp-runtime.js'
import { makeHarness, type Harness } from '../../../tests/helpers/acp-runtime-test-support.js'

const NOTEBOOK_PROMPT = '这个notebook的ui设计和功能位置规划ui用设计稿重新设计一下'
const RECOVERY_PROMPT = 'no successful design_open result'

type DesignDeps = Partial<AcpRuntimeDeps> & {
  designDelivery: AcpDesignDeliveryHost
}

type DesignBridge = AcpDesignDeliveryHost['bridge'] & {
  calls: Array<{ threadId: string; turnId: string }>
  releases: Array<{ threadId: string; turnId: string }>
}

type DesignBus = AcpDesignDeliveryHost['events'] & {
  publish(event: RuntimeEvent): void
  subscriberCount(threadId?: string): number
}

function designBridge(advertise = true): DesignBridge {
  const calls: DesignBridge['calls'] = []
  const releases: DesignBridge['releases'] = []
  return {
    async listTools(threadId: string, turnId: string) {
      calls.push({ threadId, turnId })
      return advertise
        ? [{
            name: 'design_open',
            description: 'Publish a design board on the Kun Design canvas',
            inputSchema: { type: 'object' },
            toolKind: 'file_change'
          }]
        : []
    },
    releaseTurn(threadId: string, turnId: string) {
      releases.push({ threadId, turnId })
    },
    calls,
    releases
  } as unknown as DesignBridge
}

function designBus(): DesignBus {
  const handlers = new Map<string, Set<(event: RuntimeEvent) => void>>()
  return {
    subscribe(threadId, handler) {
      const set = handlers.get(threadId) ?? new Set<(event: RuntimeEvent) => void>()
      set.add(handler)
      handlers.set(threadId, set)
      return () => {
        set.delete(handler)
        if (set.size === 0) handlers.delete(threadId)
      }
    },
    publish(event) {
      for (const handler of [...(handlers.get(event.threadId) ?? [])]) handler(event)
    },
    subscriberCount(threadId) {
      if (threadId) return handlers.get(threadId)?.size ?? 0
      return [...handlers.values()].reduce((count, set) => count + set.size, 0)
    }
  }
}

/** A serve-hosted descriptor with a fake endpoint: no MCP server is contacted. */
function kunToolsProvider(): KunToolsMcpProvider {
  return new KunToolsMcpProvider({
    tokens: new HarnessTokenService({ secret: Buffer.alloc(32, 7) }),
    endpoint: () => 'http://127.0.0.1:18899',
    command: () => ({ command: '/fake/kun', args: ['serve'] })
  })
}

function userItem(text: string): TurnItem {
  return {
    id: 'item_turn_1_user',
    threadId: 'thread_1',
    turnId: 'turn_1',
    role: 'user',
    kind: 'user_message',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    text
  } as TurnItem
}

function readyBoard(overrides: Record<string, unknown> = {}): TurnItem {
  return {
    id: 'item_design_ready',
    threadId: 'thread_1',
    turnId: 'turn_1',
    role: 'tool',
    kind: 'tool_result',
    status: 'completed',
    createdAt: '2026-01-01T00:00:01.000Z',
    toolName: 'design_open',
    callId: 'call_design_open',
    toolKind: 'file_change',
    isError: false,
    output: {
      ok: true,
      status: 'ready',
      designRequest: {
        status: 'ready',
        documentId: 'doc_notebook',
        screens: [{
          artifactId: 'screen_home',
          name: 'Notebook home',
          relativePath: '.kun-design/doc_notebook/screen_home/v1.html',
          width: 1280,
          height: 800
        }]
      }
    },
    ...overrides
  } as TurnItem
}

function readyEvent(item: TurnItem = readyBoard()): RuntimeEvent {
  return {
    kind: 'item_created',
    seq: 1,
    timestamp: '2026-01-01T00:00:01.000Z',
    threadId: item.threadId,
    turnId: item.turnId,
    item
  } as RuntimeEvent
}

function deniedDesignApprovalEvent(): RuntimeEvent {
  return {
    kind: 'approval_resolved',
    seq: 2,
    timestamp: '2026-01-01T00:00:02.000Z',
    threadId: 'thread_1',
    turnId: 'turn_1',
    approvalId: 'approval_design_open',
    toolName: 'design_open',
    status: 'denied'
  } as RuntimeEvent
}

function chatTurn(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    steps: [{
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text }
      }
    }],
    response: { stopReason: 'end_turn' },
    ...extra
  }
}

function designScenario(turns: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    sessionId: 'sess-design',
    initialize: {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: true }
      },
      authMethods: []
    },
    turns
  }
}

async function makeDesignHarness(input: {
  scenario: Record<string, unknown>
  bridge?: DesignBridge
  bus?: DesignBus
  prompt?: string
  turn?: Record<string, unknown>
  onDelta?: () => void
  steering?: DelegatedSteering
}): Promise<{ h: Harness; bridge: DesignBridge; bus: DesignBus }> {
  const bridge = input.bridge ?? designBridge()
  const bus = input.bus ?? designBus()
  const deps: DesignDeps = {
    designDelivery: { bridge, events: bus },
    kunToolsMcp: kunToolsProvider()
  }
  const h = await makeHarness(input.scenario, {
    deps,
    turn: { clientSurface: 'gui', agentSurface: 'code', ...input.turn },
    items: [userItem(input.prompt ?? NOTEBOOK_PROMPT)],
    ...(input.steering ? { turns: { openDelegatedSteering: () => input.steering } } : {}),
    ...(input.onDelta ? { onDelta: input.onDelta } : {})
  })
  return { h, bridge, bus }
}

function promptTexts(h: Harness): string[] {
  return h.requests('session/prompt').map((request) => {
    const blocks = (request.params?.prompt ?? []) as Array<{ type?: string; text?: string }>
    return blocks.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
  })
}

function sessionIds(h: Harness): unknown[] {
  return h.requests('session/prompt').map((request) => request.params?.sessionId)
}

function run(h: Harness, signal = new AbortController().signal) {
  return h.runtime.runTurn('thread_1', 'turn_1', signal)
}

describe('AcpRuntime design delivery', () => {
  test('the real notebook redesign prompt publishes in one turn when the host returns a ready board', async () => {
    const bus = designBus()
    const { h, bridge } = await makeDesignHarness({
      scenario: designScenario([chatTurn('Notebook redesign is ready.')]),
      bus,
      onDelta: () => bus.publish(readyEvent())
    })

    expect(await run(h)).toBe('completed')
    const prompts = promptTexts(h)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('design_open')
    expect(prompts[0]).toContain('Kun Design canvas')
    expect(sessionIds(h)).toEqual(['sess-design'])
    expect(bridge.calls[0]).toEqual({ threadId: 'thread_1', turnId: 'turn_1' })
    expect(bridge.releases).toEqual([{ threadId: 'thread_1', turnId: 'turn_1' }])
    expect(bus.subscriberCount()).toBe(0)
    expect(h.finished).toHaveLength(1)
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
  })

  test('a resumed session gets the delivery instruction for each new design request', async () => {
    const bus = designBus()
    let activeTurn = 'turn_1'
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('First board.'), chatTurn('Second board.')]),
      bus, onDelta: () => bus.publish(readyEvent(readyBoard({ turnId: activeTurn })))
    })
    expect(await run(h)).toBe('completed')
    activeTurn = 'turn_2'
    h.thread.turns.push({ ...h.thread.turns[0], id: activeTurn })
    h.items.push({ ...userItem('再给我生成设置页面的设计稿'), id: 'user_2', turnId: activeTurn })
    expect(await h.runtime.runTurn('thread_1', activeTurn, new AbortController().signal)).toBe('completed')
    expect(h.requests('session/new')).toHaveLength(1)
    expect(promptTexts(h)).toEqual([expect.stringContaining('Kun Design canvas'), expect.stringContaining('Kun Design canvas')])
  })

  test('ACP text or HTML is not a delivery; one same-session recovery prompt can publish', async () => {
    const bus = designBus()
    let deltas = 0
    const { h } = await makeDesignHarness({
      scenario: designScenario([
        chatTurn('<html><body><h1>Notebook UI</h1></body></html>', {
          response: {
            stopReason: 'end_turn',
            usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
          }
        }),
        chatTurn('Published the notebook boards now.', {
          promptIncludes: RECOVERY_PROMPT,
          response: {
            stopReason: 'end_turn',
            usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 }
          }
        })
      ]),
      bus,
      onDelta: () => {
        deltas += 1
        if (deltas === 2) bus.publish(readyEvent())
      }
    })

    expect(await run(h)).toBe('completed')
    const prompts = promptTexts(h)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('design_open')
    expect(prompts[1]).toContain(RECOVERY_PROMPT)
    expect(sessionIds(h)).toEqual(['sess-design', 'sess-design'])
    expect(h.requests('session/new')).toHaveLength(1)
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
    const usage = h.recorded.filter((event) => event.kind === 'usage')
    expect(usage).toHaveLength(2)
    expect(usage.map((event) => event.kind === 'usage' && event.usage.completionTokens).sort())
      .toEqual([10, 20])
  })

  test('fails explicitly after one recovery prompt when no ready board ever arrives', async () => {
    const { h, bridge } = await makeDesignHarness({
      scenario: designScenario([
        chatTurn('Done. The HTML is in notebook.html.'),
        chatTurn('It is already finished.', { promptIncludes: RECOVERY_PROMPT })
      ])
    })

    expect(await run(h)).toBe('failed')
    expect(promptTexts(h)).toHaveLength(2)
    expect(sessionIds(h)).toEqual(['sess-design', 'sess-design'])
    expect(h.finished).toHaveLength(1)
    expect(h.finished[0]).toMatchObject({ status: 'failed', code: 'agent_error' })
    expect(h.finished[0]?.error).toContain('design_open')
    expect(bridge.releases).toHaveLength(1)
  })

  test('retains the original usage when the recovery request fails', async () => {
    const { h } = await makeDesignHarness({
      scenario: designScenario([
        chatTurn('Prepared the HTML.', { response: { stopReason: 'end_turn', usage: { inputTokens: 30, outputTokens: 7, totalTokens: 37 } } }),
        { promptIncludes: RECOVERY_PROMPT, error: { code: -32603, message: 'Engine could not finish the follow-up.' } }
      ])
    })
    expect(await run(h)).toBe('failed')
    expect(promptTexts(h)).toHaveLength(2)
    expect(h.recorded.filter(event => event.kind === 'usage').map(event => event.usage.totalTokens)).toEqual([37])
  })

  test.each([
    ['只给我 HTML，不要再发布画布', 'end_turn', 'completed'],
    ['继续做设计稿', 'refusal', 'failed']
  ])('respects admitted guidance before any recovery: %s', async (text, stopReason, outcome) => {
    let sent = false
    const pending: { text: string }[] = []
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('Preparing...'), chatTurn('Reply to guidance.', { promptIncludes: text, response: { stopReason } })]),
      steering: {
        subscribe: () => () => {},
        take: async () => pending.splice(0),
        sealIfEmpty: () => pending.length === 0
      },
      onDelta: () => {
        if (!sent) { sent = true; pending.push({ text }) }
      }
    })
    expect(await run(h)).toBe(outcome)
    expect(promptTexts(h)).toHaveLength(2)
    expect(promptTexts(h)[1]).toContain(text)
    expect(promptTexts(h)[1]).not.toContain(RECOVERY_PROMPT)
    if (stopReason === 'refusal') expect(h.finished[0]?.code).toBe('harness_refusal')
  })

  test('an ACP tool result that claims design_open is not a canvas receipt', async () => {
    const { h } = await makeDesignHarness({
      scenario: designScenario([
        {
          steps: [
            {
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'Mockup complete.' }
              }
            },
            {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'call-acp-design',
                title: 'design_open',
                kind: 'other',
                status: 'in_progress',
                rawInput: { title: 'Notebook', screens: [{ name: 'Home', html: '<html></html>' }] }
              }
            },
            {
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'call-acp-design',
                status: 'completed',
                rawOutput: {
                  ok: true,
                  designRequest: { status: 'ready', documentId: 'doc_acp', screens: [{ name: 'Home' }] }
                }
              }
            }
          ],
          response: { stopReason: 'end_turn' }
        },
        chatTurn('Nothing else to publish.', { promptIncludes: RECOVERY_PROMPT })
      ])
    })

    expect(await run(h)).toBe('failed')
    expect(promptTexts(h)).toHaveLength(2)
    expect(sessionIds(h)).toEqual(['sess-design', 'sess-design'])
    const acpResults = h.items.filter((item) => item.kind === 'tool_result')
    expect(acpResults.length).toBeGreaterThan(0)
    expect(acpResults.every((item) => item.kind === 'tool_result' && item.toolName !== 'design_open')).toBe(true)
    expect(h.finished[0]).toMatchObject({ status: 'failed', code: 'agent_error' })
  })

  test('fails without prompting when the host does not advertise design_open', async () => {
    const bridge = designBridge(false)
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('Should never run.')]),
      bridge
    })

    expect(await run(h)).toBe('failed')
    expect(h.requests('session/prompt')).toHaveLength(0)
    expect(bridge.calls).toEqual([{ threadId: 'thread_1', turnId: 'turn_1' }])
    expect(h.finished[0]).toMatchObject({ status: 'failed', code: 'agent_error' })
    expect(h.finished[0]?.error).toContain('design_open is unavailable')
  })

  test('does not gate a ready board from another turn', async () => {
    const bus = designBus()
    const { h } = await makeDesignHarness({
      scenario: designScenario([
        chatTurn('Notebook UI is ready.'),
        chatTurn('Still nothing to publish.', { promptIncludes: RECOVERY_PROMPT })
      ]),
      bus,
      onDelta: () => bus.publish(readyEvent(readyBoard({ turnId: 'turn_other' })))
    })

    expect(await run(h)).toBe('failed')
    expect(promptTexts(h)).toHaveLength(2)
    expect(h.finished[0]).toMatchObject({ status: 'failed', code: 'agent_error' })
  })

  test('does not force canvas delivery when the user only asks for HTML', async () => {
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('<html><body>Only HTML</body></html>')]),
      prompt: '这个 notebook 只给我 HTML 就行，不用设计稿'
    })

    expect(await run(h)).toBe('completed')
    const prompts = promptTexts(h)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('design_open')
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
  })

  test('does not force canvas delivery when implementing an existing design', async () => {
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('Implemented the existing design in code.')]),
      prompt: '按照已有设计稿改代码，不要重新设计'
    })

    expect(await run(h)).toBe('completed')
    const prompts = promptTexts(h)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('design_open')
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
  })

  test('does not gate a Design-surface turn owned by the design workbench', async () => {
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('Edited the existing design document.')]),
      turn: { agentSurface: 'design' }
    })

    expect(await run(h)).toBe('completed')
    const prompts = promptTexts(h)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('design_open')
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
  })

  test('does not gate a non-GUI client turn', async () => {
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('This request came from the API.')]),
      turn: { clientSurface: 'api' }
    })

    expect(await run(h)).toBe('completed')
    const prompts = promptTexts(h)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('design_open')
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
  })

  test('cancelling a gated design turn aborts without a recovery prompt', async () => {
    const bus = designBus()
    const controller = new AbortController()
    const { h, bridge } = await makeDesignHarness({
      scenario: {
        sessionId: 'sess-design',
        initialize: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false, promptCapabilities: {} },
          authMethods: []
        },
        turns: [{
          steps: [{
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Working on the notebook UI.' }
            }
          }],
          neverRespond: true
        }],
        onCancel: { settle: 'cancelled' }
      },
      bus,
      onDelta: () => controller.abort()
    })

    expect(await run(h, controller.signal)).toBe('aborted')
    expect(promptTexts(h)).toHaveLength(1)
    expect(promptTexts(h)[0]).toContain('design_open')
    expect(h.finished[0]).toMatchObject({ status: 'aborted' })
    expect(bus.subscriberCount()).toBe(0)
    expect(bridge.releases).toHaveLength(1)
  })

  test('a refusal ends the gated design turn without a recovery prompt', async () => {
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('I cannot design that.', { response: { stopReason: 'refusal' } })])
    })

    expect(await run(h)).toBe('failed')
    expect(promptTexts(h)).toHaveLength(1)
    expect(promptTexts(h)[0]).toContain('design_open')
    expect(h.finished[0]).toMatchObject({
      status: 'failed',
      code: 'harness_refusal',
      error: 'The harness refused this turn'
    })
  })

  test('a denied design_open approval is reported as unpublished without requesting permission again', async () => {
    const bus = designBus()
    const { h } = await makeDesignHarness({
      scenario: designScenario([chatTurn('The canvas call was denied by the user.')]),
      bus,
      onDelta: () => bus.publish(deniedDesignApprovalEvent())
    })

    expect(await run(h)).toBe('failed')
    expect(promptTexts(h)).toHaveLength(1)
    expect(h.finished[0]).toMatchObject({ status: 'failed', code: 'policy_denied', error: expect.stringContaining('not published') })
  })

  test('records usage once for a gated design turn that publishes', async () => {
    const bus = designBus()
    const { h } = await makeDesignHarness({
      scenario: designScenario([{
        steps: [{
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Published the notebook boards.' }
          }
        }],
        response: {
          stopReason: 'end_turn',
          usage: { inputTokens: 120, outputTokens: 400, totalTokens: 520 }
        }
      }]),
      bus,
      onDelta: () => bus.publish(readyEvent())
    })

    expect(await run(h)).toBe('completed')
    expect(promptTexts(h)).toHaveLength(1)
    expect(promptTexts(h)[0]).toContain('design_open')
    const usage = h.recorded.filter((event) => event.kind === 'usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ threadId: 'thread_1', turnId: 'turn_1' })
    expect(usage[0]?.kind === 'usage' && usage[0].usage).toMatchObject({
      promptTokens: 120,
      completionTokens: 400,
      totalTokens: 520
    })
  })
})

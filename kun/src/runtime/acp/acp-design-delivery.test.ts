import { describe, expect, test, vi } from 'vitest'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { Turn } from '../../contracts/turns.js'
import { DESIGN_OPEN_TOOL_NAME } from '../../adapters/tool/design-open-tool.js'
import { makeToolResultItem } from '../../domain/item.js'
import { AcpError } from './acp-schema.js'
import {
  acpDesignDelivery,
  classifyDesignIntent,
  type AcpDesignDeliveryHost
} from './acp-design-delivery.js'

const threadId = 'thread_design'
const turnId = 'turn_design'
const NOTEBOOK_PROMPT = '这个notebook的ui设计和功能位置规划ui用设计稿重新设计一下'
const RECOVERY = 'no successful design_open result'

function makeThread(overrides: Record<string, unknown> = {}): ThreadRecord {
  return {
    id: threadId,
    workspace: '/tmp/kun-design-delivery',
    mode: 'agent',
    agentSurface: 'code',
    relation: 'primary',
    ...overrides
  } as unknown as ThreadRecord
}

function makeTurn(overrides: Record<string, unknown> = {}): Turn {
  return {
    id: turnId,
    threadId,
    status: 'running',
    prompt: NOTEBOOK_PROMPT,
    clientSurface: 'gui',
    agentSurface: 'code',
    orchestration: 'direct',
    steering: [],
    items: [],
    attachmentIds: [],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedDirectiveIds: [],
    injectedDirectiveSummaries: [],
    injectedInstructionSources: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as unknown as Turn
}

function board(overrides: Record<string, unknown> = {}): TurnItem {
  return {
    ...makeToolResultItem({
      id: 'item_design_ready',
      threadId,
      turnId,
      callId: 'call_design_open',
      toolName: DESIGN_OPEN_TOOL_NAME,
      output: {
        ok: true,
        status: 'ready',
        designRequest: {
          status: 'ready',
          documentId: 'doc_notebook',
          screens: [{ name: 'Notebook home', html: '<html></html>' }]
        }
      }
    }),
    ...overrides
  } as TurnItem
}

function assistantClaim(): TurnItem {
  return {
    id: 'item_assistant_claim',
    threadId,
    turnId,
    role: 'assistant',
    kind: 'assistant_text',
    status: 'completed',
    createdAt: '2026-01-01T00:00:01.000Z',
    text: 'Published design_open successfully.'
  } as TurnItem
}

function itemEvent(item: TurnItem): RuntimeEvent {
  return {
    kind: 'item_created',
    seq: 1,
    timestamp: '2026-01-01T00:00:01.000Z',
    threadId: item.threadId,
    turnId: item.turnId,
    item
  } as RuntimeEvent
}

function deniedApproval(overrides: Record<string, unknown> = {}): RuntimeEvent {
  return {
    kind: 'approval_resolved',
    seq: 2,
    timestamp: '2026-01-01T00:00:02.000Z',
    threadId,
    turnId,
    approvalId: 'approval_design',
    toolName: DESIGN_OPEN_TOOL_NAME,
    status: 'denied',
    ...overrides
  } as RuntimeEvent
}

function abortedTurn(): RuntimeEvent {
  return {
    kind: 'turn_aborted',
    seq: 3,
    timestamp: '2026-01-01T00:00:03.000Z',
    threadId,
    turnId
  } as RuntimeEvent
}

function makeHost(options: { tools?: string[]; calls?: Array<{ threadId: string; turnId: string }> } = {}) {
  let listener: ((event: RuntimeEvent) => void) | undefined
  const calls = options.calls ?? []
  const unsubscribe = vi.fn()
  const listTools = vi.fn(async (thread: string, turn: string) => {
    calls.push({ threadId: thread, turnId: turn })
    return (options.tools ?? [DESIGN_OPEN_TOOL_NAME]).map((name) => ({ name }))
  })
  const releaseTurn = vi.fn()
  const subscribe = vi.fn((_thread: string, handler: (event: RuntimeEvent) => void) => {
    listener = handler
    return unsubscribe
  })
  const host = {
    bridge: { listTools, releaseTurn },
    events: { subscribe }
  } as unknown as AcpDesignDeliveryHost
  return {
    host,
    calls,
    listTools,
    releaseTurn,
    subscribe,
    unsubscribe,
    publish(event: RuntimeEvent) {
      listener?.(event)
    }
  }
}

function delivery(
  host: AcpDesignDeliveryHost,
  input: {
    thread?: ThreadRecord
    turn?: Turn
    descriptorDelivered?: boolean
    items?: readonly TurnItem[]
  } = {}
) {
  const value = acpDesignDelivery(
    host,
    input.thread ?? makeThread(),
    input.turn ?? makeTurn(),
    input.descriptorDelivered ?? true,
    input.items ?? []
  )
  if (!value) throw new Error('expected a design delivery gate')
  return value
}

describe('classifyDesignIntent', () => {
  test.each([
    ['the notebook redesign prompt', NOTEBOOK_PROMPT, 'required'],
    ['a Chinese page mockup', '帮我生成登录页面的设计稿', 'required'],
    ['a Chinese wireframe', '生成设置页的线框图', 'required'],
    ['a draft without implementation', '只要设置页设计稿，不要改代码', 'required'],
    ['code declined before requesting a draft', '不要改代码，给我生成两版设计稿', 'required'],
    ['sending an existing mockup to the canvas', '不用重新设计。请用 `design_open` 发布刚才那份稿', 'required'],
    ['a polite request to implement from a draft', '给我按已有设计稿改代码', 'declined'],
    ['an explicit file in preference to the canvas', '生成设置页设计稿，但只给我 HTML', 'declined'],
    ['a counted Chinese mockup', '给这个 dashboard 出几张设计稿', 'required'],
    ['an explicit canvas request', '用 Kun 设计画布重新做一下这个页面', 'required'],
    ['an English mockup', 'Create a mockup for the settings page.', 'required'],
    ['English wireframes', 'generate wireframes for onboarding', 'required'],
    ['a pure Chinese redesign', '把设置页面的界面改版一下', 'preferred'],
    ['a page design without a draft noun', '生成登录页设计', 'preferred'],
    ['a page redesign without a draft noun', '登录页改版', 'preferred'],
    ['a pure English redesign', 'Redesign the settings page.', 'preferred'],
    ['a negative canvas request', '不要画布，只要文件', 'declined'],
    ['an only-HTML request', '这个 notebook 只给我 HTML 就行，不用设计稿', 'declined'],
    ['a direct code request', '直接改代码，不要重做页面', 'declined'],
    ['a declined redesign', '不想重新设计这个页面', 'declined'],
    ['implementing an existing design', '按照已有设计稿改代码，不要重新设计', 'declined'],
    ['a design_open debug question', '为什么 design_open 没有生成设计稿？', 'none'],
    ['a diagnostic status line', 'Kun has no successful design_open result for this request.', 'none'],
    ['debugging the design feature', '帮我调试一下设计稿功能', 'none'],
    ['a quoted prior instruction', '之前看到“用设计稿重新设计一下”，现在只改代码', 'declined'],
    ['a single Chinese component', '用设计稿做一个按钮组件', 'declined'],
    ['a single inline component', 'Add just an inline button component.', 'declined'],
    ['an ordinary code question', '解释一下这个仓库的测试命令', 'none']
  ])('%s', (_label, text, expected) => {
    expect(classifyDesignIntent(text)).toBe(expected)
  })

  test('a quoted request is a reference, not a new request', () => {
    expect(classifyDesignIntent('他说“给我生成一个登录页设计稿”，我只想改代码')).toBe('declined')
  })

  test('a page containing a button is not a single-component request', () => {
    expect(classifyDesignIntent('设计一个设置页面，页面里包含一个按钮')).not.toBe('declined')
  })

  test('a named page containing a button is not a single-component request', () => {
    expect(classifyDesignIntent('生成登录页设计，包含一个按钮')).toBe('preferred')
  })
})

describe('acpDesignDelivery', () => {
  test('ordinary conversation never reads the catalog or subscribes', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await expect(d.instructions('解释一下这个仓库的测试命令')).resolves.toBeUndefined()

    expect(h.listTools).not.toHaveBeenCalled()
    expect(h.subscribe).not.toHaveBeenCalled()
    d.close()
    expect(h.releaseTurn).toHaveBeenCalledWith(threadId, turnId)
  })

  test('a required request checks the real catalog once and subscribes once', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    const instructions = await d.instructions(NOTEBOOK_PROMPT)
    expect(instructions).toContain('Kun Design canvas')
    expect(instructions).toContain('design_open')
    expect(h.calls).toEqual([{ threadId, turnId }])
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    expect(h.subscribe).toHaveBeenCalledWith(threadId, expect.any(Function))

    await d.instructions(NOTEBOOK_PROMPT)
    expect(h.listTools).toHaveBeenCalledTimes(1)
  })

  test('a missing design_open descriptor rejects the required request', async () => {
    const h = makeHost({ tools: [] })
    const d = delivery(h.host)

    await expect(d.instructions(NOTEBOOK_PROMPT)).rejects.toMatchObject({
      code: 'agent_error',
      message: expect.stringContaining('design_open is unavailable')
    })

    expect(h.listTools).toHaveBeenCalledTimes(1)
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('a catalog failure is treated as unavailable and cleans up', async () => {
    const h = makeHost()
    h.listTools.mockRejectedValueOnce(new Error('bridge unavailable'))
    const d = delivery(h.host)

    await expect(d.instructions(NOTEBOOK_PROMPT)).rejects.toMatchObject({
      code: 'agent_error',
      message: expect.stringContaining('design_open is unavailable')
    })

    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('an undelivered descriptor never queries the catalog', async () => {
    const h = makeHost()
    const d = delivery(h.host, { descriptorDelivered: false })

    await expect(d.instructions(NOTEBOOK_PROMPT)).rejects.toBeInstanceOf(AcpError)
    expect(h.listTools).not.toHaveBeenCalled()
    expect(h.subscribe).not.toHaveBeenCalled()
  })

  test('a successful design_open result satisfies the gate', async () => {
    const h = makeHost()
    const d = delivery(h.host, { items: [board()] })

    await d.instructions(NOTEBOOK_PROMPT)

    expect(() => d.assertPublished()).not.toThrow()
    expect(d.correction('end_turn', true)).toBeUndefined()
  })

  test('a live successful item satisfies the gate from the event bus', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    h.publish(itemEvent(board()))

    expect(() => d.assertPublished()).not.toThrow()
    expect(d.correction('end_turn', true)).toBeUndefined()
  })

  const nonReceipts: Array<[string, TurnItem]> = [
    ['an errored result', board({ isError: true })],
    ['a failed result', board({ status: 'failed' })],
    ['another tool', board({ toolName: 'write_file' })],
    ['a prior turn', board({ turnId: 'turn_old' })],
    ['another thread', board({ threadId: 'thread_old' })],
    ['an assistant claim', assistantClaim()],
    ['a non-ready output', board({
      output: {
        ok: true,
        status: 'failed',
        designRequest: { status: 'ready', documentId: 'doc_notebook', screens: [{ name: 'Home' }] }
      }
    })],
    ['an empty board set', board({
      output: {
        ok: true,
        status: 'ready',
        designRequest: { status: 'ready', documentId: 'doc_notebook', screens: [] }
      }
    })]
  ]

  for (const [label, item] of nonReceipts) {
    test(`${label} is not a receipt`, async () => {
      const h = makeHost()
      const d = delivery(h.host, { items: [item] })

      await d.instructions(NOTEBOOK_PROMPT)

      expect(() => d.assertPublished()).toThrowError(AcpError)
    })
  }

  test('an event from another thread or turn is not a receipt', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    h.publish(itemEvent(board({ threadId: 'thread_old' })))
    h.publish(itemEvent(board({ turnId: 'turn_old' })))

    expect(() => d.assertPublished()).toThrowError(AcpError)
  })

  test('a denied design_open approval stops the follow-up gate', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    h.publish(deniedApproval())

    expect(d.correction('end_turn', true)).toBeUndefined()
    expect(() => d.assertPublished()).toThrow(expect.objectContaining({ code: 'policy_denied' }))
  })

  test('a cancelled turn stops the follow-up gate and the assertion', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    h.publish(abortedTurn())

    expect(d.correction('end_turn', true)).toBeUndefined()
    expect(() => d.assertPublished()).not.toThrow()
  })

  test('denials for another tool or turn do not suppress the gate', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    h.publish(deniedApproval({ toolName: 'write_file' }))
    h.publish(deniedApproval({ turnId: 'turn_old' }))

    expect(d.correction('end_turn', true)).toContain(RECOVERY)
    expect(() => d.assertPublished()).toThrowError(AcpError)
  })

  test('correction only runs for a normal end_turn with time left', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)

    expect(d.correction('end_turn', true)).toContain(RECOVERY)
    expect(d.correction('cancelled', true)).toBeUndefined()
    expect(d.correction('refusal', true)).toBeUndefined()
    expect(d.correction(undefined, true)).toBeUndefined()
    expect(d.correction('end_turn', false)).toBeUndefined()
  })

  test('a pure redesign is a soft hint, never a gate or subscription', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    const hint = await d.instructions('把设置页面的界面改版一下')

    expect(hint).toBeTruthy()
    expect(hint).not.toContain('Deliver the requested UI mockups')
    expect(hint).not.toContain(RECOVERY)
    expect(h.subscribe).not.toHaveBeenCalled()
    expect(d.correction('end_turn', true)).toBeUndefined()
    expect(() => d.assertPublished()).not.toThrow()
  })

  test('a preferred redesign without design_open returns no hint', async () => {
    const h = makeHost({ tools: [] })
    const d = delivery(h.host)

    await expect(d.instructions('Redesign the settings page.')).resolves.toBeUndefined()
    expect(h.subscribe).not.toHaveBeenCalled()
  })

  test('an explicit opt-out clears an earlier requirement', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    expect(h.subscribe).toHaveBeenCalledTimes(1)

    await expect(d.instructions('不要画布了，只要文件')).resolves.toBeUndefined()

    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    expect(d.correction('end_turn', true)).toBeUndefined()
    expect(() => d.assertPublished()).not.toThrow()
  })

  test('a neutral follow-up keeps the earlier requirement', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    await expect(d.instructions('继续')).resolves.toBeUndefined()

    expect(d.correction('end_turn', true)).toContain(RECOVERY)
    expect(() => d.assertPublished()).toThrowError(AcpError)
  })

  test('a recovery status statement does not cancel the gate', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    await expect(
      d.instructions('Kun has no successful design_open result for this request.')
    ).resolves.toBeUndefined()

    expect(d.correction('end_turn', true)).toContain(RECOVERY)
    expect(() => d.assertPublished()).toThrowError(AcpError)
  })

  test('close unsubscribes and releases the turn exactly once', async () => {
    const h = makeHost()
    const d = delivery(h.host)

    await d.instructions(NOTEBOOK_PROMPT)
    d.close()
    d.close()

    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    expect(h.releaseTurn).toHaveBeenCalledTimes(1)
    expect(h.releaseTurn).toHaveBeenCalledWith(threadId, turnId)
  })
})

describe('scope', () => {
  const excluded: Array<[string, ThreadRecord, Turn]> = [
    ['an API turn', makeThread(), makeTurn({ clientSurface: 'api' })],
    ['a Design-surface turn', makeThread(), makeTurn({ agentSurface: 'design' })],
    ['a plan turn', makeThread(), makeTurn({ mode: 'plan' })],
    ['a graph turn', makeThread(), makeTurn({ orchestration: 'graph' })],
    ['an IM turn', makeThread(), makeTurn({ imContext: true })],
    ['a room thread', makeThread({ roomContext: {} }), makeTurn()],
    ['a delegated worker', makeThread({ executionUnit: {} }), makeTurn()],
    ['a side conversation', makeThread({ relation: 'side' }), makeTurn()],
    ['a Design-mode turn', makeThread(), makeTurn({ guiDesignMode: true })],
    ['an Excalidraw turn', makeThread(), makeTurn({ guiExcalidrawCanvas: true })],
    ['an SVG artifact turn', makeThread(), makeTurn({ guiDesignArtifact: {} })]
  ]

  for (const [label, thread, turn] of excluded) {
    test(`${label} never creates a gate`, () => {
      const h = makeHost()
      expect(acpDesignDelivery(h.host, thread, turn, true, [])).toBeUndefined()
      expect(h.listTools).not.toHaveBeenCalled()
      expect(h.subscribe).not.toHaveBeenCalled()
    })
  }

  test('a missing host is ignored', () => {
    expect(acpDesignDelivery(undefined, makeThread(), makeTurn(), true, [])).toBeUndefined()
  })

  test('a Code canvas turn can still use design_open', () => {
    const h = makeHost()
    expect(acpDesignDelivery(h.host, makeThread(), makeTurn({ guiDesignCanvas: true }), true, [])).toBeDefined()
  })
})



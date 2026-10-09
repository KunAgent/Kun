import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolBlockFromItem } from '../../agent/kun-mapper-tools'
import { externalSubagentSourceForThread } from '../../agent/external-subagent'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { isSubagentBlock } from './message-timeline-process-grouping'
import { SubagentCallCard } from './SubagentCallCard'

const selectThread = vi.fn(async () => undefined)

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: { selectThread: typeof selectThread }) => unknown) => selector({ selectThread })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options
      const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
    }
  })
}))

function agentItem(presentation: Record<string, unknown>, kind: 'tool_call' | 'tool_result' = 'tool_call'): CoreTurnItemJson {
  return {
    id: kind === 'tool_call' ? 'item_tool_t1_toolu_1' : 'item_toolresult_t1_toolu_1',
    kind,
    threadId: 'thr_parent',
    turnId: 't1',
    callId: 'toolu_1',
    toolName: 'Agent',
    toolKind: 'tool_call',
    status: kind === 'tool_call' ? 'running' : 'completed',
    ...(kind === 'tool_call'
      ? { arguments: { description: 'Trace SSE replay', prompt: 'Read', subagent_type: 'Explore' } }
      : { output: 'done', isError: false }),
    meta: {
      externalSubagent: {
        version: 1,
        source: 'claude-code',
        childThreadId: 'xsub_0123456789abcdef01234567',
        profile: 'Explore',
        label: 'Trace SSE replay',
        model: 'claude-haiku-4-5',
        status: 'running',
        steps: 3,
        activity: 'Read kun/src/server/routes/events.ts',
        ...presentation
      }
    }
  } as unknown as CoreTurnItemJson
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
}

describe('external subagent card', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    selectThread.mockClear()
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
  })

  it('maps the presentation onto child metadata the timeline treats as a subagent', () => {
    const block = toolBlockFromItem(agentItem({}))
    expect(isSubagentBlock(block)).toBe(true)
    expect(block.meta?.child).toMatchObject({
      parentThreadId: 'thr_parent',
      parentTurnId: 't1',
      childId: 'xsub_0123456789abcdef01234567',
      childProfile: 'Explore',
      childStatus: 'running',
      toolInvocations: 3
    })
  })

  it('shows the Agent that ran it, its live step, and opens the side thread', async () => {
    await act(async () => {
      renderer = create(createElement(SubagentCallCard, { block: toolBlockFromItem(agentItem({})) }))
    })
    const metadata = renderer!.root.findByProps({ 'data-testid': 'subagent-route-metadata' })
    expect(text(metadata)).toContain('Explore · Claude Code')
    expect(text(metadata)).toContain('claude-haiku-4-5')
    expect(text(renderer!.root)).toContain('Read kun/src/server/routes/events.ts')
    expect(renderer!.root.findAllByProps({ 'data-testid': 'subagent-stop-button' })).toHaveLength(0)
    const open = renderer!.root.findByProps({ 'data-testid': 'explore-open-process-button' })
    await act(async () => open.props.onClick({ stopPropagation: () => undefined }))
    expect(selectThread).toHaveBeenCalledWith('xsub_0123456789abcdef01234567')
    expect(externalSubagentSourceForThread('xsub_0123456789abcdef01234567')).toBe('claude-code')
  })

  it('explains why a subagent ended without a result', async () => {
    await act(async () => {
      renderer = create(createElement(SubagentCallCard, {
        block: toolBlockFromItem(agentItem({ status: 'aborted', endedWithTurn: true }, 'tool_result'))
      }))
    })
    expect(text(renderer!.root.findByProps({ 'data-testid': 'external-subagent-notice' })))
      .toContain('The turn ended before it finished')
  })

  it('hides open and preview when the Agent shares no steps', async () => {
    await act(async () => {
      renderer = create(createElement(SubagentCallCard, {
        block: toolBlockFromItem(agentItem({ childThreadId: undefined, source: 'opencode2' }))
      }))
    })
    expect(renderer!.root.findAllByProps({ 'data-testid': 'explore-open-process-button' })).toHaveLength(0)
    expect(text(renderer!.root)).toContain('OpenCode2 does not share this subagent’s steps')
  })
})

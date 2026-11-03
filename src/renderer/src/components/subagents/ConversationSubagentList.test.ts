import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolBlockFromItem } from '../../agent/kun-mapper-tools'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import type { ChatBlock } from '../../agent/types'
import { ConversationSubagentList } from './ConversationSubagentList'

const selectThread = vi.fn(async () => undefined)
let blocks: ChatBlock[] = []

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: { blocks: ChatBlock[]; selectThread: typeof selectThread }) => unknown) =>
    selector({ blocks, selectThread })
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

function subagent(id: string, status: string, label: string): ChatBlock {
  return toolBlockFromItem({
    id, kind: 'tool_call', threadId: 'thr_parent', turnId: 't1', callId: id, toolName: 'spawn_agent',
    toolKind: 'tool_call', status: 'running', arguments: {},
    meta: { externalSubagent: { version: 1, source: 'codex', childThreadId: `xsub_${id.padEnd(24, '0')}`, profile: 'explorer', label, model: 'gpt-6.1-sol', status } }
  } as unknown as CoreTurnItemJson)
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
}

describe('ConversationSubagentList', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    selectThread.mockClear()
  })
  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    blocks = []
  })

  it('renders nothing when the chat has no subagents', async () => {
    await act(async () => { renderer = create(createElement(ConversationSubagentList)) })
    expect(renderer!.toJSON()).toBeNull()
  })

  it('lists running subagents first and opens a subagent session', async () => {
    blocks = [subagent('aaa', 'completed', 'Research replay'), subagent('bbb', 'running', 'Trace events')]
    await act(async () => { renderer = create(createElement(ConversationSubagentList)) })
    const rows = renderer!.root.findAllByProps({ 'data-testid': 'conversation-subagent-row' })
    expect(rows.map((row) => text(row))).toEqual([
      expect.stringContaining('Trace events'),
      expect.stringContaining('Research replay')
    ])
    expect(text(rows[0]!)).toContain('explorer · Codex · gpt-6.1-sol')
    expect(text(renderer!.root)).toContain('come from Codex')
    await act(async () => rows[0]!.props.onClick())
    expect(selectThread).toHaveBeenCalledWith('xsub_bbb000000000000000000000')
  })
})

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import { SubagentCallCard } from './SubagentCallCard'

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    selectThread: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => true),
    busy: true
  })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
  })
}))

describe('SubagentCallCard attempt timing', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
  })

  it('times a resumed running child from the current attempt instead of the old wrapper', async () => {
    const attemptStartedAt = '2026-08-28T10:00:00.000Z'
    await render(childBlock('running', {
      attemptStartedAt,
      durationMs: 3_600_000
    }), Date.parse(attemptStartedAt) + 30_000)

    expect(instanceText(renderer!.root)).toContain('0:30')
    expect(instanceText(renderer!.root)).not.toContain('60:00')
  })

  it('uses terminal attempt duration before cumulative child duration', async () => {
    await render(childBlock('completed', {
      attemptDurationMs: 30_000,
      durationMs: 3_600_000
    }))

    expect(instanceText(renderer!.root)).toContain('0:30')
    expect(instanceText(renderer!.root)).not.toContain('60:00')
  })

  async function render(block: ToolBlock, tickNow?: number): Promise<void> {
    await act(async () => {
      renderer = create(createElement(SubagentCallCard, { block, tickNow }))
    })
  }
})

function childBlock(
  childStatus: 'running' | 'completed',
  timing: { attemptStartedAt?: string; attemptDurationMs?: number; durationMs: number }
): ToolBlock {
  const status = childStatus === 'running' ? 'running' : 'success'
  return {
    kind: 'tool', id: 'tool_resume', turnId: 'turn_resume',
    createdAt: '2026-07-22T00:00:00.000Z', summary: 'Resume deck', status,
    detail: JSON.stringify({ childId: 'child_resume', status: childStatus, ...timing }),
    meta: {
      toolName: 'ppt_agent',
      child: {
        parentThreadId: 'thread_parent', parentTurnId: 'turn_resume', childId: 'child_resume',
        childStatus, childSeq: 1, ...timing
      }
    }
  }
}

function instanceText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => typeof child === 'string' ? child : instanceText(child))
    .join('')
}

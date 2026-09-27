import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'

const providerHolder: { value: Record<string, unknown> } = { value: {} }
vi.mock('../../agent/registry', () => ({
  getProvider: () => providerHolder.value
}))

import { ChangeRequestPanel } from './ChangeRequestPanel'

const binding = (over: Partial<TaskWorkspaceRecord> = {}): TaskWorkspaceRecord => ({
  workspaceId: 'tws_cr00001',
  ownerThreadId: 'thr_m',
  unitId: 'thr_w1',
  isolation: 'worktree',
  sourceRoot: '/repo',
  path: '/repo/.worktrees/tws_cr00001',
  startFrom: { kind: 'default-branch' },
  branch: 'kun/task-x',
  state: 'captured',
  changedFiles: [],
  createdAt: 't',
  updatedAt: 't',
  ...over
} as TaskWorkspaceRecord)

const snapshot = {
  provider: 'github' as const,
  number: 34,
  url: 'https://github.com/org/repo/pull/34',
  title: 'Add ledger',
  state: 'open' as const,
  checks: [
    { name: 'unit', status: 'completed' as const, conclusion: 'failure', detailsUrl: 'https://ci/1', durationMs: 61_000 },
    { name: 'lint', status: 'completed' as const, conclusion: 'success' }
  ],
  checkedAt: 't'
}

async function renderPanel(record = binding()): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(ChangeRequestPanel, { binding: record }))
  })
  return renderer
}

const buttons = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType('button' as never)

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return ''
}

const buttonText = (b: { props: { children?: unknown } }): string =>
  textOf(b.props.children)

beforeEach(() => {
  providerHolder.value = {}
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ChangeRequestPanel', () => {
  it('shows the unavailable reason and disables create when gh is not authed', async () => {
    providerHolder.value = {
      getChangeRequest: async () => ({
        available: false, forge: 'github', reason: 'gh-not-authed'
      }),
      createChangeRequest: vi.fn()
    }
    const renderer = await renderPanel()
    await act(async () => {})
    expect(renderer.root.findAll(
      (n) => typeof n.children?.[0] === 'string' || typeof n.props?.children === 'string'
    ).some((n) => String(n.props.children).includes('gh auth login')
      || String(n.children?.[0]).includes('gh auth login'))).toBe(true)
    const create = buttons(renderer).find((b) => /create/i.test(buttonText(b)))
    expect(create?.props.disabled).toBe(true)
  })

  it('creates a request when the forge is available', async () => {
    const createChangeRequest = vi.fn(async () => ({ request: snapshot }))
    providerHolder.value = {
      getChangeRequest: async () => ({ available: true, forge: 'github' }),
      createChangeRequest
    }
    const renderer = await renderPanel()
    await act(async () => {})
    const create = buttons(renderer).find((b) => /create/i.test(buttonText(b)))
    expect(create?.props.disabled).not.toBe(true)
    await act(async () => create!.props.onClick())
    expect(createChangeRequest).toHaveBeenCalledWith('tws_cr00001', {})
  })

  it('sends a failed check back to the worker as a note-only review', async () => {
    const sendReview = vi.fn(async () => ({}))
    providerHolder.value = {
      getChangeRequest: async () => ({ available: true, forge: 'github', request: snapshot }),
      sendReview
    }
    const renderer = await renderPanel()
    await act(async () => {})
    const sendBack = buttons(renderer).find((b) => /send back|sent/i.test(buttonText(b)))
    expect(sendBack).toBeTruthy()
    await act(async () => sendBack!.props.onClick())
    expect(sendReview).toHaveBeenCalledWith('tws_cr00001', {
      commentIds: [],
      target: { kind: 'worker', workerId: 'thr_w1' },
      note: expect.stringContaining('unit')
    })
  })

  it('polls every 60s while mounted and stops on unmount', async () => {
    vi.useFakeTimers()
    const getChangeRequest = vi.fn(async () => ({
      available: true, forge: 'github' as const, request: snapshot
    }))
    providerHolder.value = { getChangeRequest }
    const record = binding({ changeRequest: snapshot })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ChangeRequestPanel, { binding: record }))
    })
    const callsAfterMount = getChangeRequest.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(getChangeRequest.mock.calls.length).toBe(callsAfterMount + 1)
    await act(async () => renderer.unmount())
    const callsAfterUnmount = getChangeRequest.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(120_000)
    })
    expect(getChangeRequest.mock.calls.length).toBe(callsAfterUnmount)
  })
})

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMessage, WorkbenchLinkEntry } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomWorkbenchTaskCard } from './RoomWorkbenchTaskCard'

const mocks = vi.hoisted(() => ({
  client: { get: vi.fn(), confirm: vi.fn(), dismiss: vi.fn(), cancel: vi.fn() },
  subscribe: vi.fn(),
  open: vi.fn(),
  openTarget: vi.fn(),
  dispatch: { get: vi.fn(), act: vi.fn(), publish: vi.fn() }
}))
vi.mock('./workbench-client', () => ({ workbenchClient: mocks.client }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: (listener: unknown) => mocks.subscribe(listener) }))
vi.mock('./workbench-navigation', () => ({
  openWorkbenchLinkTarget: mocks.open, workbenchOpenTarget: mocks.openTarget }))
vi.mock('../../agent/agent-dispatch-client', () => ({ agentDispatchClient: mocks.dispatch, publishAgentDispatchIntent: mocks.dispatch.publish }))
vi.mock('../chat/AgentDispatchIntentControls', () => ({
  AgentDispatchIntentControls: ({ intentId }: { intentId: string }) => createElement('aside', { 'data-dispatch-controls': intentId }, 'Host dispatch decision')
}))

const room = { id: 'room', members: [] } as unknown as Room
const message = { id: 'card-1', roomId: 'room', presentationKind: 'workbench_task', workbenchLinkId: 'link-1', body: 'Fix SSE',
  authorKind: 'member', authorLabelSnapshot: 'Bot', bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], messageSeq: 1,
  createdAt: '2026-09-29T00:00:00.000Z' } as RoomMessage
const link = (overrides: Partial<WorkbenchLinkEntry> = {}): WorkbenchLinkEntry => ({
  schemaVersion: 1, id: 'link-1', roomId: 'room', participantAgentId: 'agent-1', memberId: 'member', kind: 'code_task', surface: 'code',
  status: 'awaiting_confirmation', origin: { kind: 'tool', runId: 'run', toolCallId: 'call', turnId: 'turn', fresh: true },
  request: { title: 'Fix SSE reconnect', goal: 'Reconnect after a drop', acceptance: 'tests pass', workspaceRoot: '/work/app', mode: 'agent',
    isolation: 'inherit', report: 'final' },
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z', revision: 0, ...overrides
} as WorkbenchLinkEntry)
const text = (renderer: ReactTestRenderer): string => JSON.stringify(renderer.toJSON())
const textOf = (node: unknown): string => typeof node === 'string' ? node
  : node && typeof node === 'object' && 'children' in node ? (node as { children: unknown[] }).children.map(textOf).join('') : ''
const button = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAllByType('button').find((item) => textOf(item).includes(label))

describe('Room workbench task card', () => {
  let renderer: ReactTestRenderer | undefined
  let emit: (event: unknown) => void = () => undefined
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    Object.values(mocks.client).forEach((mock) => mock.mockReset())
    Object.values(mocks.dispatch).forEach((mock) => mock.mockReset())
    mocks.open.mockReset().mockResolvedValue(undefined)
    mocks.openTarget.mockReset().mockReturnValue(null)
    mocks.subscribe.mockReset().mockImplementation((listener: (event: unknown) => void) => { emit = listener; return () => undefined })
  })
  afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined })
  const mount = async () => { await act(async () => { renderer = create(createElement(RoomWorkbenchTaskCard, { room, message })) }) }

  it('shows the proposal and starts the task only when the user accepts', async () => {
    mocks.client.get.mockResolvedValue(link())
    mocks.client.confirm.mockResolvedValue(link({ status: 'queued', revision: 1 }))
    await mount()
    expect(mocks.client.get).toHaveBeenCalledWith('room', 'link-1', expect.any(AbortSignal))
    expect(text(renderer!)).toContain('Fix SSE reconnect')
    expect(text(renderer!)).toContain('Needs your OK')
    expect(text(renderer!)).toContain('tests pass')
    expect(mocks.client.confirm).not.toHaveBeenCalled()
    await act(async () => { button(renderer!, 'Start')!.props.onClick(); await Promise.resolve() })
    expect(mocks.client.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.client.confirm.mock.calls[0][0]).toMatchObject({ id: 'link-1', revision: 0 })
    expect(mocks.client.confirm.mock.calls[0][1]).toMatchObject({ title: 'Fix SSE reconnect', execution: { mode: 'direct' } })
    expect(text(renderer!)).toContain('Starting')
  })

  it('lets the user edit the goal and choose an isolated worktree before starting', async () => {
    mocks.client.get.mockResolvedValue(link())
    mocks.client.confirm.mockResolvedValue(link({ status: 'queued', revision: 1 }))
    await mount()
    await act(async () => { button(renderer!, 'Edit')!.props.onClick() })
    const goal = renderer!.root.findByType('textarea')
    await act(async () => { goal.props.onChange({ target: { value: 'Reconnect with backoff' } }) })
    await act(async () => { button(renderer!, 'Isolated worktree')!.props.onClick() })
    await act(async () => { button(renderer!, 'Start')!.props.onClick(); await Promise.resolve() })
    expect(mocks.client.confirm.mock.calls[0][1]).toMatchObject({ title: 'Fix SSE reconnect', goal: 'Reconnect with backoff', isolation: 'worktree' })
  })

  it('confirms an automatic Code mode with a one-time schedule from the card', async () => {
    mocks.client.get.mockResolvedValue(link())
    mocks.client.confirm.mockResolvedValue(link({ status: 'scheduled', revision: 1 }))
    await mount()
    await act(async () => { button(renderer!, 'Edit')!.props.onClick() })
    await act(async () => { button(renderer!, 'Plan then run')!.props.onClick() })
    await act(async () => { button(renderer!, 'At a time')!.props.onClick() })
    await act(async () => { button(renderer!, 'Schedule')!.props.onClick(); await Promise.resolve() })
    expect(mocks.client.confirm.mock.calls[0][1]).toMatchObject({ execution: { mode: 'auto' }, schedule: { kind: 'once' } })
  })

  it('keeps the default permission ceiling visible before starting', async () => {
    mocks.client.get.mockResolvedValue(link())
    await mount()
    await act(async () => { button(renderer!, 'Edit')!.props.onClick() })
    expect(button(renderer!, 'Full access')!.props.disabled).toBe(true)
  })

  it('can be dismissed, and surfaces a conflict from a stale card', async () => {
    mocks.client.get.mockResolvedValue(link())
    mocks.client.dismiss.mockRejectedValue(new Error('workbench link changed since it was read'))
    await mount()
    await act(async () => { button(renderer!, 'Not now')!.props.onClick(); await Promise.resolve() })
    expect(mocks.client.dismiss).toHaveBeenCalledTimes(1)
    expect(text(renderer!)).toContain('changed since it was read')
    expect(mocks.client.get).toHaveBeenCalledTimes(2) // refreshed after the failure
  })

  it('follows live updates: attention, then the result with changed files', async () => {
    mocks.client.get.mockResolvedValue(link({ status: 'running', threadId: 'thread-1' }))
    mocks.openTarget.mockReturnValue('code')
    await mount()
    expect(text(renderer!)).toContain('Running')
    expect(button(renderer!, 'Stop')).toBeTruthy()
    mocks.client.get.mockResolvedValue(link({ status: 'needs_attention', threadId: 'thread-1', attention: { kind: 'approval', summary: 'Run npm test' } }))
    await act(async () => { emit({ roomId: 'room', kind: 'workbench.link.updated', payload: { linkId: 'link-1' } }); await Promise.resolve() })
    expect(text(renderer!)).toContain('Waiting for your approval')
    expect(text(renderer!)).toContain('Run npm test')
    // Events for another link are ignored.
    const calls = mocks.client.get.mock.calls.length
    await act(async () => { emit({ roomId: 'room', kind: 'workbench.link.updated', payload: { linkId: 'other' } }); await Promise.resolve() })
    expect(mocks.client.get.mock.calls.length).toBe(calls)
    mocks.client.get.mockResolvedValue(link({ status: 'completed', threadId: 'thread-1', result: { summary: 'Fixed the reconnect logic.', finalExcerpt: '',
      changedFiles: ['src/sse.ts', 'src/sse.test.ts'], commands: [{ command: 'npm test', exitCode: 0 }], finishedAt: '2026-09-29T00:10:00.000Z' } }))
    await act(async () => { emit({ roomId: 'room', kind: 'workbench.link.updated', payload: { linkId: 'link-1' } }); await Promise.resolve() })
    expect(text(renderer!)).toContain('Fixed the reconnect logic.')
    expect(text(renderer!)).toContain('2 files changed')
    expect(text(renderer!)).toContain('npm test')
    await act(async () => { button(renderer!, 'Open in Code')!.props.onClick(); await Promise.resolve() })
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'link-1', status: 'completed' }))
  })

  it('shows the stored final outcome rather than only a progress-like first line', async () => {
    mocks.client.get.mockResolvedValue(link({ status: 'completed', result: {
      summary: 'Checking the layout.', finalExcerpt: 'Checking the layout.\nFinished: the card is ready.',
      changedFiles: [], commands: [], finishedAt: '2026-10-01T00:00:00.000Z' } }))
    await mount()
    expect(text(renderer!)).toContain('Finished: the card is ready.')
  })

  it('keeps the requested Agent visible through execution and completion', async () => {
    const request = { ...link().request, execution: { mode: 'direct' as const,
      model: { harnessId: 'codex', credentialMode: 'native-login' as const, model: 'gpt-fixture' } } }
    mocks.client.get.mockResolvedValue(link({ request, status: 'running', threadId: 'thread-1' }))
    await mount()
    expect(text(renderer!)).toContain('gpt-fixture')
    expect(renderer!.root.findByProps({ 'data-workbench-agent': 'codex' })).toBeTruthy()
    mocks.client.get.mockResolvedValue(link({ request, status: 'completed', threadId: 'thread-1' }))
    await act(async () => { emit({ roomId: 'room', kind: 'workbench.link.updated', payload: { linkId: 'link-1' } }) })
    expect(renderer!.root.findByProps({ 'data-workbench-agent': 'codex' })).toBeTruthy()
    expect(button(renderer!, 'Stop')).toBeUndefined()
  })

  it('cancel editing discards unsaved choices before starting', async () => {
    mocks.client.get.mockResolvedValue(link())
    mocks.client.confirm.mockResolvedValue(link({ status: 'queued', revision: 1 }))
    await mount()
    await act(async () => { button(renderer!, 'Edit')!.props.onClick() })
    await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: 'discard this draft' } }) })
    await act(async () => { button(renderer!, 'Cancel')!.props.onClick() })
    await act(async () => { button(renderer!, 'Start')!.props.onClick() })
    expect(mocks.client.confirm.mock.calls[0][1].goal).toBe('Reconnect after a drop')
  })

  it('shows document previews and edit diffs as reviewable content', async () => {
    mocks.client.get.mockResolvedValue(link({ kind: 'work_edit', surface: 'work', request: { title: 'Rename beta', goal: '', workspaceRoot: '/work',
      relativePath: 'doc.md', mode: 'agent', isolation: 'inherit', report: 'silent', edits: [{ oldText: 'beta', newText: 'BETA' }] } }))
    await mount()
    expect(text(renderer!)).toContain('Document edit')
    expect(text(renderer!)).toContain('Apply change')
    expect(renderer!.root.findByType('del').children.join('')).toBe('beta')
    expect(renderer!.root.findByType('ins').children.join('')).toBe('BETA')
  })

  it('says so when the link no longer exists', async () => {
    mocks.client.get.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    await mount()
    expect(text(renderer!)).toContain('This task is no longer available.')
  })

  it('uses host dispatch controls without showing another manual confirmation', async () => {
    mocks.client.get.mockResolvedValue(link({ dispatchIntentId: 'dispatch-1' }))
    await mount()
    expect(renderer!.root.findByProps({ 'data-dispatch-controls': 'dispatch-1' })).toBeTruthy()
    expect(button(renderer!, 'Start')).toBeUndefined()
    expect(text(renderer!)).not.toContain('Needs your OK')
    expect(mocks.client.confirm).not.toHaveBeenCalled()
  })

  it('waits for the host pause before editing and resumes the host on discard', async () => {
    mocks.client.get.mockResolvedValue(link({ dispatchIntentId: 'dispatch-1' }))
    const intent = { intentId: 'dispatch-1', revision: 1, state: 'countdown' }
    mocks.dispatch.get.mockResolvedValue(intent)
    let releasePause: (value: unknown) => void = () => undefined
    mocks.dispatch.act.mockImplementationOnce(() => new Promise((resolve) => { releasePause = resolve }))
    await mount()
    await act(async () => { button(renderer!, 'Edit')!.props.onClick(); await Promise.resolve() })
    expect(mocks.dispatch.act).toHaveBeenCalledWith(intent, 'pause')
    expect(renderer!.root.findAllByType('textarea')).toHaveLength(0)
    await act(async () => { releasePause({ ...intent, revision: 2, state: 'paused' }); await Promise.resolve() })
    expect(renderer!.root.findAllByType('textarea')).toHaveLength(1)
    expect(button(renderer!, 'At a time')).toBeUndefined()
    mocks.dispatch.get.mockResolvedValue({ ...intent, revision: 2, state: 'paused' })
    mocks.dispatch.act.mockResolvedValue({ ...intent, revision: 3, state: 'countdown' })
    await act(async () => { button(renderer!, 'Cancel')!.props.onClick(); await Promise.resolve() })
    expect(mocks.dispatch.act).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2 }), 'resume')
    expect(renderer!.root.findAllByType('textarea')).toHaveLength(0)
  })
})

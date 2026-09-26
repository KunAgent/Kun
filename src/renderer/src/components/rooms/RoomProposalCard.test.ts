import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMessage, RoomProposalEntry } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomProposalCard } from './RoomProposalCard'

const mocks = vi.hoisted(() => ({
  client: {
    getRoomProposal: vi.fn(),
    resolveRoomProposal: vi.fn(),
    pinMessage: vi.fn(),
    updateRule: vi.fn(),
    update: vi.fn(),
    message: vi.fn(),
    presets: vi.fn()
  },
  subscribe: vi.fn(),
  serial: 0
}))
vi.mock('./rooms-client', async (original) => {
  const mod = await original<typeof import('./rooms-client')>()
  return { ...mod, roomsClient: { ...mod.roomsClient, ...mocks.client }, roomRequestId: () => 'req-' + ++mocks.serial }
})
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: (listener: unknown) => mocks.subscribe(listener) }))

const room = {
  id: 'room',
  defaultMemberId: 'developer',
  archivedAt: undefined,
  members: [
    { id: 'developer', displayName: 'Developer', role: 'developer', enabled: true },
    { id: 'reviewer', displayName: 'Reviewer', role: 'reviewer', enabled: true }
  ],
  repositories: [{ id: 'repo', displayName: 'App' }]
} as unknown as Room
const message = {
  id: 'card-message', roomId: 'room', proposalId: 'proposal-1', presentationKind: 'proposal',
  authorKind: 'member', authorMemberId: 'developer', authorLabelSnapshot: 'Developer',
  body: 'rationale', messageSeq: 2, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
  createdAt: '2026-09-15T00:00:01.000Z'
} as RoomMessage
const proposal = (overrides: Partial<RoomProposalEntry> = {}): RoomProposalEntry => ({
  schemaVersion: 1,
  proposalId: 'proposal-1',
  roomId: 'room',
  messageId: 'card-message',
  payload: { kind: 'pin_agreement', body: 'Use the shared rule format.' },
  rationale: 'Both members suggested it.',
  status: 'open',
  authorMemberId: 'developer',
  authorAgentId: 'agent-dev',
  originRunId: 'run-1',
  revision: 3,
  createdAt: '2026-09-15T00:00:01.000Z',
  ...overrides
} as RoomProposalEntry)

let renderer: ReactTestRenderer | undefined
let emitted: Array<{ type: string; detail: unknown }>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('en')
  emitted = []
  for (const fn of Object.values(mocks.client)) fn.mockReset()
  mocks.subscribe.mockReset().mockReturnValue(() => {})
  mocks.serial = 0
  vi.stubGlobal('window', {
    dispatchEvent: (event: { type: string; detail: unknown }) => {
      emitted.push({ type: event.type, detail: (event as { detail?: unknown }).detail })
      return true
    }
  })
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

const render = async (entry: RoomProposalEntry): Promise<void> => {
  mocks.client.getRoomProposal.mockResolvedValue(entry)
  await act(async () => { renderer = create(createElement(RoomProposalCard, { room, message })) })
}

describe('RoomProposalCard', () => {
  it('renders the open draft with kind, author, rationale and dismisses through the user route', async () => {
    const entry = proposal()
    await render(entry)
    expect(mocks.client.getRoomProposal).toHaveBeenCalledWith('room', 'proposal-1', expect.anything())
    const section = renderer!.root.findByProps({ className: 'rooms-proposal' })
    expect(section.findAllByProps({ className: 'rooms-proposal-status is-open' })).toHaveLength(1)
    const rationale = section.findByProps({ className: 'rooms-proposal-rationale' })
    expect(rationale.findAllByType('p').length).toBeGreaterThan(0)
    expect(rationale.props.children).toContain('Both members suggested it.')
    mocks.client.resolveRoomProposal.mockResolvedValue({ ...entry, status: 'dismissed', revision: 4 })
    await act(async () => renderer!.root.findByProps({ className: 'rooms-proposal-dismiss' }).props.onClick())
    expect(mocks.client.resolveRoomProposal).toHaveBeenCalledWith('room', entry, { decision: 'dismissed' })
  })

  it('pins the edited agreement first and commits with the durable rule reference', async () => {
    const entry = proposal()
    await render(entry)
    const rule = { id: 'rule-1', roomId: 'room', messageId: 'card-message', body: 'Default body', revision: 0 }
    mocks.client.pinMessage.mockResolvedValue({ rule })
    mocks.client.updateRule.mockResolvedValue({ rule: { ...rule, body: 'Custom text', revision: 1 } })
    mocks.client.resolveRoomProposal.mockResolvedValue({ ...entry, status: 'committed', revision: 4 })
    await act(async () => renderer!.root.findByProps({ className: 'rooms-proposal-pin' })
      .findByType('textarea').props.onChange({ target: { value: 'Custom text' } }))
    await act(async () => renderer!.root.findByProps({ className: 'rooms-proposal-primary' }).props.onClick())
    expect(mocks.client.pinMessage).toHaveBeenCalledWith('room', 'card-message', 'proposal-1-pin')
    expect(mocks.client.updateRule).toHaveBeenCalledWith('room', rule, { body: 'Custom text' },
      expect.stringMatching(/^proposal-1-pin-/))
    expect(mocks.client.resolveRoomProposal).toHaveBeenCalledWith('room', entry,
      { decision: 'committed', resultRef: { kind: 'rule', id: 'rule-1' } })
  })

  it('drafts execution into the composer and commits once the user message lands', async () => {
    const entry = proposal({
      payload: { kind: 'execution_request', goal: 'Port the importer', memberIds: ['developer'], repositoryId: 'repo' },
      rootRequestId: 'topic-1'
    })
    await render(entry)
    await act(async () => renderer!.root.findByProps({ className: 'rooms-proposal-primary' }).props.onClick())
    expect(emitted).toHaveLength(1)
    expect(emitted[0].type).toBe('kun-room-proposal-draft')
    expect(emitted[0].detail).toMatchObject({
      roomId: 'room', mentions: ['developer'], repositoryId: 'repo', rootRequestId: 'topic-1', intent: 'execute'
    })
    expect((emitted[0].detail as { body: string }).body).toContain('Port the importer')
    const listener = mocks.subscribe.mock.calls[0][0] as (event: unknown) => void
    const sent = { id: 'user-message', authorKind: 'user', createdAt: new Date().toISOString() }
    mocks.client.message.mockResolvedValue({ message: sent })
    mocks.client.resolveRoomProposal.mockResolvedValue({ ...entry, status: 'committed', revision: 4 })
    await act(async () => listener({ roomId: 'room', kind: 'message.created', payload: { id: 'user-message' } }))
    expect(mocks.client.message).toHaveBeenCalledWith('room', 'user-message')
    expect(mocks.client.resolveRoomProposal).toHaveBeenCalledWith('room', entry,
      { decision: 'committed', resultRef: { kind: 'message', id: 'user-message' } })
  })

  it('refreshes on proposal events and never offers actions for closed drafts', async () => {
    const entry = proposal({ status: 'committed', resultRef: { kind: 'rule', id: 'rule-1' } })
    await render(entry)
    expect(renderer!.root.findAllByProps({ className: 'rooms-proposal-dismiss' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ className: 'rooms-proposal-primary' })).toHaveLength(0)
    const listener = mocks.subscribe.mock.calls[0][0] as (event: unknown) => void
    mocks.client.getRoomProposal.mockResolvedValue({ ...entry, status: 'dismissed', revision: 4 })
    await act(async () => listener({ roomId: 'room', kind: 'room.proposal.updated', payload: { proposalId: 'proposal-1' } }))
    expect(mocks.client.getRoomProposal).toHaveBeenCalledTimes(2)
  })
})

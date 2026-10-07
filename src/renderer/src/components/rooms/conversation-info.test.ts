// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDirectActivity, AgentIdentity, Room, RoomMember } from '@shared/rooms-api'

const mocks = vi.hoisted(() => ({ models: {} as Record<string, unknown> }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: 'en-US' }
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('./RoomAvatar', () => ({
  RoomAvatar: ({ label }: { label: string }) => createElement('span', { className: 'avatar' }, label),
  RoomAvatarGroup: ({ label }: { label: string }) => createElement('span', { className: 'avatar-group' }, label)
}))
vi.mock('./agent-client', async (importActual) => ({
  ...await importActual<typeof import('./agent-client')>(),
  useAgentResource: (path: string | null) => ({ data: path ? mocks.models[path.split('/')[3]] ?? null : null, error: '', refresh: () => undefined })
}))
import { AgentInfoBoard } from './AgentInfoBoard'
import { GroupInfoBoard } from './GroupInfoBoard'
import {
  agentConversationStatus, memberConversationStatus, modelAccountLabel, modelProviderLabel, workspaceName
} from './conversation-info'
import { directFailureText } from './RoomDirectChat'

const member = (id: string, values: Partial<RoomMember> = {}): RoomMember => ({
  id, participantAgentId: id, displayName: id.toUpperCase(), role: 'developer', presetId: 'general', roleNotes: '',
  enabled: true, revision: 0, allowedRepositoryIds: [], ...values
} as RoomMember)
const agent = (values: Partial<AgentIdentity> = {}): AgentIdentity => ({
  schemaVersion: 1, id: 'alpha', name: 'Alpha', title: 'Research partner', instructions: 'Answer briefly.',
  defaultRole: 'reviewer', presetId: 'general', memory: { readEnabled: true, captureEnabled: false },
  revision: 2, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z', ...values
} as AgentIdentity)
const activity = (values: Record<string, unknown> = {}): AgentDirectActivity => ({
  requests: [], pendingCount: 0, approvals: [], userInputs: [], workspace: { path: '/work/alpha-notes', id: 'w' }, ...values
} as unknown as AgentDirectActivity)
const options = [{ model: 'deepseek-flash', providerId: 'deepseek', accountId: 'account:deepseek', providerLabel: 'DeepSeek',
  label: 'deepseek-flash', available: true, groupAvailable: true, fastAvailable: true }]

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('conversation info helpers', () => {
  it('ranks the user decisions above activity and setup', () => {
    expect(agentConversationStatus(agent(), activity())).toBe('idle')
    expect(agentConversationStatus(agent({ setup: { status: 'pending', startedAt: '2026-10-01T08:00:00.000Z' } }), null)).toBe('setup')
    expect(agentConversationStatus(agent(), activity({ active: { status: 'pending' } }))).toBe('queued')
    expect(agentConversationStatus(agent(), activity({ active: { status: 'running' } }))).toBe('working')
    expect(agentConversationStatus(agent(), activity({ active: { status: 'running' }, userInputs: [{}] }))).toBe('input')
    expect(agentConversationStatus(agent(), activity({ approvals: [{}], userInputs: [{}] }))).toBe('approval')
    expect(agentConversationStatus(agent({ archivedAt: '2026-10-02T08:00:00.000Z' }), activity({ approvals: [{}] }))).toBe('archived')
    expect(memberConversationStatus(member('a', { enabled: false }), ['a'], [])).toBe('paused')
    expect(memberConversationStatus(member('a'), ['a'], ['a'])).toBe('working')
    expect(memberConversationStatus(member('a'), [], ['a'])).toBe('waiting')
  })

  it('names providers from options and hides accounts that repeat the provider', () => {
    const binding = { model: 'deepseek-flash', providerId: 'deepseek', accountId: 'account:deepseek' }
    expect(modelProviderLabel(binding, options)).toBe('DeepSeek')
    expect(modelProviderLabel({ ...binding, accountId: undefined }, options)).toBe('DeepSeek')
    expect(modelProviderLabel({ model: 'm', providerId: 'local' }, options)).toBe('local')
    expect(modelAccountLabel(binding)).toBe('')
    expect(modelAccountLabel({ ...binding, accountId: 'account:work' })).toBe('work')
    expect(workspaceName('C:\\Users\\me\\notes\\')).toBe('notes')
  })

  it('localizes the generic runtime failure and keeps specific errors', () => {
    const t = (key: string) => 't:' + key
    expect(directFailureText({ status: 'failed', error: 'The response failed. Its partial output is retained; inspect the run or retry.' }, t))
      .toBe('t:directFailedPartial')
    expect(directFailureText({ status: 'failed' }, t)).toBe('t:directFailed')
    expect(directFailureText({ status: 'failed', error: 'Choose another model' }, t)).toBe('Choose another model')
    expect(directFailureText({ status: 'cancelled' }, t)).toBe('t:directStopped')
  })
})

describe('conversation info boards', () => {
  it('shows the private Agent identity, resolved models, workspace and removals', async () => {
    const onRemove = vi.fn(), onModels = vi.fn()
    const room = { id: 'dm', name: 'Alpha', conversationKind: 'user_agent', members: [member('alpha')],
      repositories: [], privateWorkspace: '/work/alpha-notes' } as unknown as Room
    const models = { agent: agent(), options, main: { model: 'deepseek-flash', providerId: 'deepseek', accountId: 'account:deepseek' },
      mainAvailable: true, mainSource: 'room', fast: { model: 'deepseek-flash', providerId: 'deepseek' }, fastAvailable: false,
      fastSource: 'main', inheritedMain: { model: 'x' } }
    await act(async () => root.render(createElement(AgentInfoBoard, { room, agent: agent(), models: models as never,
      activity: activity({ active: { status: 'running' } }), onEditProfile: vi.fn(), onModels, onNewContext: vi.fn(),
      onWorkspace: vi.fn(), onRemove })))
    expect(host.querySelector('h2')?.textContent).toBe('Alpha')
    expect(host.querySelector('.conversation-info-status')?.textContent).toBe('conversationStatus_working')
    const cards = [...host.querySelectorAll('.conversation-info-model')]
    expect(cards.map((card) => card.querySelector('strong')?.textContent)).toEqual(['deepseek-flash', 'deepseek-flash'])
    expect(cards[0].textContent).toContain('DeepSeek')
    expect(cards[0].textContent).toContain('conversationInfoSource_room')
    expect(cards[1].getAttribute('data-available')).toBe('false')
    expect(host.querySelector('.conversation-info-workspace strong')?.textContent).toBe('alpha-notes')
    expect(host.querySelector('.conversation-info-facts')?.textContent).toContain('roomsReviewer')
    expect(host.querySelector('.conversation-info-facts')?.textContent).toContain('conversationInfoOff')
    act(() => host.querySelector<HTMLButtonElement>('[data-info-action="models"]')!.click())
    expect(onModels).toHaveBeenCalledOnce()
    act(() => host.querySelector<HTMLButtonElement>('[data-info-danger="agent"]')!.click())
    act(() => host.querySelector<HTMLButtonElement>('[data-info-danger="conversation"]')!.click())
    expect(onRemove.mock.calls).toEqual([['agent'], ['conversation']])
  })

  it('lists group members with their models and activity and removes the group', async () => {
    mocks.models = { alpha: { agent: agent(), main: { model: 'deepseek-flash', providerId: 'deepseek' }, mainAvailable: true, options },
      beta: { agent: agent({ id: 'beta', archivedAt: '2026-10-02T08:00:00.000Z' }), main: { model: 'kimi-k2', providerId: 'kimi' }, mainAvailable: true } }
    const onMemberDetails = vi.fn(), onMessageAgent = vi.fn(), onRemove = vi.fn()
    const room = { id: 'team', name: 'Team', collaborationMode: 'peer', members: [member('alpha'), member('beta'),
      member('gone', { removedAt: '2026-10-02T08:00:00.000Z' })],
    repositories: [{ id: 'r', displayName: 'Source', canonicalRoot: '/src', availability: 'available' }]
    } as unknown as Room
    await act(async () => root.render(createElement(GroupInfoBoard, { room, responding: ['alpha'], waiting: [],
      onSettings: vi.fn(), onMembers: vi.fn(), onMemberDetails, onMessageAgent, onRemove })))
    const rows = [...host.querySelectorAll('.conversation-info-members > li')]
    expect(rows.map((row) => row.getAttribute('data-member-status'))).toEqual(['working', 'archived'])
    expect(rows[1].textContent).toContain('conversationStatus_archived')
    expect(rows[1].querySelector('button.conversation-info-member-chat')).toBeNull()
    expect(rows.map((row) => row.querySelector('.conversation-info-member-model')?.textContent)).toEqual(['deepseek-flash', 'kimi-k2'])
    expect(rows[0].querySelector('.conversation-info-member-model')?.getAttribute('data-available')).toBe('true')
    expect(rows[1].querySelector('.conversation-info-member-model')?.hasAttribute('data-available')).toBe(false)
    expect(host.querySelector('.conversation-info-repositories')?.textContent).toContain('Source')
    act(() => rows[0].querySelector<HTMLButtonElement>('.conversation-info-member')!.click())
    act(() => rows[0].querySelector<HTMLButtonElement>('button.conversation-info-member-chat')!.click())
    act(() => host.querySelector<HTMLButtonElement>('[data-info-danger="group"]')!.click())
    expect(onMemberDetails).toHaveBeenCalledWith('alpha')
    expect(onMessageAgent).toHaveBeenCalledWith('alpha')
    expect(onRemove).toHaveBeenCalledOnce()
  })
})

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomNewChat } from './RoomNewChat'
import type { AgentIdentity } from '@shared/rooms-api'
import type { CodingAgentEntry } from './coding-agent-client'

const api = vi.hoisted(() => ({ request: vi.fn(), create: vi.fn(), agents: [] as AgentIdentity[], coding: [] as CodingAgentEntry[] }))
vi.mock('./RoomModal', () => ({
  RoomModal: ({ title, children }: { title: string; children: unknown }) =>
    createElement('div', { 'data-room-modal': title }, children as never)
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: api.request,
  roomsClient: { create: api.create }
}))
vi.mock('./agent-client', async (original) => ({
  ...(await original<typeof import('./agent-client')>()),
  useAgentCatalog: () => ({ agents: api.agents, cursor: undefined, more: async () => undefined, busy: false, error: '' }),
  useAgentResource: (path: string) => ({ data: path === '/v1/agents/coding-agents' ? { agents: api.coding } : { templates: [] },
    error: '', refresh: () => undefined })
}))

const codex = { id: 'agent-codex', name: 'Codex', title: 'gpt-5.5-mini', defaultRole: 'developer', presetId: 'general',
  avatar: { kind: 'harness', harnessId: 'codex' },
  executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5.5-mini' } } as AgentIdentity

describe('coding Agents in the new chat picker', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    await i18n.changeLanguage('en')
    api.request.mockReset().mockResolvedValue({ agent: codex })
    api.create.mockReset().mockResolvedValue({ room: { id: 'group-1' } })
    api.agents = [{ id: 'agent-1', name: 'Developer', title: 'Builds', defaultRole: 'developer' }, codex] as AgentIdentity[]
    api.coding = [
      { harnessId: 'codex', displayName: 'Codex', available: true, models: [
        { model: 'gpt-5.5', credentialMode: 'native-login' }, { model: 'gpt-5.5-mini', credentialMode: 'native-login' }] },
      { harnessId: 'opencode', displayName: 'OpenCode', available: false, reason: 'not installed', models: [] }
    ]
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })
  const row = (name: string) => renderer.root.findAllByProps({ className: 'direct-coding-agent' })
    .find((item) => item.findAllByType('strong').some((label) => label.props.children === name))!

  it('opens a private chat on the chosen engine model and keeps unready engines disabled', async () => {
    const onAgent = vi.fn()
    await act(async () => { renderer = create(createElement(RoomNewChat, { onClose: vi.fn(), onOpen: vi.fn(), onAgent })) })
    // Existing coding contacts live in their own section, not the Kun list.
    expect(renderer.root.findByProps({ className: 'direct-agent-choices' }).findAllByType('strong').map((item) => item.props.children))
      .toEqual(['Developer'])
    expect(row('OpenCode').findByType('button').props.disabled).toBe(true)
    expect(row('OpenCode').findByType('small').props.children).toBe('not installed')
    const select = row('Codex').findByType('select')
    await act(async () => select.props.onChange({ target: { value: select.props.children[1].props.value } }))
    await act(async () => row('Codex').findByType('button').props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/agents/coding-agents', 'POST', expect.objectContaining({
      harnessId: 'codex', model: 'gpt-5.5-mini', credentialMode: 'native-login' }))
    expect(onAgent).toHaveBeenCalledWith('agent-codex')
  })

  it('lets coding Agents join a group but keeps a Kun Agent as its lead', async () => {
    await act(async () => { renderer = create(createElement(RoomNewChat, { onClose: vi.fn(), onOpen: vi.fn(), onAgent: vi.fn(), selectionMode: 'group' })) })
    const start = () => renderer.root.findByProps({ className: 'rooms-run-primary direct-start-group' })
    await act(async () => row('Codex').findByType('button').props.onClick())
    expect(row('Codex').findByType('button').props['aria-pressed']).toBe(true)
    expect(start().props.disabled).toBe(true)
    const developer = renderer.root.findByProps({ className: 'direct-agent-choices' }).findAllByType('button')[0]
    await act(async () => developer.props.onClick())
    expect(start().props.disabled).toBe(false)
    await act(async () => start().props.onClick())
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ defaultMemberId: 'agent-1',
      members: [expect.objectContaining({ participantAgentId: 'agent-codex' }), expect.objectContaining({ participantAgentId: 'agent-1' })] }),
    expect.any(String))
  })
})

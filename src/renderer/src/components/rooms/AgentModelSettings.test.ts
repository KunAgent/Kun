import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { AgentModelSettings, type AgentModels } from './AgentModelSettings'
import { modelBindingKey } from './agent-client'

const api = vi.hoisted(() => ({
  saveAgentModels: vi.fn(),
  refresh: vi.fn(),
  snapshot: {
    agent: {
      id: 'agent-1',
      revision: 2,
      modelRef: { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-reasoner' },
      fastModelRef: { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-chat' }
    },
    options: [
      {
        model: 'deepseek-reasoner',
        providerId: 'deepseek',
        accountId: 'acct-1',
        label: 'deepseek-reasoner',
        providerLabel: 'DeepSeek',
        available: true,
        groupAvailable: true,
        fastAvailable: true
      },
      {
        model: 'deepseek-chat',
        providerId: 'deepseek',
        accountId: 'acct-1',
        label: 'deepseek-chat',
        providerLabel: 'DeepSeek',
        available: true,
        groupAvailable: true,
        fastAvailable: true
      }
    ],
    main: { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-reasoner' },
    fast: { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-chat' },
    inheritedMain: { providerId: 'deepseek', model: 'deepseek-chat' },
    inheritedFast: { providerId: 'deepseek', model: 'deepseek-chat' },
    mainSource: 'agent',
    fastSource: 'agent'
  } as AgentModels
}))

vi.mock('./agent-client', async (original) => ({
  ...(await original<typeof import('./agent-client')>()),
  saveAgentModels: (...args: unknown[]) => api.saveAgentModels(...args),
  useAgentResource: () => ({
    data: api.snapshot,
    error: '',
    refresh: api.refresh
  })
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: { getState: () => ({ openSettings: vi.fn() }) }
}))
vi.mock('./RoomModal', () => ({
  RoomModal: ({ children }: { children: unknown }) => children
}))

describe('AgentModelSettings immediate apply', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.refresh.mockReset()
    api.saveAgentModels.mockReset().mockResolvedValue({
      ...api.snapshot,
      agent: { ...api.snapshot.agent, revision: 3 }
    })
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
  })

  const render = async (onSaved = vi.fn()) => {
    await act(async () => {
      renderer = create(
        createElement(AgentModelSettings, {
          agentId: 'agent-1',
          variant: 'panel',
          onClose: vi.fn(),
          onSaved
        })
      )
    })
    return onSaved
  }

  const select = (label: string) => renderer.root.findByProps({ 'aria-label': label })

  it('saves the main model as soon as it changes and does not keep a Save button', async () => {
    const onSaved = await render()
    const next = { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-chat' }
    await act(async () => {
      select('Main model').props.onChange({ target: { value: modelBindingKey(next) } })
    })
    expect(api.saveAgentModels).toHaveBeenCalledWith('agent-1', {
      expectedRevision: 2,
      modelRef: next,
      fastModelRef: api.snapshot.agent.fastModelRef
    })
    expect(onSaved).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByProps({ className: 'rooms-run-primary' })).toHaveLength(0)
  })

  it('saves the lightweight model as soon as it changes', async () => {
    await render()
    const next = { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-reasoner' }
    await act(async () => {
      select('Lightweight model').props.onChange({ target: { value: modelBindingKey(next) } })
    })
    expect(api.saveAgentModels).toHaveBeenCalledWith('agent-1', {
      expectedRevision: 2,
      modelRef: api.snapshot.agent.modelRef,
      fastModelRef: next
    })
  })

  it('saves inheritance immediately when restored', async () => {
    await render()
    await act(async () => {
      renderer.root.findAllByType('button').find((node) => node.children.includes('Restore inheritance'))!.props.onClick()
    })
    expect(api.saveAgentModels).toHaveBeenCalledWith('agent-1', {
      expectedRevision: 2,
      modelRef: null,
      fastModelRef: api.snapshot.agent.fastModelRef
    })
  })

  it('disables the selects while a save is in flight and reverts on failure', async () => {
    let finish: (reason?: unknown) => void = () => undefined
    api.saveAgentModels.mockImplementation(
      () => new Promise((_, reject) => { finish = reject })
    )
    await render()
    await act(async () => {
      select('Main model').props.onChange({
        target: { value: modelBindingKey({ providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-chat' }) }
      })
    })
    expect(renderer.root.findAllByType('fieldset').every((node) => node.props.disabled)).toBe(true)
    await act(async () => { finish(new Error('revision conflict')) })
    expect(select('Main model').props.value).toBe(modelBindingKey(api.snapshot.agent.modelRef))
    expect(renderer.root.findAllByProps({ role: 'alert' }).some((node) =>
      String(node.children).includes('revision conflict')
    )).toBe(true)
  })
})

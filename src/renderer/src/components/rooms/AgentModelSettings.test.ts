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
const initialSnapshot = api.snapshot

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
  useChatStore: Object.assign(
    (selector: (state: { composerModelGroups: never[] }) => unknown) => selector({ composerModelGroups: [] }),
    { getState: () => ({ openSettings: vi.fn() }) }
  )
}))
vi.mock('./RoomModal', () => ({
  RoomModal: ({ children }: { children: unknown }) => children
}))

describe('AgentModelSettings immediate apply', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.snapshot = initialSnapshot
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

  const trigger = (label: string) => renderer.root.findByProps({ 'aria-label': label, 'aria-haspopup': 'listbox' })
  const choose = async (label: string, binding: Parameters<typeof modelBindingKey>[0]) => {
    act(() => trigger(label).props.onClick())
    await act(async () => {
      renderer.root.findByProps({ 'data-agent-model-option': modelBindingKey(binding) }).props.onClick()
    })
  }
  const triggerModel = (role: 'main' | 'fast') => renderer.root.findByProps({ 'data-agent-model-trigger': role })
    .findByProps({ className: 'agent-model-select-model' }).children

  it('labels role-default scope and immediate save semantics', async () => {
    await render()
    expect(renderer.root.findAllByType('p').some((item) => String(item.children).includes('Existing conversation overrides and active requests stay unchanged'))).toBe(true)
    expect(renderer.root.findAllByType('p').some((item) => String(item.children).includes('Model changes save immediately'))).toBe(true)
  })

  it('does not notify another Agent editor after an old save completes', async () => {
    let resolve!: (value: unknown) => void
    api.saveAgentModels.mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
    const saved = await render()
    await choose('Main model', api.snapshot.options[1])
    act(() => renderer.unmount())
    await act(async () => resolve({ agent: { ...api.snapshot.agent, revision: 3 } }))
    expect(saved).not.toHaveBeenCalled()
  })

  it('lists a model without a provider id as unavailable and never saves it', async () => {
    const unavailable = { ...api.snapshot.options[0], model: 'legacy-model', providerId: undefined }
    api.snapshot = { ...api.snapshot, options: [...api.snapshot.options, unavailable] }
    await render()
    await choose('Main model', unavailable)
    expect(renderer.root.findByProps({ 'data-agent-model-option': modelBindingKey(unavailable) }).props['aria-disabled']).toBe(true)
    expect(api.saveAgentModels).not.toHaveBeenCalled()
  })

  it('saves inheritance from the follow-default option', async () => {
    await render()
    act(() => trigger('Main model').props.onClick())
    await act(async () => {
      renderer.root.findByProps({ 'data-agent-model-option': '__inherit__' }).props.onClick()
    })
    expect(api.saveAgentModels).toHaveBeenCalledWith('agent-1', {
      expectedRevision: 2,
      modelRef: null,
      fastModelRef: api.snapshot.agent.fastModelRef
    })
  })

  it('saves the main model as soon as it changes and does not keep a Save button', async () => {
    const onSaved = await render()
    const next = { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-chat' }
    await choose('Main model', next)
    expect(api.saveAgentModels).toHaveBeenCalledWith('agent-1', {
      expectedRevision: 2,
      modelRef: next,
      fastModelRef: api.snapshot.agent.fastModelRef
    })
    expect(onSaved).toHaveBeenCalledOnce()
    expect(renderer.root.findByProps({ role: 'status' }).children).toEqual(['Model saved'])
    expect(renderer.root.findAllByProps({ className: 'rooms-run-primary' })).toHaveLength(0)
  })

  it('saves the lightweight model as soon as it changes', async () => {
    await render()
    const next = { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-reasoner' }
    await choose('Lightweight model', next)
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
    await choose('Main model', { providerId: 'deepseek', accountId: 'acct-1', model: 'deepseek-chat' })
    expect(renderer.root.findAllByType('fieldset').every((node) => node.props.disabled)).toBe(true)
    expect(trigger('Main model').props.disabled).toBe(true)
    expect(triggerModel('main')).toEqual(['deepseek-chat'])
    await act(async () => { finish(new Error('revision conflict')) })
    expect(triggerModel('main')).toEqual(['deepseek-reasoner'])
    expect(api.refresh).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByProps({ role: 'alert' }).some((node) =>
      String(node.children).includes('revision conflict')
    )).toBe(true)
  })
})

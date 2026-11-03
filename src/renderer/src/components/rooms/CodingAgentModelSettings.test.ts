import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentIdentity } from '@shared/rooms-api'
import i18n from '../../i18n'
import { AgentModelSettings } from './AgentModelSettings'

const api = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), agent: {} as AgentIdentity }))
vi.mock('./agent-client', async (original) => ({
  ...await original<typeof import('./agent-client')>(),
  useAgentResource: () => ({ data: { agent: api.agent, options: [] }, refresh: api.refresh, error: '' })
}))
vi.mock('./rooms-client', async (original) => ({
  ...await original<typeof import('./rooms-client')>(), roomsRequest: (...args: unknown[]) => api.request(...args)
}))
vi.mock('./RoomCodingAgentModelPicker', () => ({
  RoomCodingAgentModelPicker: ({ agent, disabled, onChange }: {
    agent: AgentIdentity; disabled?: boolean; onChange: (model: string) => void
  }) => createElement('button', { type: 'button', 'data-native-model': agent.executor?.model, disabled,
    onClick: () => onChange('gpt-next') }, 'Select native model')
}))

describe('coding Agent model defaults', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    await i18n.changeLanguage('en')
    vi.clearAllMocks()
    api.agent = { id: 'codex-agent', revision: 2, title: 'gpt-current',
      executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-current' }
    } as AgentIdentity
    api.request.mockImplementation(async (_path, _method, input) => ({
      agent: { ...api.agent, ...input, revision: input.expectedRevision + 1 }
    }))
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
  const render = async (onSaved = vi.fn()) => {
    await act(async () => { renderer = create(createElement(AgentModelSettings, {
      agentId: api.agent.id, variant: 'panel', onClose: vi.fn(), onSaved
    })) })
    return onSaved
  }
  const picker = () => renderer.root.findAllByType('button').find((node) => node.props['data-native-model'])!

  it('shows the external Agent picker without Kun provider or lightweight controls', async () => {
    await render()
    expect(picker().props['data-native-model']).toBe('gpt-current')
    expect(renderer.root.findAllByType('select')).toHaveLength(0)
    expect(renderer.root.findAllByType('legend').map((node) => node.children.join(''))).toEqual(['Main model'])
    expect(renderer.root.findAllByType('p').some((node) => node.children.join('').includes("Choose from this Agent's models"))).toBe(true)
  })

  it('saves immediately with the fixed engine route and updates its generated subtitle', async () => {
    const onSaved = await render()
    await act(async () => { picker().props.onClick() })
    expect(api.request).toHaveBeenCalledWith('/v1/agents/codex-agent', 'PATCH', {
      clientRequestId: expect.any(String), expectedRevision: 2,
      executor: { ...api.agent.executor, model: 'gpt-next' }, title: 'gpt-next'
    })
    expect(picker().props['data-native-model']).toBe('gpt-next')
    expect(renderer.root.findByProps({ role: 'status' }).children).toEqual(['Model saved'])
    expect(onSaved).toHaveBeenCalledOnce()
    expect(api.refresh).toHaveBeenCalledOnce()
  })

  it('preserves a custom title and the pinned provider/account', async () => {
    api.agent = { ...api.agent, title: 'My coding partner', executor: { ...api.agent.executor!,
      credentialMode: 'kun-gateway', providerId: 'gateway-work', accountId: 'work' } }
    await render()
    await act(async () => { picker().props.onClick() })
    const input = api.request.mock.calls[0][2]
    expect(input.executor).toEqual({ ...api.agent.executor, model: 'gpt-next' })
    expect(input).not.toHaveProperty('title')
    expect(input).not.toHaveProperty('modelRef')
  })

  it('keeps the saved model after a rejected change and refreshes the revision', async () => {
    let reject!: (error: Error) => void
    api.request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const onSaved = await render()
    act(() => picker().props.onClick())
    expect(picker().props.disabled).toBe(true)
    await act(async () => reject(new Error('revision conflict')))
    expect(picker().props['data-native-model']).toBe('gpt-current')
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('revision conflict')
    expect(onSaved).not.toHaveBeenCalled()
    expect(api.refresh).toHaveBeenCalledOnce()
  })

  it('does not publish an old save after the editor is unmounted', async () => {
    let resolve!: (value: unknown) => void
    api.request.mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
    const onSaved = await render()
    act(() => picker().props.onClick())
    act(() => renderer.unmount())
    await act(async () => resolve({ agent: { ...api.agent, revision: 3 } }))
    expect(onSaved).not.toHaveBeenCalled()
    expect(api.refresh).not.toHaveBeenCalled()
  })
})

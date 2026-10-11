import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomCreationModelPicker } from './RoomCreationModelPicker'
import { modelBindingKey } from './agent-client'

const api = vi.hoisted(() => ({ request: vi.fn(), settings: vi.fn() }))
vi.mock('./rooms-client', async (original) => ({ ...(await original<typeof import('./rooms-client')>()), roomsRequest: api.request }))
vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => ({ openSettings: api.settings }) } }))
const first = { providerId: 'api', providerLabel: 'API', accountId: 'personal', model: 'same-model', available: true }
const second = { ...first, accountId: 'work' }
const blocked = { ...first, providerId: 'external', available: false, reason: 'agent_scope_unsupported' }
const options = { options: [first, second, blocked], main: first, inheritedMain: first }
const commits = () => api.request.mock.calls.filter(([path]) => path === '/v1/agents/quick-create')

describe('creation model confirmation', () => {
  let renderer: ReactTestRenderer
  const stored = new Map<string, string>()
  const write = vi.fn((key: string, value: string) => stored.set(key, value))
  const onBack = vi.fn(), onClose = vi.fn(), onOpen = vi.fn(), onBusyChange = vi.fn()
  const button = (text: string) => renderer.root.findAllByType('button').find((item) => item.children.includes(text))!
  const mount = async () => { await act(async () => { renderer = create(createElement(RoomCreationModelPicker, { onBack, onClose, onOpen, onBusyChange })) }) }
  const select = async (option = first) => { await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: modelBindingKey(option) } })) }
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.clearAllMocks(); stored.clear()
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: write, removeItem: (key: string) => stored.delete(key) } })
    await i18n.changeLanguage('en')
    api.request.mockImplementation(async (path) => path === '/v1/agents/creation-models' ? options : { roomId: 'room-1' })
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

  it('loads read-only options without choosing inherited defaults or running a probe', async () => {
    await mount()
    expect(renderer.root.findByType('select').props.value).toBe('')
    expect(button('Continue').props.disabled).toBe(true)
    expect(api.request).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalled()
    expect(api.request.mock.calls[0].slice(0, 2)).toEqual(['/v1/agents/creation-models', 'GET'])
    expect(renderer.root.findAllByType('optgroup').map((group) => group.props.label)).toEqual(['API', 'API'])
    const unavailable = renderer.root.findAllByType('option').find((item) => item.props.value === modelBindingKey(blocked))!
    expect(unavailable.props.disabled).toBe(true)
  })
  it('requires explicit choice and commits exact account identity once', async () => {
    let resolve!: (result: unknown) => void
    api.request.mockImplementation((path) => path.endsWith('creation-models') ? Promise.resolve(options) : new Promise((yes) => { resolve = yes }))
    await mount(); await select(second)
    expect(commits()).toHaveLength(0)
    const proceed = button('Continue')
    act(() => { proceed.props.onClick(); proceed.props.onClick() })
    expect(commits()).toHaveLength(1)
    expect(commits()[0][2]).toEqual({ clientRequestId: expect.any(String), name: 'New agent', setupMode: 'chat', modelRef: { providerId: 'api', accountId: 'work', model: 'same-model' } })
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    await act(async () => resolve({ roomId: 'room-1' }))
    expect(onOpen).toHaveBeenCalledWith('room-1'); expect(onClose).toHaveBeenCalledOnce()
  })
  it.each(['Back', 'Cancel'])('does not persist on %s or remount', async (action) => {
    await mount(); await select()
    act(() => button(action).props.onClick())
    expect(action === 'Back' ? onBack : onClose).toHaveBeenCalledOnce()
    act(() => renderer.unmount()); await mount()
    expect(renderer.root.findByType('select').props.value).toBe('')
    expect(commits()).toHaveLength(0)
  })
  it('refreshes after rejection, disables stale selection, and creates a fresh id for a different account', async () => {
    let stale = false
    api.request.mockImplementation(async (path) => {
      if (path.includes('/creation-requests/')) return { created: null }
      if (path.endsWith('creation-models')) return stale ? { options: [second] } : options
      stale = true; throw new Error('The selected model is unavailable; choose an available model')
    })
    await mount(); await select(); await act(async () => button('Continue').props.onClick())
    const original = commits()[0][2].clientRequestId
    expect(button('Retry request').props.disabled).toBe(true)
    expect(renderer.root.findByType('select').props.value).toBe(modelBindingKey(first))
    await select(second); await act(async () => button('Continue').props.onClick())
    expect(commits()[1][2].clientRequestId).not.toBe(original)
  })
  it('keeps the same id across recoverable failures without inference probes', async () => {
    api.request.mockImplementation(async (path) => { if (path.includes('/creation-requests/')) return { created: null }; if (path.endsWith('creation-models')) return options; throw new Error('temporary failure') })
    await mount(); await select(); await act(async () => button('Continue').props.onClick())
    await act(async () => button('Retry request').props.onClick())
    expect(commits()[1][2].clientRequestId).toBe(commits()[0][2].clientRequestId)
    expect(api.request.mock.calls.every(([path]) => path.startsWith('/v1/agents/creation-requests/') || ['/v1/agents/creation-models', '/v1/agents/quick-create'].includes(path))).toBe(true)
  })
  it('shows loading, empty and failed discovery with a settings exit and recoverable refresh', async () => {
    let resolve!: (result: unknown) => void
    api.request.mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
    await mount(); expect(button('Continue').props.disabled).toBe(true)
    expect(renderer.root.findByProps({ role: 'status' })).toBeTruthy()
    await act(async () => resolve({ options: [] }))
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('No eligible models')
    api.request.mockRejectedValueOnce(new Error('discovery failed'))
    await act(async () => button('Refresh models').props.onClick())
    expect(renderer.root.findByProps({ role: 'alert' })).toBeTruthy()
    await act(async () => button('Refresh models').props.onClick())
    await select(); expect(button('Continue').props.disabled).toBe(false)
    act(() => button('Manage model connections').props.onClick())
    expect(onClose).toHaveBeenCalledOnce(); expect(api.settings).toHaveBeenCalledWith('agents'); expect(commits()).toHaveLength(0)
  })
  it('reconciles a lost create response without creating a second Agent', async () => {
    api.request.mockImplementation(async (path) => {
      if (path.endsWith('creation-models')) return options
      if (path.includes('/creation-requests/')) return { created: { roomId: 'existing-room', agentId: 'existing-agent' } }
      throw new Error('lost response')
    })
    await mount(); await select(); await act(async () => button('Continue').props.onClick())
    expect(commits()).toHaveLength(1)
    expect(onOpen).toHaveBeenCalledWith('existing-room')
    expect(stored.size).toBe(0)
  })
  it('restores uncertain POST identity across reload without auto-submitting or changing its name with locale', async () => {
    api.request.mockImplementation(async (path) => {
      if (path.endsWith('creation-models')) return options
      throw new Error('offline')
    })
    await mount(); await select(); await act(async () => button('Continue').props.onClick())
    const original = commits()[0][2]
    expect(stored.size).toBe(1)
    expect(renderer.root.findByType('fieldset').props.disabled).toBe(true)
    expect(button('Back').props.disabled).toBe(true)
    act(() => button('Cancel').props.onClick()); expect(stored.size).toBe(1)
    act(() => renderer.unmount()); await i18n.changeLanguage('zh'); await mount()
    expect(commits()).toHaveLength(1)
    expect(renderer.root.findByType('select').props.value).toBe(modelBindingKey(first))
    api.request.mockImplementation(async (path) => path.endsWith('creation-models') ? options : { roomId: 'room-1' })
    await act(async () => renderer.root.findByProps({ className: 'rooms-run-primary' }).props.onClick())
    expect(commits()[1][2]).toEqual(original)
    expect(stored.size).toBe(0)
  })
  it('clears a confirmed missing POST when the user cancels', async () => {
    api.request.mockImplementation(async (path) => {
      if (path.endsWith('creation-models')) return options
      if (path.includes('/creation-requests/')) return { created: null }
      throw new Error('failed')
    })
    await mount(); await select(); await act(async () => button('Continue').props.onClick())
    expect(stored.size).toBe(1)
    act(() => button('Cancel').props.onClick()); expect(stored.size).toBe(0)
  })
  it('aborts discovery on unmount and ignores its late response', async () => {
    let resolve!: (result: unknown) => void
    api.request.mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
    await mount(); const signal = api.request.mock.calls[0][3] as AbortSignal
    act(() => renderer.unmount()); expect(signal.aborted).toBe(true)
    await act(async () => resolve(options)); expect(onOpen).not.toHaveBeenCalled()
  })
})

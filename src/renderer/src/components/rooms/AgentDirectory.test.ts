import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { AgentDirectory } from './AgentDirectory'
import { AgentDetails } from './AgentDetails'
const api = vi.hoisted(() => ({ catalog: vi.fn(), resource: vi.fn(), refresh: vi.fn(), more: vi.fn(), models: vi.fn() }))
vi.mock('./agent-client', async (original) => ({ ...(await original<typeof import('./agent-client')>()), useAgentCatalog: api.catalog, useAgentResource: api.resource }))
vi.mock('./AgentFeatureControls', () => ({ AgentFeatureControls: () => null }))
vi.mock('./AgentProfileForm', () => ({ AgentProfileForm: () => createElement('div', { 'data-profile': true }) }))
vi.mock('./AgentMemoryPanel', () => ({ AgentMemoryPanel: () => null }))
vi.mock('./AgentModelSettings', () => ({ AgentModelSettings: (props: unknown) => { api.models(props); return createElement('div', { 'data-model-editor': true }) } }))
const agent = { id: 'a', name: 'Developer', title: 'Builds tools', defaultRole: 'developer', revision: 3 }
const binding = { providerId: 'api', accountId: 'work', model: 'model-a' }

describe('unified Agent model management', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('en')
    api.catalog.mockReturnValue({ agents: [agent], data: {}, activities: {}, cursor: 'more', busy: false, error: '', refresh: api.refresh, more: api.more.mockResolvedValue(undefined) })
    api.resource.mockImplementation((path: string) => ({ data: path.endsWith('/models') ? { agent, main: binding, options: [{ ...binding, providerLabel: 'API' }], mainAvailable: true } : { agent }, error: '', refresh: api.refresh }))
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
  it('lists role-default model identity and exposes direct configure, search, archive and pagination', async () => {
    const details = vi.fn()
    await act(async () => { renderer = create(createElement(AgentDirectory, { onDetails: details, onOpen: vi.fn(), onCreate: vi.fn() })) })
    expect(api.resource).toHaveBeenCalledWith('/v1/agents/a/models')
    expect(renderer.root.findByProps({ title: 'API / work / model-a' }).children.join('')).toBe('API / work / model-a')
    expect(renderer.root.findAllByType('small').some((item) => item.children.includes('Configured · not connection-tested here'))).toBe(true)
    act(() => renderer.root.findByProps({ 'aria-label': 'Configure Developer' }).props.onClick())
    expect(details).toHaveBeenCalledWith('a')
    act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    expect(api.catalog).toHaveBeenLastCalledWith('', true)
    act(() => renderer.root.findByProps({ 'aria-label': i18n.t('agentsSearch') }).props.onChange({ target: { value: 'dev' } }))
    expect(api.catalog).toHaveBeenLastCalledWith('dev', true)
    await act(async () => renderer.root.findAllByType('button').find((item) => item.children.includes(i18n.t('roomsLoadMore')))!.props.onClick())
    expect(api.more).toHaveBeenCalledOnce()
  })
  it('opens models inline as a visible tab and preserves the profile editor', async () => {
    await act(async () => { renderer = create(createElement(AgentDetails, { agentId: 'a', active: true, onSaved: vi.fn(), onOpen: vi.fn(), onConversation: vi.fn(), onRun: vi.fn(), onSource: vi.fn() })) })
    expect(renderer.root.findByProps({ 'data-profile': true })).toBeTruthy()
    act(() => renderer.root.findAllByType('button').find((item) => item.children.includes('Models'))!.props.onClick())
    expect(renderer.root.findByProps({ 'data-model-editor': true })).toBeTruthy()
    expect(api.models).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'a', variant: 'panel' }))
    expect(api.models.mock.lastCall![0]).not.toHaveProperty('room')
  })
  it('reports unavailable/error summaries with retry without hiding other Agents', async () => {
    api.resource.mockReturnValue({ data: null, error: 'Model metadata unavailable', refresh: api.refresh })
    await act(async () => { renderer = create(createElement(AgentDirectory, { onDetails: vi.fn(), onOpen: vi.fn(), onCreate: vi.fn() })) })
    expect(renderer.root.findByProps({ 'aria-label': 'Configure Developer' })).toBeTruthy()
    act(() => renderer.root.findByProps({ role: 'alert' }).findByType('button').props.onClick())
    expect(api.refresh).toHaveBeenCalledOnce()
  })
})

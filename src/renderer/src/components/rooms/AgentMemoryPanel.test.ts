import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRecord } from '../../../../../kun/src/contracts/memory'
import i18n from '../../i18n'
import { AgentMemoryEntry } from './AgentMemoryEntry'
import { AgentMemoryPanel } from './AgentMemoryPanel'

const api = vi.hoisted(() => ({ request: vi.fn(), resource: vi.fn(), refresh: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: api.request, roomRequestId: () => 'request-one' }))
vi.mock('./agent-client', () => ({ agentPath: (id: string) => '/v1/agents/' + id, useAgentResource: api.resource }))
vi.mock('./RoomMessageBody', () => ({ RoomMessageBody: ({ body }: { body: string }) => createElement('p', {}, body) }))

const memory = MemoryRecord.parse({ id: 'mem-one', content: 'Keep the project build reproducible.', scope: 'user', revision: 3,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  agentContext: { schemaVersion: 1, agentId: 'agent-a', sourceConversationId: 'room-a', shared: false, locked: true },
  sources: [{ id: 'source-1', kind: 'user', trust: 'explicit-user', excerpt: 'Use reproducible builds.', locator: 'room:room-a/message:message-a' }],
  history: [{ revision: 2, changedAt: '2026-01-01T00:00:00Z', operation: 'update', snapshot: {
    content: 'Old build preference', tags: [], type: 'fact', authority: 'reference', confidence: 1, importance: .5, observedAt: '2026-01-01T00:00:00Z', sources: [] } }] })
const entry = { memory, fingerprint: 'a'.repeat(64) }

describe('Agent memory progressive lifecycle UI', () => {
  let renderer: ReactTestRenderer
  const updated = vi.fn(), source = vi.fn()
  const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('en')
    api.request.mockResolvedValue({ memory })
    api.resource.mockReturnValue({ data: { memories: [entry], available: true, candidates: [], jobs: [], conversations: [] }, error: '', refresh: api.refresh })
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
  const mountEntry = async () => act(async () => { renderer = create(createElement(AgentMemoryEntry, { agentId: 'agent-a', entry, onUpdated: updated, onSource: source })) })
  it('shows readable content and provenance before any edit form, cancel resets a reopened editor', async () => {
    await mountEntry()
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0)
    act(() => button('Correct').props.onClick())
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Uncommitted edit' } }))
    act(() => button('Cancel').props.onClick())
    act(() => button('Correct').props.onClick())
    expect(renderer.root.findByType('textarea').props.value).toBe(memory.content)
    expect(api.request).not.toHaveBeenCalled()
    act(() => button(i18n.t('agentsOpenSource')).props.onClick())
    expect(source).toHaveBeenCalledWith('room-a', 'message-a')
  })
  it('deduplicates repeated save clicks and sends the canonical fingerprint', async () => {
    await mountEntry()
    let finish!: (value: unknown) => void
    api.request.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    act(() => button('Correct').props.onClick())
    const save = button('Save').props.onClick
    act(() => { save(); save() })
    expect(api.request).toHaveBeenCalledOnce()
    expect(api.request).toHaveBeenCalledWith('/v1/agents/agent-a/memories/mem-one', 'PATCH', {
      content: memory.content, clientRequestId: 'request-one', expectedFingerprint: entry.fingerprint
    })
    await act(async () => finish({ memory }))
    expect(updated).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0)
  })
  it('preserves draft after a CAS conflict and offers reload', async () => {
    await mountEntry(); api.request.mockRejectedValue(new Error('memory changed; reload before editing'))
    act(() => button('Correct').props.onClick())
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: 'New preference' } }))
    await act(async () => button('Save').props.onClick())
    expect(renderer.root.findByType('textarea').props.value).toBe('New preference')
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('memory changed')
    act(() => button('Reload latest').props.onClick()); expect(updated).toHaveBeenCalledOnce()
  })
  it('requires confirmation for forgetting and a fresh exact ID for each irreversible erase attempt', async () => {
    await mountEntry()
    act(() => button('Forget').props.onClick())
    expect(api.request).not.toHaveBeenCalled()
    act(() => button('Cancel').props.onClick())
    act(() => button('Permanently erase').props.onClick())
    expect(button('Erase permanently').props.disabled).toBe(true)
    act(() => renderer.root.findByProps({ 'aria-label': 'Memory ID confirmation' }).props.onChange({ target: { value: memory.id } }))
    act(() => button('Cancel').props.onClick())
    act(() => button('Permanently erase').props.onClick())
    expect(button('Erase permanently').props.disabled).toBe(true)
    act(() => renderer.root.findByProps({ 'aria-label': 'Memory ID confirmation' }).props.onChange({ target: { value: memory.id } }))
    await act(async () => button('Erase permanently').props.onClick())
    expect(api.request).toHaveBeenCalledWith(expect.any(String), 'PATCH', expect.objectContaining({
      erase: true, eraseConfirmation: { memoryId: memory.id, irreversible: true }, expectedFingerprint: entry.fingerprint
    }))
  })
  it('opens a history diff and restores by revision with fingerprint CAS', async () => {
    await mountEntry()
    act(() => renderer.root.findAllByType('button').find((node) => node.children.some((value) => typeof value === 'string' && value.startsWith('Revision 2')))!.props.onClick())
    expect(renderer.root.findByProps({ className: 'memory-diff' }).children.length).toBeGreaterThan(0)
    await act(async () => button('Restore this version').props.onClick())
    expect(api.request).toHaveBeenCalledWith(expect.any(String), 'PATCH', expect.objectContaining({ rollbackRevision: 2, expectedFingerprint: entry.fingerprint }))
  })
  it('keeps overview, pending and history in the existing Agent memory panel', async () => {
    await act(async () => { renderer = create(createElement(AgentMemoryPanel, { agentId: 'agent-a', active: true, onSource: source })) })
    act(() => button('Pending review').props.onClick())
    expect(renderer.root.findAllByType('p').some((node) => node.children.includes('No memory changes need your decision.'))).toBe(true)
    act(() => button('History').props.onClick())
    expect(api.resource).toHaveBeenLastCalledWith('/v1/agents/agent-a/memories?include_deleted=true', true)
  })
})

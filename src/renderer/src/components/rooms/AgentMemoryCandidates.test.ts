import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentMemoryCandidate } from '../../../../../kun/src/agents/agent-memory-capture-types'
import i18n from '../../i18n'
import { AgentMemoryCandidates } from './AgentMemoryCandidates'

const api = vi.hoisted(() => ({ request: vi.fn(), resource: vi.fn(), refresh: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: api.request, roomRequestId: () => 'request-one' }))
vi.mock('./agent-client', () => ({ agentPath: (id: string) => '/v1/agents/' + id, useAgentResource: api.resource }))
vi.mock('./RoomMessageBody', () => ({ RoomMessageBody: ({ body }: { body: string }) => createElement('p', {}, body) }))
vi.mock('../memory/MemoryEvidence', () => ({ MemoryEvidence: () => null }))
const candidate: AgentMemoryCandidate = { id: 'held', phase: 'candidate', participantAgentId: 'agent-a', roomId: 'room-a',
  rootRequestId: 'root-a', status: 'pending', action: 'create', runId: 'run-a', sourceMessageIds: [],
  captureScope: { conversationId: 'room-a', taskId: 'task-a' }, reason: 'invalid-relation related: review required',
  candidate: { content: 'Remember report links.', type: 'preference', confidence: .9, importance: .7,
    observedAt: '2026-01-01T00:00:00Z', tags: [], sources: [] } }
let renderer: ReactTestRenderer
const updated = vi.fn()
const accept = () => renderer.root.findAllByType('button').find((node) => node.children.includes(i18n.t('agentsMemoryAccept')))!
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('en')
  api.request.mockResolvedValue({})
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
async function mount(value = candidate, target?: { content: string; fingerprint: string; disabled: boolean }) {
  api.resource.mockReturnValue({ data: { candidates: [{ candidate: value, revision: 0, target }], jobs: [] }, refresh: api.refresh })
  await act(async () => { renderer = create(createElement(AgentMemoryCandidates, { agentId: 'agent-a', active: true, onUpdated: updated })) })
}
it('offers scoped targetless acceptance, displays review reason and deduplicates repeated clicks', async () => {
  await mount()
  expect(accept().props.disabled).toBe(false)
  expect(JSON.stringify(renderer.toJSON())).toContain(candidate.reason)
  expect(JSON.stringify(renderer.toJSON())).not.toContain(i18n.t('agentsMemoryTargetMissing'))
  let finish!: () => void
  api.request.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
  const click = accept().props.onClick
  act(() => { click(); click() })
  expect(api.request).toHaveBeenCalledOnce()
  expect(api.request).toHaveBeenCalledWith('/v1/agents/agent-a/memory-candidates/held/decision', 'POST', {
    expectedRevision: 0, decision: 'allow', expectedTargetFingerprint: undefined, clientRequestId: 'request-one'
  })
  await act(async () => finish())
  expect(updated).toHaveBeenCalledOnce()
})
it.each([
  { ...candidate, action: 'update' as const },
  { ...candidate, action: 'supersede' as const },
  { ...candidate, targetId: 'missing-target' },
  { ...candidate, captureScope: undefined }
])('does not turn unavailable targets or unknown scope into creates', async (value) => {
  await mount(value)
  expect(accept().props.disabled).toBe(true)
  expect(api.request).not.toHaveBeenCalled()
})
it('keeps disabled targets blocked', async () => {
  await mount({ ...candidate, action: 'update', targetId: 'target' }, { content: 'Old value', fingerprint: 'a'.repeat(64), disabled: true })
  expect(accept().props.disabled).toBe(true)
})

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomRunDetail } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomMemoryReceipt } from './RoomMemoryReceipt'
const api = vi.hoisted(() => ({ resource: vi.fn(), refresh: vi.fn() }))
vi.mock('./agent-client', () => ({ agentPath: (id: string) => '/v1/agents/' + id, useAgentResource: api.resource }))
vi.mock('./AgentMemoryEntry', () => ({ AgentMemoryEntry: () => createElement('div', { 'data-current-memory': true }) }))
const context: RoomRunDetail['context'] = { memoryReceipt: { version: 1, state: 'prepared-input', preparedAt: '2026-10-01T00:00:00Z', inputHash: 'hash', entries: [{
  memoryId: 'mem-one', revision: 3, fingerprint: 'exact-fingerprint', sourceIds: ['source-one'], evidenceStatus: 'observed-success'
}] } }
describe('Rooms saved-input memory provenance', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('en'); api.resource.mockReturnValue({ data: null, error: '', refresh: api.refresh }) })
  afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals() })
  it('never substitutes eligible IDs for a missing actual input receipt', async () => {
    await act(async () => { renderer = create(createElement(RoomMemoryReceipt, { context: { memoryIds: ['eligible-only'] }, agentId: 'agent-a' })) })
    expect(renderer.toJSON()).toBeNull(); expect(api.resource).not.toHaveBeenCalled()
  })
  it('shows exact captured versions, then resolves only the selected Agent record on expansion', async () => {
    await act(async () => { renderer = create(createElement(RoomMemoryReceipt, { context, agentId: 'agent-a' })) })
    expect(JSON.stringify(renderer.toJSON())).toContain('Revision 3')
    expect(api.resource).toHaveBeenLastCalledWith('/v1/agents/agent-a/memories/mem-one', false)
    const detail = renderer.root.findAllByType('details').find((node) => node.props.onToggle)!
    act(() => detail.props.onToggle({ currentTarget: { open: true } }))
    expect(api.resource).toHaveBeenLastCalledWith('/v1/agents/agent-a/memories/mem-one', true)
  })
})

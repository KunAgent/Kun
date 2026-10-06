import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoreMemoryRecordJson } from '../../agent/kun-contract'
import i18n from '../../i18n'
import { InjectedMemoryDetail } from './injected-memory-details'
const api = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ updateMemory: api.update }) }))
const record: CoreMemoryRecordJson = { id: 'memory-1', revision: 2, content: 'Current project fact', scope: 'project', project: '/repo',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', sources: [{ id: 's1', kind: 'user', trust: 'explicit-user', excerpt: 'User supplied project fact' }] }
describe('injected memory current-record lookup', () => {
  let renderer: ReactTestRenderer
  const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!
  beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); await i18n.changeLanguage('en') })
  afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals() })
  it('reveals provenance when the asynchronous lookup resolves, preserving the historical snapshot', async () => {
    await act(async () => { renderer = create(createElement(InjectedMemoryDetail, { id: record.id, snapshot: 'Earlier injected content' })) })
    expect(button('Correct')).toBeUndefined()
    await act(async () => renderer.update(createElement(InjectedMemoryDetail, { id: record.id, snapshot: 'Earlier injected content', record })))
    expect(button('Correct')).toBeDefined()
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('User supplied project fact'); expect(text).toContain('Earlier injected content')
  })
  it('preserves an active draft during refreshed lookup and sends the revision actually edited', async () => {
    await act(async () => { renderer = create(createElement(InjectedMemoryDetail, { id: record.id, record })) })
    act(() => button('Correct').props.onClick())
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: 'My correction' } }))
    await act(async () => renderer.update(createElement(InjectedMemoryDetail, { id: record.id, record: { ...record, revision: 3, content: 'Concurrent change' } })))
    expect(renderer.root.findByType('textarea').props.value).toBe('My correction')
    api.update.mockRejectedValue(new Error('Revision conflict'))
    await act(async () => button('Save').props.onClick())
    expect(api.update).toHaveBeenCalledWith(record.id, { content: 'My correction', expectedRevision: 2 }, { workspace: undefined, project: '/repo' })
    expect(renderer.root.findByType('textarea').props.value).toBe('My correction')
    act(() => button('Cancel').props.onClick())
    act(() => button('Correct').props.onClick())
    expect(renderer.root.findByType('textarea').props.value).toBe('Concurrent change')
  })
})

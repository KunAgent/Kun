import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { useSettingsDraftControllers } from './use-settings-draft-controllers'

describe('settings draft registry', () => {
  it('resolves separate collaboration and project drafts before leaving', async () => {
    let registry!: ReturnType<typeof useSettingsDraftControllers>
    const Probe = () => { registry = useSettingsDraftControllers(); return null }
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(createElement(Probe)) })
    const saveCollaboration = vi.fn(async () => true)
    const saveProject = vi.fn(async () => false)
    registry.register('collaboration', { save: saveCollaboration, discard: vi.fn() })
    registry.register('project', { save: saveProject, discard: vi.fn() })
    expect(registry.hasPending()).toBe(true)
    expect(await registry.current()?.save()).toBe(false)
    expect(saveCollaboration).toHaveBeenCalledOnce()
    expect(saveProject).toHaveBeenCalledOnce()
    registry.register('project', null)
    expect(await registry.current()?.save()).toBe(true)
    registry.register('collaboration', null)
    expect(registry.hasPending()).toBe(false)
    act(() => renderer.unmount())
  })
})

import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomDrawerNavigation, useRoomDrawerNavigation } from './RoomDrawerNavigation'

function SavedPage({ name }: { name: string }) {
  const [draft, setDraft] = useState('')
  return createElement('input', { 'aria-label': name, value: draft, onChange: (event: { target: { value: string } }) => setDraft(event.target.value) })
}

describe('single Rooms drawer navigation stack', () => {
  let renderer: ReactTestRenderer
  let navigation: ReturnType<typeof useRoomDrawerNavigation>
  const focus = vi.fn()
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    focus.mockReset()
    vi.stubGlobal('document', { activeElement: { focus, isConnected: true } })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1 })
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
  function Harness({ roomId }: { roomId: string }) {
    navigation = useRoomDrawerNavigation(roomId)
    return createElement(RoomDrawerNavigation, { frames: navigation.frames, onBack: navigation.back,
      onClose: navigation.close, onSection: navigation.section,
      render: (target) => createElement(SavedPage, { name: target.kind }) })
  }
  it('keeps parent content mounted under reply/run/artifact details and restores it on back', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'room' })) })
    act(() => navigation.open({ kind: 'reply', messageId: 'root' }))
    act(() => renderer.root.findByProps({ 'aria-label': 'reply' }).props.onChange({ target: { value: 'Unsent draft' } }))
    act(() => navigation.open({ kind: 'run', runId: 'original-run' }))
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    expect(renderer.root.findByProps({ 'aria-label': 'reply' }).props.value).toBe('Unsent draft')
    expect(renderer.root.findAllByProps({ 'data-active-drawer-page': 'false' })).toHaveLength(1)
    act(() => navigation.open({ kind: 'content', reference: { kind: 'attachment', attachmentId: 'file' }, messageId: 'reply' }))
    expect(navigation.frames).toHaveLength(3)
    act(() => navigation.open({ kind: 'run', runId: 'original-run' }))
    expect(navigation.frames).toHaveLength(2)
    expect(navigation.frames.at(-1)!.target).toEqual({ kind: 'run', runId: 'original-run' })
    act(() => navigation.back())
    expect(renderer.root.findByProps({ 'aria-label': 'reply' }).props.value).toBe('Unsent draft')
    expect(focus).toHaveBeenCalled()
  })
  it('titles the run page as the Agent session', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'room' })) })
    act(() => navigation.open({ kind: 'run', runId: 'original-run' }))
    expect(JSON.stringify(renderer.toJSON())).toContain('Agent session')
  })
  it('docks the run page as a right sidebar that can expand to full overlay', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'room' })) })
    act(() => navigation.open({ kind: 'run', runId: 'original-run' }))
    const dialog = () => renderer.root.findByProps({ role: 'dialog' })
    const toggle = () => renderer.root.findByProps({ 'aria-label': 'Right sidebar' })
    expect(dialog().props.className).toContain('inset-y-0')
    expect(dialog().props.className).toContain('right-0')
    expect(dialog().props.className).not.toMatch(/inset-0/)
    expect(toggle().props['aria-pressed']).toBe(true)
    act(() => toggle().props.onClick())
    expect(dialog().props.className).toContain('inset-0')
    expect(toggle().props['aria-pressed']).toBe(false)
  })
  it('keeps non-run drawer pages as a full overlay without the sidebar toggle', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'room' })) })
    act(() => navigation.open({ kind: 'reply', messageId: 'root' }))
    expect(renderer.root.findByProps({ role: 'dialog' }).props.className).toContain('inset-0')
    expect(renderer.root.findAllByProps({ 'aria-label': 'Right sidebar' })).toHaveLength(0)
  })
  it('clears the old room stack and never resurrects it by switching back', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'room' })) })
    act(() => navigation.open({ kind: 'reply', messageId: 'root' }))
    act(() => renderer.update(createElement(Harness, { roomId: 'other' })))
    expect(navigation.frames).toHaveLength(0)
    act(() => renderer.update(createElement(Harness, { roomId: 'room' })))
    expect(navigation.frames).toHaveLength(0)
  })
})

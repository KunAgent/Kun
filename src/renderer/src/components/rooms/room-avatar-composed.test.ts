import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvatarCompositionLease } from './room-avatar-composition-cache'
import type { KunComposedAvatarReference } from '@shared/rooms-api'

const queued = vi.hoisted(() => new Map<string, {
  lease: AvatarCompositionLease
  resolve: (value: string) => void
  reject: (error: Error) => void
}>())

vi.mock('./room-avatar-compositor', () => ({
  avatarRenderRequest: (parts: { face: string }, size: number, dpr: number) => ({ key: `${parts.face}:${size}:${dpr}` }),
  acquireComposedAvatar: ({ key }: { key: string }) => queued.get(key)!.lease
}))

import { RoomAvatar } from './RoomAvatar'

function enqueue(key: string) {
  let resolve!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej })
  const value = { lease: { promise, release: vi.fn() }, resolve, reject }
  queued.set(key, value)
  return value
}

const normal: KunComposedAvatarReference = {
  kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', bg: '#f7f5ef' }
}
const happy: KunComposedAvatarReference = { ...normal, parts: { ...normal.parts, face: 'happy' } }
let renderer: ReactTestRenderer | undefined

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  queued.clear()
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  vi.unstubAllGlobals()
})

describe('composed RoomAvatar', () => {
  it('lets the surrounding surface show through a transparent composition', async () => {
    const loaded = enqueue('normal:38:1')
    const avatar = { ...normal, parts: { ...normal.parts, bg: 'transparent' } }
    await act(async () => { renderer = create(createElement(RoomAvatar, { avatar, label: 'Transparent' })) })
    await act(async () => loaded.resolve('blob:transparent'))
    expect(renderer!.root.findByProps({ className: 'rooms-avatar' }).props.style.background).toBe('transparent')
  })

  it('shows a composed user avatar, ignoring stale completion after a quick edit', async () => {
    const first = enqueue('normal:38:1')
    const second = enqueue('happy:38:1')
    await act(async () => {
      renderer = create(createElement(RoomAvatar, { avatar: normal, user: true, label: 'You' }))
    })
    expect(renderer!.root.findByType('img').props.src).toContain('kun_greet.png')
    await act(async () => renderer!.update(createElement(RoomAvatar, { avatar: happy, user: true, label: 'You' })))
    expect(first.lease.release).toHaveBeenCalledOnce()
    await act(async () => second.resolve('blob:happy'))
    expect(renderer!.root.findByType('img').props.src).toBe('blob:happy')
    expect(renderer!.root.findByType('img').props['data-composed']).toBe(true)
    await act(async () => first.resolve('blob:normal'))
    expect(renderer!.root.findByType('img').props.src).toBe('blob:happy')
    await act(async () => renderer!.unmount())
    renderer = undefined
    expect(second.lease.release).toHaveBeenCalledOnce()
  })

  it('retains identity fallback after a load error and releases its lease when cleared', async () => {
    const failed = enqueue('normal:38:1')
    await act(async () => {
      renderer = create(createElement(RoomAvatar, { avatar: normal, id: 'developer', label: 'Coder' }))
    })
    await act(async () => failed.reject(new Error('Missing layer')))
    expect(renderer!.root.findByProps({ 'data-avatar-id': 'coder' })).toBeDefined()
    await act(async () => renderer!.update(createElement(RoomAvatar, { avatar: null, id: 'user', label: 'You' })))
    expect(renderer!.root.findByType('img').props.src).toContain('kun_greet.png')
    expect(failed.lease.release).toHaveBeenCalledOnce()
  })

  it('falls back to identity art if the composed output image cannot display', async () => {
    const loaded = enqueue('normal:38:1')
    await act(async () => {
      renderer = create(createElement(RoomAvatar, { avatar: normal, id: 'developer', label: 'Coder' }))
    })
    await act(async () => loaded.resolve('blob:broken'))
    await act(async () => renderer!.root.findByType('img').props.onError())
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-avatar-id': 'coder' })).toBeDefined()
  })

  it('recomposes at the new pixel density when moving a window between displays', async () => {
    let resize: (() => void) | undefined
    const fakeWindow = { devicePixelRatio: 1,
      addEventListener: vi.fn((_event: string, callback: () => void) => { resize = callback }),
      removeEventListener: vi.fn() }
    vi.stubGlobal('window', fakeWindow)
    const first = enqueue('normal:38:1')
    const retina = enqueue('normal:38:2')
    await act(async () => {
      renderer = create(createElement(RoomAvatar, { avatar: normal, label: 'Density' }))
    })
    await act(async () => first.resolve('blob:1x'))
    expect(renderer!.root.findByType('img').props.src).toBe('blob:1x')
    await act(async () => { fakeWindow.devicePixelRatio = 2; resize?.() })
    expect(first.lease.release).toHaveBeenCalledOnce()
    await act(async () => retina.resolve('blob:2x'))
    expect(renderer!.root.findByType('img').props.src).toBe('blob:2x')
  })

  it('preserves the existing Kun user fallback when composition fails', async () => {
    const failed = enqueue('normal:38:1')
    await act(async () => {
      renderer = create(createElement(RoomAvatar, { avatar: normal, user: true, label: 'You' }))
    })
    await act(async () => failed.reject(new Error('Missing layer')))
    expect(renderer!.root.findByType('img').props.src).toContain('kun_greet.png')
  })
})

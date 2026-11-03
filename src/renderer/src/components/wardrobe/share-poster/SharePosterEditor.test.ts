// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeKunAvatarParts } from '@shared/rooms-api'
import en from '../../../locales/en/common/wardrobe-share.json'
import { SharePosterEditor, type PosterActions } from './SharePosterEditor'
const mock = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('./share-poster-render', () => ({ renderSharePoster: mock.render }))
const input = { look: normalizeKunAvatarParts(), code: 'K7QM4XPA', link: 'https://kun-agent.com/invite/K7QM4XPA', language: 'en' }
const resources = { layerUrl: () => '', artUrl: () => '' }
let root: Root, host: HTMLDivElement
let actions: PosterActions
const render = async (next = input) => { await act(async () => root.render(createElement(SharePosterEditor, { input: next, labels: en.wardrobeShare, resources, actions, onRetry: vi.fn() }))) }
const button = (text: string) => Array.from(host.querySelectorAll('button')).find((node) => node.textContent === text)!
const click = async (text: string) => { await act(async () => button(text).click()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`); URL.revokeObjectURL = vi.fn()
  mock.render.mockReset().mockResolvedValue(new Blob(['PNG'], { type: 'image/png' }))
  actions = { save: vi.fn().mockResolvedValue({ status: 'saved', path: '/tmp/test.png' }), copy: vi.fn().mockResolvedValue(undefined), copyLink: vi.fn().mockResolvedValue(undefined), reveal: vi.fn().mockResolvedValue(undefined) }
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
describe('share dialog state flow', () => {
  it('disables export until rendered and retains the previous preview while changing style', async () => {
    let resolve: (value: Blob) => void = () => undefined
    mock.render.mockReturnValueOnce(new Promise<Blob>((done) => { resolve = done }))
    await render(); expect(button(en.wardrobeShare.save).disabled).toBe(true)
    await act(async () => resolve(new Blob(['PNG']))); expect(button(en.wardrobeShare.save).disabled).toBe(false)
    const previous = host.querySelector('img')!.src
    mock.render.mockReturnValueOnce(new Promise<Blob>((done) => { resolve = done }))
    await click(en.wardrobeShare.sunset)
    expect(host.querySelector('img')!.src).toBe(previous); expect(button(en.wardrobeShare.save).disabled).toBe(true)
    await act(async () => resolve(new Blob(['new']))); expect(host.querySelector('img')!.src).not.toBe(previous)
  })
  it('saves and reveals, copies image and link, and treats cancellation silently', async () => {
    await render(); await click(en.wardrobeShare.save)
    expect(host.textContent).toContain(en.wardrobeShare.saved)
    await click(en.wardrobeShare.reveal); expect(actions.reveal).toHaveBeenCalledWith('/tmp/test.png')
    await click(en.wardrobeShare.copyImage); expect(host.textContent).toContain(en.wardrobeShare.copied)
    await click(en.wardrobeShare.copyLink); expect(actions.copyLink).toHaveBeenCalledWith(input.link)
    vi.mocked(actions.save).mockResolvedValue({ status: 'cancelled' }); await click(en.wardrobeShare.save)
    expect(host.textContent).not.toContain(en.wardrobeShare.failed); expect(host.textContent).not.toContain(en.wardrobeShare.saved)
  })
  it('falls back to save after clipboard failure and shows long-press guidance on mobile', async () => {
    vi.mocked(actions.copy).mockRejectedValue(new Error('denied'))
    vi.mocked(actions.save).mockResolvedValue({ status: 'hold' })
    await render(); await click(en.wardrobeShare.copyImage)
    expect(actions.save).toHaveBeenCalledOnce(); expect(host.textContent).toContain(en.wardrobeShare.fallback); expect(host.textContent).toContain(en.wardrobeShare.hold)
  })
  it('does not render or export a missing invitation', async () => {
    await render({ ...input, code: '' })
    expect(mock.render).not.toHaveBeenCalled(); expect(host.textContent).toContain(en.wardrobeShare.missing)
    expect(button(en.wardrobeShare.save).disabled).toBe(true)
  })
  it('ignores stale compositions and releases object URLs on close', async () => {
    let stale: (blob: Blob) => void = () => undefined
    mock.render.mockReturnValueOnce(new Promise<Blob>((done) => { stale = done }))
    await render(); await click(en.wardrobeShare.square)
    const current = host.querySelector('img')!.src
    await act(async () => stale(new Blob(['old'])))
    expect(host.querySelector('img')!.src).toBe(current)
    await act(async () => root.render(null)); expect(URL.revokeObjectURL).toHaveBeenCalledWith(current)
  })
})

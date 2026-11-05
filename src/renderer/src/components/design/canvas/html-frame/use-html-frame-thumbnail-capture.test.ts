import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignHtmlPreviewWebviewElement } from '../../DesignHtmlPreviewHost'
import { captureHtmlFrameThumbnail, useHtmlFrameThumbnailCapture } from './use-html-frame-thumbnail-capture'

const url = 'file:///preview.html?revision=1'
const pixels = 'data:image/png;base64,aW1hZ2U='
function guest() {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 1280, height: 800 }),
    resize: vi.fn(() => ({ toDataURL: () => pixels })),
    toDataURL: () => pixels
  }
  const events = new Map<string, EventListener>()
  const view = {
    capturePage: vi.fn(async () => image),
    getURL: vi.fn(() => url),
    isLoading: vi.fn(() => false),
    addEventListener: (name: string, handler: EventListener) => events.set(name, handler),
    removeEventListener: (name: string) => events.delete(name)
  } as unknown as DesignHtmlPreviewWebviewElement
  return { view, image, events }
}

describe('thumbnail capture lifecycle', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })
  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
  })
  const Harness = (props: Parameters<typeof useHtmlFrameThumbnailCapture>[0]) => {
    useHtmlFrameThumbnailCapture(props)
    return null
  }

  it('captures native pixels and downsamples without reflowing the HTML viewport', async () => {
    const { view, image } = guest()
    expect(await captureHtmlFrameThumbnail(view)).toBe(pixels)
    expect(image.resize).toHaveBeenCalledWith({ width: 768, height: 480, quality: 'best' })
  })

  it('rejects empty captures instead of caching a blank design', async () => {
    const { view, image } = guest()
    image.isEmpty = () => true
    await expect(captureHtmlFrameThumbnail(view)).rejects.toThrow('no pixels')
  })

  it('publishes a settled capture once', async () => {
    const { view } = guest()
    const onCapture = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, {
        shapeId: 'board', captureKey: 'rev1', webview: view, webviewUrl: url, ready: true, enabled: true, onCapture
      }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(onCapture).toHaveBeenCalledExactlyOnceWith('board', 'rev1', pixels)
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  it('releases a failed loading slot without publishing stale-page pixels', async () => {
    const { view } = guest()
    vi.mocked(view.getURL!).mockReturnValue('file:///other.html')
    const onCapture = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, {
        shapeId: 'board', captureKey: 'rev1', webview: view, webviewUrl: url, ready: true, enabled: true, onCapture
      }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(view.capturePage).not.toHaveBeenCalled()
    expect(onCapture).toHaveBeenCalledExactlyOnceWith('board', 'rev1', null)
  })

  it('waits for finish-load rather than capturing at dom-ready', async () => {
    const { view, events } = guest()
    vi.mocked(view.isLoading!).mockReturnValue(true)
    const onCapture = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, {
        shapeId: 'board', captureKey: 'rev1', webview: view, webviewUrl: url, ready: true, enabled: true, onCapture
      }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(view.capturePage).not.toHaveBeenCalled()
    await act(async () => { events.get('did-finish-load')?.(new Event('did-finish-load')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(onCapture).toHaveBeenCalledExactlyOnceWith('board', 'rev1', pixels)
  })

  it('drops an asynchronous capture after switching revision or unmounting', async () => {
    const { view, image } = guest()
    let resolveCapture!: (value: unknown) => void
    vi.mocked(view.capturePage!).mockReturnValue(new Promise((resolve) => { resolveCapture = resolve }) as never)
    const onCapture = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, {
        shapeId: 'board', captureKey: 'rev1', webview: view, webviewUrl: url, ready: true, enabled: true, onCapture
      }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    await act(async () => renderer?.unmount())
    renderer = undefined
    vi.mocked(view.getURL!).mockImplementation(() => { throw new Error('detached') })
    await act(async () => resolveCapture(image))
    expect(onCapture).not.toHaveBeenCalled()
  })
})

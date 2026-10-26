// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHtmlFrameElementSelection } from './use-html-frame-element-selection'

type Options = Parameters<typeof useHtmlFrameElementSelection>[0]
type Result = ReturnType<typeof useHtmlFrameElementSelection>
const BOUNDS = { left: 0, top: 0, width: 100, height: 100 }
const click = () => result.selectClient(40, 40, BOUNDS)
const node = (tagName: string, selector: string) => ({
  tagName, selector, selectorIsUnique: true, text: 'Take over', html: `<${tagName}>Take over</${tagName}>`,
  editableText: true, rect: { left: 10, top: 10, width: 80, height: 30 }
})
const payload = { ok: true, viewportWidth: 1000, viewportHeight: 1000,
  chain: [node('span', '#label'), node('button', '#take'), node('section', '#card')] }
let renderer: ReactTestRenderer | undefined
let result: Result
function Harness({ options }: { options: Options }) {
  result = useHtmlFrameElementSelection(options)
  return null
}
function options(executeScript: Options['executeScript']): Options {
  return {
    artifact: { id: 'a', title: 'Page', relativePath: 'page.html', kind: 'html', versions: [],
      createdAt: '', updatedAt: '' },
    canvasWidth: 1000, canvasHeight: 1000, enabled: true, interactive: false,
    executeScript, shapeId: 'frame', previewRevision: 1,
    setFileError: vi.fn(), setLocalPreviewError: vi.fn(), onUseElementAsContext: vi.fn()
  }
}
async function mount(opts: Options) {
  await act(async () => { renderer = create(createElement(Harness, { options: opts })) })
}
afterEach(async () => {
  if (renderer) await act(async () => { renderer!.unmount() })
  renderer = undefined
})

describe('HTML component selection lifecycle', () => {
  it('selects by point, then walks parent and inner element', async () => {
    const execute = vi.fn(() => Promise.resolve(payload))
    await mount(options(execute))
    await act(async () => click())
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.selectedElementContext?.selector).toBe('#take')
    expect(result.canDrillToHit).toBe(true)
    act(() => result.selectParentElement())
    expect(result.selectedElementContext?.selector).toBe('#card')
    act(() => result.selectHitElement())
    expect(result.selectedElementContext?.selector).toBe('#label')
    expect(result.canSelectParent).toBe(true)
  })

  it('hovers from the local element map without asking the page again', async () => {
    vi.useFakeTimers()
    try {
      const box = (parent: number, x: number, w: number, tagName: string) => ({
        parent, depth: parent + 2, x, y: 0, w, h: 50, tagName, text: tagName
      })
      const mapPayload = { ok: true, token: 1, viewportWidth: 100, viewportHeight: 100,
        boxes: [box(-1, 0, 100, 'section'), box(0, 10, 40, 'button')] }
      const execute = vi.fn(() => Promise.resolve(mapPayload))
      await mount(options(execute))
      await act(async () => { result.hoverClient(2, 2, BOUNDS) })
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      await act(async () => { result.hoverClient(2, 2, BOUNDS) })
      expect(result.hoverRect).toEqual({ left: 10, top: 0, width: 40, height: 50 })
      expect(result.hoverLabel).toBe('Button · button')
      const calls = execute.mock.calls.length
      await act(async () => { result.hoverClient(3, 2, BOUNDS); result.hoverClient(4, 2, BOUNDS) })
      expect(execute.mock.calls.length).toBe(calls)
      await act(async () => { result.leave(); await vi.advanceTimersByTimeAsync(200) })
      expect(result.hoverRect).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the reference when the element cannot be found again after a revision change', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn((code: string) => Promise.resolve(
        code.includes("reason: 'ambiguous'") ? { ok: false, reason: 'ambiguous' } : payload
      ))
      const opts = options(execute)
      await mount(opts)
      await act(async () => click())
      expect(result.selectedElementContext?.selector).toBe('#take')
      await act(async () => {
        renderer!.update(createElement(Harness, { options: { ...opts, previewRevision: 2 } }))
      })
      // Hidden at once: the old reference never points at the new document.
      expect(result.selectedElementContext).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(result.selectedElementContext).toBeNull()
      expect(opts.onUseElementAsContext).toHaveBeenLastCalledWith(null)
      expect(result.selectionError).toContain('changed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an id-anchored selection across a revision change', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn((code: string) => Promise.resolve(
        code.includes("reason: 'ambiguous'")
          ? { ...payload, chain: [node('button', '#take'), node('section', '#card')] }
          : payload
      ))
      const opts = options(execute)
      await mount(opts)
      await act(async () => click())
      expect(result.selectedElementContext?.selector).toBe('#take')
      await act(async () => {
        renderer!.update(createElement(Harness, { options: { ...opts, previewRevision: 2 } }))
      })
      expect(result.selectedElementContext).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(result.selectedElementContext?.selector).toBe('#take')
      expect(result.selectionError).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears an empty click without reporting a file failure', async () => {
    const opts = options(vi.fn().mockResolvedValueOnce(payload).mockResolvedValueOnce({ ok: false, reason: 'empty' }))
    await mount(opts)
    await act(async () => click())
    await act(async () => click())
    expect(result.selectedElementContext).toBeNull()
    expect(opts.setFileError).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHtmlFrameElementSelection } from './use-html-frame-element-selection'

type Options = Parameters<typeof useHtmlFrameElementSelection>[0]
type Result = ReturnType<typeof useHtmlFrameElementSelection>
const event = () => ({
  button: 0, clientX: 40, clientY: 40,
  preventDefault: vi.fn(), stopPropagation: vi.fn(),
  currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }
}) as unknown as React.PointerEvent<HTMLDivElement>
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
    canvasWidth: 1000, canvasHeight: 1000, editing: true, interactive: false,
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
  it('keeps a pending click when hover occurs and retains parent/drill navigation', async () => {
    let resolve!: (value: unknown) => void
    const execute = vi.fn(() => new Promise<unknown>((done) => { resolve = done }))
    await mount(options(execute))
    act(() => { result.selectElementAt(event()); result.hoverAt(event()) })
    expect(execute).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(payload) })
    expect(result.selectedElementContext?.selector).toBe('#take')
    expect(result.canDrillToHit).toBe(true)
    act(() => result.selectParentElement())
    expect(result.selectedElementContext?.selector).toBe('#card')
    act(() => result.selectHitElement())
    expect(result.selectedElementContext?.selector).toBe('#label')
    expect(result.canSelectParent).toBe(true)
  })

  it('discards a hover response arriving after pointer leave', async () => {
    let resolve!: (value: unknown) => void
    await mount(options(() => new Promise((done) => { resolve = done })))
    act(() => { result.hoverAt(event()); result.clearHover() })
    await act(async () => { resolve(payload) })
    expect(result.hoverRect).toBeNull()
  })

  it('invalidates references on revision changes instead of rebinding to a sibling', async () => {
    const opts = options(() => Promise.resolve(payload))
    await mount(opts)
    await act(async () => result.selectElementAt(event()))
    expect(result.selectedElementContext?.selector).toBe('#take')
    await act(async () => {
      renderer!.update(createElement(Harness, { options: { ...opts, previewRevision: 2 } }))
    })
    expect(result.selectedElementContext).toBeNull()
    expect(opts.onUseElementAsContext).toHaveBeenLastCalledWith(null)
    expect(result.selectionError).toContain('changed')
  })

  it('clears an empty click without reporting a file failure', async () => {
    const opts = options(vi.fn().mockResolvedValueOnce(payload).mockResolvedValueOnce({ ok: false, reason: 'empty' }))
    await mount(opts)
    await act(async () => result.selectElementAt(event()))
    await act(async () => result.selectElementAt(event()))
    expect(result.selectedElementContext).toBeNull()
    expect(opts.setFileError).not.toHaveBeenCalled()
  })
})

import { createElement, useEffect, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceOfficePreviewSuccess,
  WorkspacePresentationViewReference,
  WorkspacePresentationViewSource
} from '@shared/office-document'
import type { WorkspacePptxDeckProps } from './WorkspacePptxDeck'

const deckMocks = vi.hoisted(() => ({
  slideCount: 4,
  props: [] as WorkspacePptxDeckProps[],
  loads: 0
}))

// The real deck parses with Wasm in a worker; the shell only needs its callbacks.
vi.mock('./WorkspacePptxDeck', () => ({
  WorkspacePptxDeck: (props: WorkspacePptxDeckProps): ReactElement => {
    deckMocks.props.push(props)
    useEffect(() => {
      deckMocks.loads += 1
      void Promise.resolve().then(() => props.onLoad(deckMocks.slideCount))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.source])
    return createElement(
      'nav',
      { 'aria-label': 'Slide thumbnails', 'data-mode': props.mode },
      props.showThumbnails
        ? Array.from({ length: deckMocks.slideCount }, (_, index) => createElement('button', {
          key: index,
          'aria-label': `Go to slide ${index + 1}`,
          'data-changed': props.changedSlides.has(index + 1) || undefined,
          onClick: () => props.onSelectSlide(index + 1)
        }))
        : null
    )
  }
}))

import { requestKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'
import { WorkspacePptxPreview } from './WorkspacePptxPreview'
import { steppedOfficeZoom } from './WorkspaceOfficeToolbar'

function preview(name: string, sha: string): WorkspaceOfficePreviewSuccess {
  return {
    ok: true,
    path: `/repo/${name}`,
    name,
    sourceFormat: name.endsWith('.ppt') ? 'ppt' : 'pptx',
    renderFormat: 'pptx',
    viewer: 'presentation',
    size: 3,
    mtimeMs: 1,
    sourceSha256: sha,
    data: new Uint8Array([sha.charCodeAt(0), 2, 3])
  }
}

type ViewChange = (
  view: WorkspacePresentationViewReference | null,
  source: WorkspacePresentationViewSource
) => void

describe('WorkspacePptxPreview', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined
  let additionalRenderers: ReactTestRenderer[]

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('window', Object.assign(dom.window, {
      kunGui: { openExternal: vi.fn(async () => undefined) }
    }))
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Element', dom.window.Element)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    const browserWindow = dom.window as unknown as typeof globalThis
    vi.stubGlobal('Event', browserWindow.Event)
    vi.stubGlobal('KeyboardEvent', browserWindow.KeyboardEvent)
    deckMocks.slideCount = 4
    deckMocks.props = []
    deckMocks.loads = 0
    additionalRenderers = []
  })

  afterEach(async () => {
    for (const additional of additionalRenderers) {
      await act(async () => additional.unmount())
    }
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    dom.window.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function mount(element: ReactElement): Promise<ReactTestRenderer> {
    let mounted!: ReactTestRenderer
    await act(async () => {
      mounted = create(element, { createNodeMock })
      await flushPromises()
    })
    return mounted
  }

  it('reports initial and navigated slides and source-scoped cleanup', async () => {
    const onPresentationViewChange = vi.fn<ViewChange>()
    const sourceA = preview('deck.pptx', 'a'.repeat(64))
    renderer = await mount(createElement(WorkspacePptxPreview, {
      result: sourceA,
      loading: false,
      onPresentationViewChange
    }))

    expect(lastReportedView(onPresentationViewChange)).toEqual(expect.objectContaining({
      path: '/repo/deck.pptx',
      sourceSha256: 'a'.repeat(64),
      slide: 1,
      slideCount: 4
    }))
    expect(toolbarSummary()).toBe('Slide 1 of 4')
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next slide' }).props.onClick())
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(2)
    expect(lastDeckProps().slideIndex).toBe(1)

    await act(async () => requestKnowledgeSourceNavigation({
      filePath: sourceA.path,
      location: { kind: 'presentation', slideStart: 3, slideEnd: 3 }
    }))
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(3)
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Go to slide 4' }).props.onClick())
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(4)

    const sourceB = preview('deck.pptx', 'b'.repeat(64))
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: sourceB,
        loading: false,
        onPresentationViewChange
      }))
      await flushPromises()
    })
    expect(onPresentationViewChange).toHaveBeenCalledWith(null, {
      path: sourceA.path,
      sourceSha256: sourceA.sourceSha256
    })
    // A reload of the same deck (an edit landed) keeps the slide on screen.
    expect(lastReportedView(onPresentationViewChange)).toEqual(expect.objectContaining({
      sourceSha256: sourceB.sourceSha256,
      slide: 4
    }))
    expect(lastDeckProps().slideIndex).toBe(3)

    const otherDeck = preview('other.pptx', 'c'.repeat(64))
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: otherDeck,
        loading: false,
        onPresentationViewChange
      }))
      await flushPromises()
    })
    expect(lastReportedView(onPresentationViewChange)).toEqual(expect.objectContaining({
      path: '/repo/other.pptx',
      slide: 1
    }))

    await act(async () => renderer?.unmount())
    renderer = undefined
    expect(onPresentationViewChange).toHaveBeenCalledWith(null, {
      path: otherDeck.path,
      sourceSha256: otherDeck.sourceSha256
    })
  })

  it('keeps the parsed deck when the same bytes are read again', async () => {
    const first = preview('deck.pptx', 'a'.repeat(64))
    renderer = await mount(createElement(WorkspacePptxPreview, { result: first, loading: false }))
    const firstSource = lastDeckProps().source
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: { ...first, data: new Uint8Array(first.data) },
        loading: false
      }))
      await flushPromises()
    })
    expect(lastDeckProps().source).toBe(firstSource)
    expect(deckMocks.loads).toBe(1)
  })

  it('follows slides the reader scrolls to in the continuous deck', async () => {
    const onPresentationViewChange = vi.fn<ViewChange>()
    renderer = await mount(createElement(WorkspacePptxPreview, {
      result: preview('deck.pptx', 'a'.repeat(64)),
      loading: false,
      onPresentationViewChange
    }))
    expect(lastDeckProps().mode).toBe('continuous')
    await act(async () => lastDeckProps().onSlideChange(2))
    expect(toolbarSummary()).toBe('Slide 3 of 4')
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(3)
    const reports = onPresentationViewChange.mock.calls.length
    await act(async () => lastDeckProps().onSlideChange(2))
    expect(onPresentationViewChange.mock.calls).toHaveLength(reports)
  })

  it('keeps a jumped-to slide while the deck settles its scroll', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const onPresentationViewChange = vi.fn<ViewChange>()
    renderer = await mount(createElement(WorkspacePptxPreview, {
      result: preview('deck.pptx', 'a'.repeat(64)),
      loading: false,
      onPresentationViewChange
    }))
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Go to slide 4' }).props.onClick())
    // The last slide cannot scroll to the top, so the deck reports slide 3.
    await act(async () => lastDeckProps().onSlideChange(2))
    expect(toolbarSummary()).toBe('Slide 4 of 4')
    now.mockReturnValue(2_000)
    await act(async () => lastDeckProps().onSlideChange(2))
    expect(toolbarSummary()).toBe('Slide 3 of 4')
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(3)
    now.mockRestore()
  })

  it('applies global navigation keys only to the keyboard-active preview', async () => {
    const onPrimaryViewChange = vi.fn<ViewChange>()
    const onSecondaryViewChange = vi.fn<ViewChange>()
    const primary = preview('primary.pptx', 'a'.repeat(64))
    const secondary = preview('secondary.pptx', 'b'.repeat(64))
    const renderPreview = (
      result: WorkspaceOfficePreviewSuccess,
      keyboardActive: boolean,
      onPresentationViewChange: ViewChange
    ) => createElement(WorkspacePptxPreview, {
      result,
      loading: false,
      keyboardActive,
      onPresentationViewChange
    })

    renderer = await mount(renderPreview(primary, true, onPrimaryViewChange))
    const secondaryRenderer = await mount(renderPreview(secondary, false, onSecondaryViewChange))
    additionalRenderers.push(secondaryRenderer)
    await dispatchKey('ArrowRight')
    expect(lastReportedView(onPrimaryViewChange)?.slide).toBe(2)
    expect(lastReportedView(onSecondaryViewChange)?.slide).toBe(1)

    await act(async () => {
      renderer?.update(renderPreview(primary, false, onPrimaryViewChange))
      secondaryRenderer.update(renderPreview(secondary, true, onSecondaryViewChange))
    })
    await dispatchKey('ArrowRight')
    await dispatchKey('End')
    expect(lastReportedView(onPrimaryViewChange)?.slide).toBe(2)
    expect(lastReportedView(onSecondaryViewChange)?.slide).toBe(4)

    const field = document.createElement('input')
    document.body.append(field)
    await dispatchKey('Home', field)
    expect(lastReportedView(onSecondaryViewChange)?.slide).toBe(4)
  })

  it('zooms by semantic mode and by preset steps from the resolved zoom', async () => {
    renderer = await mount(createElement(WorkspacePptxPreview, {
      result: preview('deck.pptx', 'a'.repeat(64)),
      loading: false
    }))
    expect(lastDeckProps().zoom).toBe('fit-page')
    await act(async () => lastDeckProps().onZoomChange({ level: 'fit-page', resolvedZoom: 62 }))
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Zoom in' }).props.onClick())
    expect(lastDeckProps().zoom).toBe(75)
    await act(async () => renderer?.root.findByType('select').props.onChange({ target: { value: 'fit-width' } }))
    expect(lastDeckProps().zoom).toBe('fit-width')
    expect(steppedOfficeZoom(100, 1)).toBe(125)
    expect(steppedOfficeZoom(100, -1)).toBe(75)
    expect(steppedOfficeZoom(300, 1)).toBe(300)
    expect(steppedOfficeZoom(20, -1)).toBe(25)
  })

  it('hides the rail for a single slide and passes changed slides to it', async () => {
    deckMocks.slideCount = 1
    renderer = await mount(createElement(WorkspacePptxPreview, {
      result: preview('one.pptx', 'a'.repeat(64)),
      loading: false
    }))
    expect(lastDeckProps().showThumbnails).toBe(false)
    expect(renderer.root.findByProps({ 'aria-label': 'Next slide' }).props.disabled).toBe(true)

    deckMocks.slideCount = 3
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: preview('three.pptx', 'b'.repeat(64)),
        loading: false,
        changedSlides: [2]
      }))
      await flushPromises()
    })
    expect(lastDeckProps().showThumbnails).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'Go to slide 2' }).props['data-changed']).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'Go to slide 1' }).props['data-changed']).toBeUndefined()
  })

  it('reports selected slide text from the slide that holds it', async () => {
    const onSelectionChange = vi.fn()
    renderer = await mount(createElement(WorkspacePptxPreview, {
      result: preview('deck.pptx', 'a'.repeat(64)),
      loading: false,
      onSelectionChange
    }))
    const host = renderer.root.findByProps({ 'data-pptx-canvas-viewport': 'true' })
    const hostNode = deckHost
    expect(host).toBeTruthy()
    const slide = document.createElement('section')
    slide.dataset.rpvSlideIndex = '2'
    slide.textContent = 'Quarterly revenue'
    hostNode!.append(slide)
    document.body.append(hostNode!)
    const range = document.createRange()
    range.selectNodeContents(slide)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceKind: 'presentation',
      text: 'Quarterly revenue',
      slide: 3
    }))
  })

  it('presents fullscreen one slide at a time and hides audience controls after two seconds', async () => {
    vi.useFakeTimers()
    let fullscreenElement: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement
    })
    const requestFullscreen = vi.fn(function (this: HTMLElement) {
      fullscreenElement = this
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    Object.defineProperty(dom.window.HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen
    })

    renderer = await mount(createElement(WorkspacePptxPreview, {
      result: preview('deck.pptx', 'a'.repeat(64)),
      loading: false
    }))
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': 'Enter fullscreen' }).props.onClick()
      await flushPromises()
    })
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ 'data-pptx-fullscreen': 'true' })).toBeTruthy()
    expect(lastDeckProps()).toEqual(expect.objectContaining({
      mode: 'slide',
      zoom: 'fit-page',
      showThumbnails: false
    }))
    expect(renderer.root.findByProps({ 'data-pptx-fullscreen-controls': 'visible' })).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })
    expect(renderer.root.findByProps({ 'data-pptx-fullscreen-controls': 'hidden' })).toBeTruthy()
    await act(async () => renderer?.root.findByProps({ 'data-pptx-fullscreen': 'true' }).props.onPointerMove())
    expect(renderer.root.findByProps({ 'data-pptx-fullscreen-controls': 'visible' })).toBeTruthy()

    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': 'Exit fullscreen' }).props.onClick()
      await flushPromises()
    })
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ 'data-pptx-fullscreen': 'false' })).toBeTruthy()
    expect(lastDeckProps().mode).toBe('continuous')

    await dispatchKey('f')
    expect(requestFullscreen).toHaveBeenCalledTimes(2)
  })

  function toolbarSummary(): string | undefined {
    return renderer?.root.findByProps({ 'aria-live': 'polite' }).props.children as string | undefined
  }
})

let deckHost: HTMLElement | null = null

function createNodeMock(element: ReactElement<unknown>): HTMLElement | null {
  if (typeof element.type !== 'string') return null
  const node = document.createElement(element.type)
  const props = element.props as Record<string, unknown>
  if (props['data-pptx-canvas-viewport'] === 'true') deckHost = node
  return node
}

function lastDeckProps(): WorkspacePptxDeckProps {
  const props = deckMocks.props.at(-1)
  if (!props) throw new Error('The deck has not rendered.')
  return props
}

function lastReportedView(callback: ReturnType<typeof vi.fn>) {
  return callback.mock.calls.filter(([view]) => view != null).at(-1)?.[0]
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve()
}

async function dispatchKey(key: string, target: Window | HTMLElement = window): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  })
}

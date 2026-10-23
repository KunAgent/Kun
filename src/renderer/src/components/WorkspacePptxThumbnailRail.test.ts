import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_MOUNTED_PPTX_THUMBNAILS,
  WorkspacePptxThumbnailRail,
  type PptxThumbnailSession
} from './WorkspacePptxThumbnailRail'

// pptx-preview resolves slide masters in the background, so a single-slide
// render can run before the deck is fully parsed. These tests pin the rail's
// recovery contract: retry a slide that was not ready yet, keep every slide
// that already rendered, and stop at a bounded failure instead of pulsing
// forever.

type RailPreviewer = {
  renderSingleSlide: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

// Retries are timers scheduled inside effects. Each act block must end before
// the next timer can flush React work, so let the rail settle in slices.
async function settle(renderer: ReactTestRenderer, slices = 8): Promise<void> {
  for (let index = 0; index < slices; index += 1) {
    await act(async () => {
      await wait(40)
    })
  }
}

// Renders like pptx-preview: one slide wrapper per call, and a deck that is
// only parsable from the second attempt onwards throws on the first one.
function createPreviewer(host: HTMLElement, render: (slideIndex: number) => void): RailPreviewer {
  const wrapper = document.createElement('div')
  wrapper.className = 'pptx-preview-wrapper'
  host.append(wrapper)
  const renderSingleSlide = vi.fn((slideIndex: number) => {
    render(slideIndex)
    wrapper.querySelector('.pptx-preview-slide-wrapper')?.remove()
    const slide = document.createElement('div')
    slide.className = `pptx-preview-slide-wrapper pptx-preview-slide-wrapper-${slideIndex}`
    slide.style.width = '160px'
    slide.style.height = '90px'
    const label = document.createElement('span')
    label.textContent = `Slide ${slideIndex + 1}`
    slide.append(label)
    wrapper.append(slide)
  })
  return { renderSingleSlide, destroy: vi.fn() }
}

function createNodeMock(element: ReactElement<unknown>): HTMLElement | null {
  if (typeof element.type !== 'string') return null
  return document.createElement(element.type)
}

function states(renderer: ReactTestRenderer): number[] {
  return renderer.root
    .findAll((node) => typeof node.props['data-pptx-thumbnail-index'] === 'number')
    .filter((node) => node.props['data-thumbnail-state'] === 'ready')
    .map((node) => Number(node.props['data-pptx-thumbnail-index']) + 1)
}

function mountedLabels(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => typeof node.type === 'function' && node.props.content instanceof HTMLElement)
    .map((node) => (node.props.content as HTMLElement).textContent ?? '')
}

// The rail only needs the single-slide entry point, so a recording stub stands
// in for the full pptx-preview instance.
function railSession(
  host: HTMLDivElement,
  previewer: RailPreviewer,
  sourceKey: string
): PptxThumbnailSession {
  return { previewer, host, sourceKey } as unknown as PptxThumbnailSession
}

function renderRail(
  session: PptxThumbnailSession,
  slideCount: number,
  currentSlide: number
): ReactElement {
  return createElement(WorkspacePptxThumbnailRail, {
    session,
    slideCount,
    currentSlide,
    onSelectSlide: vi.fn()
  })
}

describe('PPTX thumbnail rail recovery', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Element', dom.window.Element)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    dom.window.close()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('retries slides that were not parseable on the first attempt', async () => {
    const host = document.createElement('div')
    const firstAttempts = new Set<number>()
    const previewer = createPreviewer(host, (slideIndex) => {
      if (firstAttempts.has(slideIndex)) return
      firstAttempts.add(slideIndex)
      throw new Error('slide masters are still loading')
    })
    const session = railSession(host, previewer, 'deck:1')

    await act(async () => {
      renderer = create(renderRail(session, 3, 1), { createNodeMock })
    })
    await settle(renderer!)

    expect(states(renderer!)).toEqual([1, 2, 3])
    expect(previewer.renderSingleSlide.mock.calls.map(([index]) => index)).toEqual([0, 0, 1, 1, 2, 2])
    expect(mountedLabels(renderer!)).toEqual(['Slide 1', 'Slide 2', 'Slide 3'])
  })

  it('retries a slide whose wrapper was missing on the first render', async () => {
    const host = document.createElement('div')
    const wrapper = document.createElement('div')
    wrapper.className = 'pptx-preview-wrapper'
    host.append(wrapper)
    const misses = new Set<number>()
    const renderSingleSlide = vi.fn((slideIndex: number) => {
      wrapper.querySelector('.pptx-preview-slide-wrapper')?.remove()
      // The first request for each slide returns without producing a wrapper,
      // which is what a parse-in-progress deck looks like to the rail.
      if (!misses.has(slideIndex)) {
        misses.add(slideIndex)
        return
      }
      const slide = document.createElement('div')
      slide.className = `pptx-preview-slide-wrapper pptx-preview-slide-wrapper-${slideIndex}`
      slide.style.width = '160px'
      slide.style.height = '90px'
      const label = document.createElement('span')
      label.textContent = `Slide ${slideIndex + 1}`
      slide.append(label)
      wrapper.append(slide)
    })
    const session = railSession(host, { renderSingleSlide, destroy: vi.fn() }, 'deck:miss')

    await act(async () => {
      renderer = create(renderRail(session, 3, 1), { createNodeMock })
    })
    await settle(renderer!)

    expect(states(renderer!)).toEqual([1, 2, 3])
    expect(mountedLabels(renderer!)).toEqual(['Slide 1', 'Slide 2', 'Slide 3'])
  })

  it('keeps every thumbnail on screen when the active slide changes', async () => {
    const host = document.createElement('div')
    const previewer = createPreviewer(host, () => undefined)
    const session = railSession(host, previewer, 'deck:2')

    await act(async () => {
      renderer = create(renderRail(session, 6, 1), { createNodeMock })
      await flushPromises()
    })
    expect(states(renderer!)).toEqual([1, 2, 3, 4, 5, 6])

    // A finished thumbnail must not revert to a placeholder on re-render.
    await act(async () => {
      renderer!.update(renderRail(session, 6, 4))
      await flushPromises()
    })
    expect(states(renderer!)).toEqual([1, 2, 3, 4, 5, 6])
    expect(previewer.renderSingleSlide).toHaveBeenCalledTimes(6)
  })

  it('stops after bounded attempts instead of pulsing forever', async () => {
    const host = document.createElement('div')
    const previewer = createPreviewer(host, () => {
      throw new Error('slide cannot be parsed')
    })
    const session = railSession(host, previewer, 'deck:3')

    await act(async () => {
      renderer = create(renderRail(session, 1, 1), { createNodeMock })
    })
    await settle(renderer!)

    expect(states(renderer!)).toEqual([])
    expect(previewer.renderSingleSlide).toHaveBeenCalledTimes(3)
    expect(renderer!.root.findAll((node) => node.props['data-thumbnail-state'] === 'failed'))
      .toHaveLength(1)

    await settle(renderer!)
    expect(previewer.renderSingleSlide).toHaveBeenCalledTimes(3)
  })

  it('mounts only the virtualized window and fills it after navigating far away', async () => {
    const host = document.createElement('div')
    const previewer = createPreviewer(host, () => undefined)
    const session = railSession(host, previewer, 'deck:4')

    await act(async () => {
      renderer = create(renderRail(session, 40, 1), { createNodeMock })
      await flushPromises()
    })
    expect(states(renderer!)).toHaveLength(MAX_MOUNTED_PPTX_THUMBNAILS)

    await act(async () => {
      renderer!.update(renderRail(session, 40, 40))
      await flushPromises()
    })
    const ready = states(renderer!)
    expect(ready).toContain(40)
    expect(ready).toHaveLength(MAX_MOUNTED_PPTX_THUMBNAILS)
  })
})

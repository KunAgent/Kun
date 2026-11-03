import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ViewerProps = {
  showThumbnails: boolean
  renderThumbnail: (context: { slideIndex: number; slideCount: number; isCurrent: boolean; goToSlide: () => void }) => ReactNode
  onReady: (controller: unknown) => void
  onLoad: (presentation: { document: { slides: unknown[] } }) => void
  onSlideRendered: (index: number, element: HTMLElement) => void
  onError: (error: { message: string }) => void
}

const viewerMocks = vi.hoisted(() => ({
  props: [] as ViewerProps[],
  renderThumbnail: vi.fn(),
  parsePresentation: vi.fn()
}))

vi.mock('@extend-ai/react-pptx', () => ({
  setWasmSource: vi.fn(),
  parsePresentation: viewerMocks.parsePresentation,
  ReactPptxViewer: (props: ViewerProps): ReactElement => {
    viewerMocks.props.push(props)
    return createElement(
      'nav',
      null,
      props.showThumbnails
        ? [0, 1, 2].map((slideIndex) => createElement('div', { key: slideIndex }, props.renderThumbnail({
          slideIndex,
          slideCount: 3,
          isCurrent: slideIndex === 0,
          goToSlide: () => undefined
        })))
        : null
    )
  }
}))

import { WorkspacePptxDeck, type WorkspacePptxDeckProps } from './WorkspacePptxDeck'

describe('WorkspacePptxDeck', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    viewerMocks.props = []
    viewerMocks.renderThumbnail.mockReset()
    viewerMocks.parsePresentation.mockReset()
    viewerMocks.parsePresentation.mockImplementation(async (source: Uint8Array) => ({
      kind: 'parsed-presentation',
      document: { slides: Array.from({ length: source[0] ?? 1 }, () => ({})) }
    }))
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    dom.window.close()
    vi.unstubAllGlobals()
  })

  function props(overrides: Partial<WorkspacePptxDeckProps> = {}): WorkspacePptxDeckProps {
    return {
      source: new Uint8Array([1]),
      mode: 'continuous',
      slideIndex: 0,
      zoom: 'fit-page',
      showThumbnails: true,
      changedSlides: new Set([2]),
      onLoad: vi.fn(),
      onSlideChange: vi.fn(),
      onSelectSlide: vi.fn(),
      onZoomChange: vi.fn(),
      onError: vi.fn(),
      ...overrides
    }
  }

  it('renders numbered rail thumbnails through the controller once it is ready', async () => {
    const cleanup = vi.fn()
    viewerMocks.renderThumbnail.mockResolvedValue(cleanup)
    const deckProps = props()
    await act(async () => {
      renderer = create(createElement(WorkspacePptxDeck, deckProps), {
        createNodeMock: () => document.createElement('span')
      })
    })
    const buttons = () => renderer!.root.findAll((node) => node.type === 'button')
    expect(buttons().map((button) => button.props['data-thumbnail-state'])).toEqual(['pending', 'pending', 'pending'])
    expect(viewerMocks.renderThumbnail).not.toHaveBeenCalled()

    await act(async () => {
      viewerMocks.props.at(-1)!.onReady({ renderThumbnail: viewerMocks.renderThumbnail })
      await Promise.resolve()
    })
    expect(viewerMocks.renderThumbnail).toHaveBeenCalledTimes(3)
    expect(viewerMocks.renderThumbnail).toHaveBeenCalledWith(1, expect.anything(), { width: 112 })
    expect(buttons().map((button) => button.props['data-thumbnail-state'])).toEqual(['ready', 'ready', 'ready'])
    expect(buttons()[0]!.props['aria-current']).toBe('page')
    expect(buttons()[1]!.props['data-slide-changed']).toBe('true')
    expect(buttons()[1]!.props['aria-label']).toBe('Go to slide 2 · Changed')
    expect(buttons()[2]!.findByProps({ className: 'rpv-thumbnail__number' }).props.children).toBe('03')

    await act(async () => buttons()[2]!.props.onClick())
    expect(deckProps.onSelectSlide).toHaveBeenCalledWith(3)

    await act(async () => renderer?.unmount())
    renderer = undefined
    expect(cleanup).toHaveBeenCalledTimes(3)
  })

  it('keeps the deck on screen while a changed copy parses, then swaps it in', async () => {
    let finishSecondParse!: (value: unknown) => void
    const deckProps = props({ source: new Uint8Array([3]), showThumbnails: false })
    await act(async () => {
      renderer = create(createElement(WorkspacePptxDeck, deckProps))
    })
    const firstParsed = viewerMocks.props.at(-1)!
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0)

    viewerMocks.parsePresentation.mockImplementationOnce(() => new Promise((resolve) => { finishSecondParse = resolve }))
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxDeck, { ...deckProps, source: new Uint8Array([5]) }))
    })
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    expect((viewerMocks.props.at(-1) as unknown as { source: unknown }).source)
      .toBe((firstParsed as unknown as { source: unknown }).source)

    const next = { kind: 'parsed-presentation', document: { slides: [{}, {}, {}, {}, {}] } }
    await act(async () => { finishSecondParse(next) })
    expect((viewerMocks.props.at(-1) as unknown as { source: unknown }).source).toBe(next)
  })

  it('shows the parser failure when a deck cannot be opened', async () => {
    viewerMocks.parsePresentation.mockRejectedValueOnce(new Error('Not a presentation'))
    const deckProps = props()
    await act(async () => {
      renderer = create(createElement(WorkspacePptxDeck, deckProps))
    })
    expect(renderer!.root.findByProps({ role: 'alert' })).toBeTruthy()
    expect(deckProps.onError).toHaveBeenCalledWith('Not a presentation')
    expect(viewerMocks.props).toHaveLength(0)
  })

  it('reports the slide count and neutralises links in rendered slides', async () => {
    const deckProps = props({ showThumbnails: false })
    await act(async () => {
      renderer = create(createElement(WorkspacePptxDeck, deckProps))
    })
    const viewer = viewerMocks.props.at(-1)!
    viewer.onLoad({ document: { slides: [{}, {}, {}, {}] } })
    expect(deckProps.onLoad).toHaveBeenCalledWith(4)

    const slide = document.createElement('section')
    const link = document.createElement('a')
    link.href = 'https://example.test/report'
    link.target = '_blank'
    slide.append(link)
    viewer.onSlideRendered(0, slide)
    expect(link.getAttribute('href')).toBe('#')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.getAttribute('data-kun-office-href')).toBe('https://example.test/report')

    viewer.onError({ message: '' })
    expect(deckProps.onError).toHaveBeenCalledWith(expect.stringMatching(/\S/))
  })
})

import { vi } from 'vitest'

export type MockPptxPreviewer = {
  host: HTMLElement
  slideCount: number
  load: ReturnType<typeof vi.fn>
  renderSingleSlide: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

export function createMockPptxPreviewer(
  host: HTMLElement,
  slideCount: number,
  previewError?: Error
): MockPptxPreviewer {
  const wrapper = document.createElement('div')
  wrapper.className = 'pptx-preview-wrapper'
  host.append(wrapper)
  const renderSlide = (slideIndex: number): void => {
    wrapper.querySelector('.pptx-preview-slide-wrapper')?.remove()
    const slide = document.createElement('div')
    slide.className = `pptx-preview-slide-wrapper pptx-preview-slide-wrapper-${slideIndex}`
    const anchor = document.createElement('a')
    anchor.href = `https://example.test/slide-${slideIndex + 1}`
    anchor.target = '_blank'
    anchor.setAttribute('ping', 'https://example.test/ping')
    anchor.textContent = `Slide ${slideIndex + 1}`
    slide.append(anchor)
    wrapper.append(slide)
  }
  return {
    host,
    slideCount,
    load: vi.fn(async () => {
      if (previewError) throw previewError
      const master = { background: { type: 'none' } }
      const layout = { background: { type: 'none' }, slideMaster: master }
      return {
        slides: Array.from({ length: slideCount }, () => ({
          background: { type: 'none' },
          slideLayout: layout
        }))
      }
    }),
    renderSingleSlide: vi.fn(renderSlide),
    destroy: vi.fn()
  }
}

export const PPTX_TEST_RAIL_HEIGHT = 400
const PPTX_TEST_THUMBNAIL_PITCH = 108

// Layout for the thumbnail rail under react-test-renderer: an 8px-padded rail
// with thumbnails stacked every 108px from its padding edge.
export function createPptxRailGeometryMock(): {
  rail: () => HTMLElement | undefined
  apply: (node: HTMLElement, props: Record<string, unknown>) => void
} {
  let rail: HTMLElement | undefined
  const define = (node: HTMLElement, key: string, value: number, writable = false): void => {
    Object.defineProperty(node, key, writable ? { configurable: true, writable, value } : { configurable: true, value })
  }
  return {
    rail: () => rail,
    apply: (node, props) => {
      if (props['aria-label'] === 'Slide thumbnails') {
        rail = node
        node.style.paddingTop = '8px'
        define(node, 'scrollTop', 0, true)
        define(node, 'clientHeight', PPTX_TEST_RAIL_HEIGHT)
      }
      const index = props['data-pptx-thumbnail-index']
      if (typeof index !== 'number') return
      define(node, 'offsetTop', 8 + index * PPTX_TEST_THUMBNAIL_PITCH)
      define(node, 'offsetHeight', PPTX_TEST_THUMBNAIL_PITCH - 8)
    }
  }
}

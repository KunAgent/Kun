import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartDesignHtmlPreviewWatchOptions } from '../../design/design-preview-file'
import {
  designHtmlPreviewUrl,
  designHtmlPreviewWebviewStyle,
  designHtmlPreviewWebviewZoomFactor,
  executeDesignHtmlPreviewScript,
  shouldRenderDesignHtmlPreviewWebview,
  useDesignHtmlPreview
} from './DesignHtmlPreviewHost'

vi.mock('../../design/design-preview-file', () => ({
  startDesignHtmlPreviewWatch: (options: StartDesignHtmlPreviewWatchOptions) => {
    options.onPreviewStateChange?.('renderable')
    options.onRevision(1)
    return () => undefined
  }
}))

describe('DesignHtmlPreviewHost helpers', () => {
  it('renders skeletons and last-good previews, but not transient first chunks', () => {
    expect(shouldRenderDesignHtmlPreviewWebview({
      fileUrl: 'file:///workspace/.kun-design/screen/v1.html',
      renderState: 'skeleton',
      hasRenderableContent: false
    })).toBe(true)
    expect(shouldRenderDesignHtmlPreviewWebview({
      fileUrl: 'file:///workspace/.kun-design/screen/v1.html',
      renderState: 'transient',
      hasRenderableContent: false
    })).toBe(false)
    expect(shouldRenderDesignHtmlPreviewWebview({
      fileUrl: 'file:///workspace/.kun-design/screen/v1.html',
      renderState: 'transient',
      hasRenderableContent: true
    })).toBe(true)
    expect(shouldRenderDesignHtmlPreviewWebview({
      fileUrl: '',
      renderState: 'skeleton',
      hasRenderableContent: true
    })).toBe(false)
  })

  it('never mounts skeletons for surfaces that opt out of skeleton painting', () => {
    expect(shouldRenderDesignHtmlPreviewWebview({
      fileUrl: 'file:///workspace/.kun-design/screen/v1.html',
      renderState: 'skeleton',
      hasRenderableContent: false,
      mountWhileSkeleton: false
    })).toBe(false)
    expect(shouldRenderDesignHtmlPreviewWebview({
      fileUrl: 'file:///workspace/.kun-design/screen/v1.html',
      renderState: 'renderable',
      hasRenderableContent: true,
      mountWhileSkeleton: false
    })).toBe(true)
  })

  it('builds revision URLs without remount-oriented keys', () => {
    expect(designHtmlPreviewUrl('file:///workspace/page.html', 3)).toBe('file:///workspace/page.html?rev=3')
    expect(designHtmlPreviewUrl('file:///workspace/page.html?token=1', 4)).toBe('file:///workspace/page.html?token=1&rev=4')
  })

  it('gives transparent HTML opaque paper independently of the workbench theme', () => {
    const style = designHtmlPreviewWebviewStyle({
      display: 'flex',
      width: 1280,
      height: 800,
      transform: 'scale(0.57)',
      pointerEvents: 'none'
    })
    expect(style).toEqual({
      backgroundColor: '#ffffff',
      colorScheme: 'light',
      display: 'flex',
      width: 1280,
      height: 800,
      transform: 'scale(0.57)',
      pointerEvents: 'none'
    })
    // Host paper must not recolor/invert the embedded document's own artwork.
    expect(style).not.toHaveProperty('color')
    expect(style).not.toHaveProperty('filter')
    expect(designHtmlPreviewWebviewStyle()).toEqual({ backgroundColor: '#ffffff', colorScheme: 'light' })
  })

  it('clamps native webview zoom factors', () => {
    expect(designHtmlPreviewWebviewZoomFactor(1)).toBe(1)
    expect(designHtmlPreviewWebviewZoomFactor(0)).toBe(1)
    expect(designHtmlPreviewWebviewZoomFactor(Number.NaN)).toBe(1)
    expect(designHtmlPreviewWebviewZoomFactor(0.001)).toBe(0.05)
    expect(designHtmlPreviewWebviewZoomFactor(50)).toBe(4)
  })

  it('guards synchronous Electron executeJavaScript throws', async () => {
    expect(
      executeDesignHtmlPreviewScript({
        executeJavaScript: () => {
          throw new Error('not ready')
        }
      }, 'true')
    ).toBeNull()
    await expect(
      executeDesignHtmlPreviewScript({
        executeJavaScript: async () => 42
      }, 'true')
    ).resolves.toBe(42)
    await expect(
      executeDesignHtmlPreviewScript({
        executeJavaScript: async () => {
          throw new Error('guest script failed')
        }
      }, 'true')
    ).resolves.toBeNull()
  })
})

describe('mounted HTML preview paper', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      kunGui: {
        authorizeWritePrototype: vi.fn().mockResolvedValue({
          ok: true,
          fileUrl: 'file:///workspace/.kun-design/board.html'
        })
      }
    })
  })
  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    vi.unstubAllGlobals()
  })

  it.each([false, true])('applies opaque paper to the actual webview (canvas layout=%s)', async (canvasLayout) => {
    const Harness = () => {
      const preview = useDesignHtmlPreview({
        workspaceRoot: '/workspace',
        relativePath: '.kun-design/board.html',
        partition: 'kun-proto'
      })
      return preview.renderWebview({
        className: 'h-full w-full border-0',
        style: canvasLayout ? { display: 'flex', width: 1280, height: 800, transform: 'scale(0.57)' } : undefined
      })
    }
    await act(async () => { renderer = create(createElement(Harness)) })
    const webview = renderer!.root.findByType('webview')
    expect(webview.props.src).toBe('file:///workspace/.kun-design/board.html')
    expect(webview.props.style).toMatchObject({ backgroundColor: '#ffffff', colorScheme: 'light' })
    if (canvasLayout) expect(webview.props.style).toMatchObject({ display: 'flex', transform: 'scale(0.57)' })
  })
})

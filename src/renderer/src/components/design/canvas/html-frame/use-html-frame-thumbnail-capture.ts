import { useEffect, useState } from 'react'
import type { DesignHtmlPreviewWebviewElement } from '../../DesignHtmlPreviewHost'
import {
  HTML_FRAME_THUMBNAIL_MAX_BYTES,
  HTML_FRAME_THUMBNAIL_MAX_EDGE
} from './html-frame-preview-budget'

export async function captureHtmlFrameThumbnail(webview: DesignHtmlPreviewWebviewElement): Promise<string> {
  if (!webview.capturePage) throw new Error('Preview capture is unavailable')
  const image = await webview.capturePage()
  if (image.isEmpty()) throw new Error('Preview capture returned no pixels')
  const { width, height } = image.getSize()
  const scale = Math.min(1, HTML_FRAME_THUMBNAIL_MAX_EDGE / Math.max(width, height))
  const resized = scale < 1 ? image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best'
  }) : image
  const dataUrl = resized.toDataURL()
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > HTML_FRAME_THUMBNAIL_MAX_BYTES) {
    throw new Error('Preview capture exceeds the image limit')
  }
  return dataUrl
}

function guestUrlMatches(webview: DesignHtmlPreviewWebviewElement, url: string): boolean {
  try { return Boolean(url) && webview.getURL?.() === url } catch { return false }
}

export function useHtmlFrameThumbnailCapture({
  shapeId, captureKey, webview, webviewUrl, ready, enabled, onCapture
}: {
  shapeId: string
  captureKey?: string
  webview: DesignHtmlPreviewWebviewElement | null
  webviewUrl: string
  ready: boolean
  enabled: boolean
  onCapture?: (shapeId: string, key: string, image: string | null) => void
}): void {
  const [loaded, setLoaded] = useState<{ guest: DesignHtmlPreviewWebviewElement; url: string } | null>(null)
  useEffect(() => {
    if (!webview) return
    const onLoaded = (): void => {
      if (guestUrlMatches(webview, webviewUrl)) setLoaded({ guest: webview, url: webviewUrl })
    }
    const onLoading = (): void => setLoaded(null)
    webview.addEventListener('did-finish-load', onLoaded)
    webview.addEventListener('did-start-loading', onLoading)
    // The live guest may already have finished before this capture request.
    try { if (ready && webview.isLoading?.() === false) onLoaded() } catch { /* detached guest */ }
    return () => {
      webview.removeEventListener('did-finish-load', onLoaded)
      webview.removeEventListener('did-start-loading', onLoading)
    }
  }, [ready, webview, webviewUrl])

  const loadComplete = loaded?.guest === webview && loaded?.url === webviewUrl
  useEffect(() => {
    if (!captureKey || !onCapture || !enabled) return
    let cancelled = false
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (image: string | null): void => {
      if (cancelled || finished) return
      finished = true
      onCapture(shapeId, captureKey, image)
    }
    const deadline = setTimeout(() => finish(null), 12_000)
    if (ready && loadComplete && webview) {
      timer = setTimeout(() => {
        if (cancelled || finished || !guestUrlMatches(webview, webviewUrl)) return
        void captureHtmlFrameThumbnail(webview).then((image) => {
          if (cancelled || finished) return
          finish(guestUrlMatches(webview, webviewUrl) ? image : null)
        }).catch(() => finish(null))
      }, 400)
    }
    return () => {
      cancelled = true
      clearTimeout(deadline)
      if (timer) clearTimeout(timer)
    }
  }, [captureKey, enabled, loadComplete, onCapture, ready, shapeId, webview, webviewUrl])
}

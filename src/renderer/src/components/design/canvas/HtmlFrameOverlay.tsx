import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Monitor, MousePointer2 } from 'lucide-react'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { isHtmlFrame, type CanvasShape } from '../../../design/canvas/canvas-types'
import type { DesignHtmlElementContext } from '../../../design/design-composer-context'
import { startDesignHtmlPreviewWatch } from '../../../design/design-preview-file'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'

const MAX_ACTIVE_WEBVIEWS = 6
const MIN_ZOOM_FOR_WEBVIEW = 0.04

/** Hide the "AI is drawing here" cursor this long after the last file change. */
const AI_CURSOR_TTL_MS = 4500

/** A just-created screen has no HTML file yet; poll fast for this long, then slowly. */
const PREVIEW_FAST_POLL_MS = 6_000
/** Give up polling a preview that never lands after this (matches the page-generation ceiling). */
const PREVIEW_MAX_WAIT_MS = 300_000

/**
 * Runs inside the live webview to locate the section the agent just wrote: the
 * LAST element tagged `data-ds-section` (sections are written top-to-bottom), or
 * the last top-level body child as a fallback for untagged HTML. Returns its
 * label + rect in the webview's CSS px, which maps 1:1 to the overlay content div.
 */
const AI_SECTION_QUERY = `(() => {
  const tagged = document.querySelectorAll('[data-ds-section]')
  let el = null
  let label = ''
  if (tagged.length) {
    el = tagged[tagged.length - 1]
    label = el.getAttribute('data-ds-section') || ''
  } else if (document.body) {
    const kids = Array.prototype.slice.call(document.body.children).filter((n) => {
      const r = n.getBoundingClientRect()
      return r.height > 8 && r.width > 8
    })
    el = kids.length ? kids[kids.length - 1] : null
  }
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  return { label: label, left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
})()`

type WebviewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>
}

type ScreenOverlayProps = {
  shape: CanvasShape
  workspaceRoot: string
  screenX: number
  screenY: number
  screenWidth: number
  screenHeight: number
  active: boolean
  interactive: boolean
  onDoubleClick: (shapeId: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

function ScreenOverlayInner({
  shape,
  workspaceRoot,
  screenX,
  screenY,
  screenWidth,
  screenHeight,
  active,
  interactive,
  onDoubleClick,
  onUseElementAsContext
}: ScreenOverlayProps): ReactElement {
  const [fileUrl, setFileUrl] = useState('')
  const [revision, setRevision] = useState(0)
  const [previewError, setPreviewError] = useState('')
  const [selectedElementRect, setSelectedElementRect] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const [aiCursor, setAiCursor] = useState<{
    label: string
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const aiFadeTimerRef = useRef<number>(0)
  const firstRevisionRef = useRef<number | null>(null)

  const artifact = useDesignWorkspaceStore((s) =>
    s.artifacts.find((a) => a.id === shape.htmlArtifactId)
  )
  const artifactKind = artifact?.kind
  const artifactRelativePath = artifact?.relativePath
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)

  useEffect(() => {
    let cancelled = false
    let cleanupWatch: (() => void) | null = null
    let retryTimer = 0
    const startedAt = Date.now()
    setFileUrl('')
    setRevision(0)
    setPreviewError('')
    if (!artifactRelativePath || artifactKind !== 'html' || !workspaceRoot) return
    if (typeof window.kunGui?.authorizeWritePrototype !== 'function') return

    const reportError = (message: string): void => {
      setPreviewError(message)
      setFileError(message)
    }

    const tryAuthorize = (): void => {
      void window.kunGui
        .authorizeWritePrototype({ path: artifactRelativePath, workspaceRoot })
        .then((res) => {
          if (cancelled) return
          if (res.ok) {
            setPreviewError('')
            setFileUrl(res.fileUrl)
            cleanupWatch?.()
            cleanupWatch = startDesignHtmlPreviewWatch({
              workspaceRoot,
              path: artifactRelativePath,
              onRevision: (nextRevision) => {
                setPreviewError('')
                setRevision(nextRevision)
              },
              onError: reportError
            })
            return
          }
          if (res.message === 'prototype file not found') {
            // The agent creates the artifact card before it writes the HTML, so a
            // missing file is the normal "still generating" state — never the
            // canvas-wide error banner. Keep polling (fast, then slow) and let the
            // tile show its local "Generating…" placeholder; the success path below
            // installs the watcher, so this self-heals the moment the file lands.
            const elapsed = Date.now() - startedAt
            if (elapsed <= PREVIEW_MAX_WAIT_MS) {
              retryTimer = window.setTimeout(
                tryAuthorize,
                elapsed < PREVIEW_FAST_POLL_MS ? 250 : 2000
              )
            }
            return
          }
          reportError(res.message)
        })
        .catch((error: unknown) => {
          if (!cancelled) reportError(error instanceof Error ? error.message : String(error))
        })
    }

    tryAuthorize()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      cleanupWatch?.()
    }
  }, [artifactKind, artifactRelativePath, setFileError, workspaceRoot])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDoubleClick(shape.id)
    },
    [shape.id, onDoubleClick]
  )

  const selectElementAt = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!active || interactive || !artifact || !webviewRef.current?.executeJavaScript) return
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      void webviewRef.current
        .executeJavaScript(`(() => {
          const x = ${JSON.stringify(x)}
          const y = ${JSON.stringify(y)}
          const escapeCss = (value) => {
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
            return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')
          }
          const selectorFor = (element) => {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return ''
            if (element.id) return '#' + escapeCss(element.id)
            const parts = []
            let current = element
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
              const tag = current.tagName.toLowerCase()
              if (tag === 'body') {
                parts.unshift('body')
                break
              }
              let index = 1
              let sibling = current.previousElementSibling
              while (sibling) {
                if (sibling.tagName === current.tagName) index += 1
                sibling = sibling.previousElementSibling
              }
              parts.unshift(tag + ':nth-of-type(' + index + ')')
              current = current.parentElement
            }
            return parts.join(' > ')
          }
          const element = document.elementFromPoint(x, y)
          if (!element || element === document.documentElement || element === document.body) {
            return { ok: false, message: 'No editable element at this point.' }
          }
          const bounds = element.getBoundingClientRect()
          return {
            ok: true,
            selector: selectorFor(element),
            tagName: element.tagName,
            text: (element.innerText || element.textContent || '').trim().slice(0, 500),
            html: element.outerHTML.slice(0, 1400),
            rect: {
              left: Math.round(bounds.left),
              top: Math.round(bounds.top),
              width: Math.round(bounds.width),
              height: Math.round(bounds.height)
            }
          }
        })()`)
        .then((value) => {
          if (!value || typeof value !== 'object') return
          const result = value as {
            ok?: unknown
            message?: unknown
            selector?: unknown
            tagName?: unknown
            text?: unknown
            html?: unknown
            rect?: unknown
          }
          if (!result.ok) {
            if (typeof result.message === 'string') setPreviewError(result.message)
            setSelectedElementRect(null)
            onUseElementAsContext?.(null)
            return
          }
          const resultRect = result.rect as { left?: unknown; top?: unknown; width?: unknown; height?: unknown } | undefined
          if (
            typeof result.selector !== 'string' ||
            typeof result.tagName !== 'string' ||
            typeof result.text !== 'string' ||
            typeof result.html !== 'string' ||
            !resultRect ||
            typeof resultRect.left !== 'number' ||
            typeof resultRect.top !== 'number' ||
            typeof resultRect.width !== 'number' ||
            typeof resultRect.height !== 'number'
          ) {
            return
          }
          setPreviewError('')
          setSelectedElementRect({
            left: resultRect.left,
            top: resultRect.top,
            width: resultRect.width,
            height: resultRect.height
          })
          onUseElementAsContext?.({
            artifactId: artifact.id,
            artifactTitle: artifact.title,
            artifactRelativePath: artifact.relativePath,
            selector: result.selector,
            tagName: result.tagName,
            text: result.text,
            html: result.html
          })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setPreviewError(message)
          setFileError(message)
        })
    },
    [active, artifact, interactive, onUseElementAsContext, setFileError]
  )

  useEffect(() => {
    setSelectedElementRect(null)
  }, [artifact?.id, artifact?.relativePath, shape.id])

  const queryAiCursor = useCallback(() => {
    const wv = webviewRef.current
    if (typeof wv?.executeJavaScript !== 'function') return
    void wv
      .executeJavaScript(AI_SECTION_QUERY)
      .then((value) => {
        if (!value || typeof value !== 'object') return
        const v = value as Record<string, unknown>
        if (
          typeof v.left !== 'number' ||
          typeof v.top !== 'number' ||
          typeof v.width !== 'number' ||
          typeof v.height !== 'number'
        ) {
          return
        }
        setAiCursor({
          label: typeof v.label === 'string' ? v.label : '',
          left: v.left,
          top: v.top,
          width: v.width,
          height: v.height
        })
        if (aiFadeTimerRef.current) window.clearTimeout(aiFadeTimerRef.current)
        aiFadeTimerRef.current = window.setTimeout(() => setAiCursor(null), AI_CURSOR_TTL_MS)
      })
      .catch(() => undefined)
  }, [])

  // Live "AI is drawing here" cursor. The watcher bumps `revision` once when the
  // watch is established (the file just loaded — baseline, no cursor); every later
  // bump means the agent wrote more, so query the newest tagged section and move
  // the cursor onto it. A static design never bumps past the baseline → no cursor.
  useEffect(() => {
    if (!fileUrl) {
      firstRevisionRef.current = null
      setAiCursor(null)
      return
    }
    if (firstRevisionRef.current === null) {
      firstRevisionRef.current = revision
      return
    }
    if (revision <= firstRevisionRef.current) return
    const timer = window.setTimeout(queryAiCursor, 450)
    return () => window.clearTimeout(timer)
  }, [revision, fileUrl, queryAiCursor])

  useEffect(
    () => () => {
      if (aiFadeTimerRef.current) window.clearTimeout(aiFadeTimerRef.current)
    },
    []
  )

  if (screenWidth < 20 || screenHeight < 20) return <></>

  const titleBarHeight = Math.min(28, screenHeight * 0.06)
  const webviewUrl = fileUrl ? `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}rev=${revision}` : ''

  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: screenX,
        top: screenY,
        width: screenWidth,
        height: screenHeight,
        pointerEvents: active || interactive ? 'auto' : 'none',
        borderRadius: Math.min(8, screenWidth * 0.01)
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-1 border-b px-2 text-ds-muted"
        style={{
          height: titleBarHeight,
          fontSize: Math.min(11, titleBarHeight * 0.42),
          borderColor: active ? 'var(--ds-accent)' : 'var(--ds-border)',
          backgroundColor: active
            ? 'color-mix(in srgb, var(--ds-accent) 8%, white)'
            : 'rgba(255,255,255,0.94)'
        }}
      >
        <Monitor style={{ width: titleBarHeight * 0.45, height: titleBarHeight * 0.45 }} strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate font-medium">{shape.name}</span>
        <span className="shrink-0 opacity-60">
          {Math.round(shape.width)}x{Math.round(shape.height)}
        </span>
      </div>

      {/* Content */}
      <div style={{ height: screenHeight - titleBarHeight }} className="relative bg-white">
        {webviewUrl ? (
          <webview
            key={webviewUrl}
            ref={webviewRef as React.Ref<WebviewElement>}
            src={webviewUrl}
            partition="kun-proto"
            webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            className="h-full w-full border-0"
            style={{ pointerEvents: interactive ? 'auto' : 'none' }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ds-faint">
            <div className="text-center" style={{ fontSize: Math.min(12, screenWidth * 0.028) }}>
              {previewError || (artifact ? 'Generating...' : 'No content')}
            </div>
          </div>
        )}
        {webviewUrl && active && !interactive ? (
          <div
            className="absolute inset-0 cursor-crosshair"
            title="Select an element"
            onPointerDown={selectElementAt}
          />
        ) : null}
        {selectedElementRect && active && !interactive ? (
          <div
            className="pointer-events-none absolute border border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(255,255,255,0.75)]"
            style={{
              left: selectedElementRect.left,
              top: selectedElementRect.top,
              width: selectedElementRect.width,
              height: selectedElementRect.height
            }}
          />
        ) : null}
        {aiCursor ? (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* Glow on the section the agent just wrote */}
            <div
              className="absolute rounded-[3px] border"
              style={{
                left: aiCursor.left,
                top: aiCursor.top,
                width: aiCursor.width,
                height: aiCursor.height,
                borderColor: 'color-mix(in srgb, var(--ds-accent) 75%, transparent)',
                background: 'color-mix(in srgb, var(--ds-accent) 9%, transparent)',
                boxShadow:
                  '0 0 0 1px color-mix(in srgb, var(--ds-accent) 30%, transparent), 0 8px 26px color-mix(in srgb, var(--ds-accent) 22%, transparent)',
                transition:
                  'left 360ms cubic-bezier(0.22,1,0.36,1), top 360ms cubic-bezier(0.22,1,0.36,1), width 360ms ease, height 360ms ease'
              }}
            />
            {/* Animated AI cursor + label, clamped to stay visible */}
            <div
              className="absolute flex items-center gap-1"
              style={{
                left: Math.min(aiCursor.left + aiCursor.width - 8, screenWidth - 8),
                top: Math.max(2, Math.min(aiCursor.top - 2, screenHeight - titleBarHeight - 22)),
                transition:
                  'left 360ms cubic-bezier(0.22,1,0.36,1), top 360ms cubic-bezier(0.22,1,0.36,1)'
              }}
            >
              <MousePointer2
                className="h-3.5 w-3.5 drop-shadow"
                strokeWidth={1.6}
                style={{ color: 'var(--ds-accent)', fill: 'var(--ds-accent)' }}
              />
              <span
                className="max-w-[150px] truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
                style={{ background: 'var(--ds-accent)' }}
              >
                {aiCursor.label || 'AI 正在生成…'}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const ScreenOverlay = memo(ScreenOverlayInner)

type Props = {
  workspaceRoot: string
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

export function HtmlFrameOverlay({ workspaceRoot, onUseElementAsContext }: Props): ReactElement {
  const objects = useCanvasShapeStore((s) => s.document.objects)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const containerHeight = useCanvasViewportStore((s) => s.containerHeight)
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)

  const [interactiveId, setInteractiveId] = useState<string | null>(null)

  const zoom = containerWidth / vbox.width

  const htmlFrames = useMemo(() => {
    const frames: CanvasShape[] = []
    for (const id of Object.keys(objects)) {
      const shape = objects[id]
      if (shape && isHtmlFrame(shape) && shape.visible) {
        frames.push(shape)
      }
    }
    return frames
  }, [objects])

  // Visibility + priority: viewport-visible frames first, selected frames get priority
  const visibleFrames = useMemo(() => {
    return htmlFrames
      .filter((shape) => {
        const right = shape.x + shape.width
        const bottom = shape.y + shape.height
        const vRight = vbox.x + vbox.width
        const vBottom = vbox.y + vbox.height
        return right > vbox.x && shape.x < vRight && bottom > vbox.y && shape.y < vBottom
      })
      .sort((a, b) => {
        const aSelected = selectedIds.has(a.id) ? 1 : 0
        const bSelected = selectedIds.has(b.id) ? 1 : 0
        return bSelected - aSelected
      })
  }, [htmlFrames, vbox, selectedIds])

  const onDoubleClick = useCallback((shapeId: string) => {
    setInteractiveId((prev) => (prev === shapeId ? null : shapeId))
  }, [])

  // Exit interactive mode on selection change
  useEffect(() => {
    if (interactiveId && !selectedIds.has(interactiveId)) {
      setInteractiveId(null)
    }
  }, [selectedIds, interactiveId])

  const selectedIdsKey = useMemo(() => [...selectedIds].sort().join(','), [selectedIds])

  useEffect(() => {
    onUseElementAsContext?.(null)
  }, [onUseElementAsContext, selectedIdsKey])

  if (htmlFrames.length === 0 || zoom < MIN_ZOOM_FOR_WEBVIEW) return <></>

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {visibleFrames.slice(0, MAX_ACTIVE_WEBVIEWS).map((shape) => {
        const screenX = ((shape.x - vbox.x) / vbox.width) * containerWidth
        const screenY = ((shape.y - vbox.y) / vbox.height) * containerHeight
        const screenWidth = (shape.width / vbox.width) * containerWidth
        const screenHeight = (shape.height / vbox.height) * containerHeight
        const active = selectedIds.has(shape.id)

        return (
          <ScreenOverlay
            key={shape.id}
            shape={shape}
            workspaceRoot={workspaceRoot}
            screenX={screenX}
            screenY={screenY}
            screenWidth={screenWidth}
            screenHeight={screenHeight}
            active={active}
            interactive={interactiveId === shape.id}
            onDoubleClick={onDoubleClick}
            onUseElementAsContext={onUseElementAsContext}
          />
        )
      })}
    </div>
  )
}

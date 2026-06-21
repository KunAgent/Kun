import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Monitor } from 'lucide-react'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { isHtmlFrame, type CanvasShape } from '../../../design/canvas/canvas-types'
import { startDesignHtmlPreviewWatch } from '../../../design/design-preview-file'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'

const MAX_ACTIVE_WEBVIEWS = 6
const MIN_ZOOM_FOR_WEBVIEW = 0.04

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
  onDoubleClick
}: ScreenOverlayProps): ReactElement {
  const [fileUrl, setFileUrl] = useState('')
  const [revision, setRevision] = useState(0)
  const [previewError, setPreviewError] = useState('')
  const webviewRef = useRef<HTMLElement | null>(null)

  const artifact = useDesignWorkspaceStore((s) =>
    s.artifacts.find((a) => a.id === shape.htmlArtifactId)
  )
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)

  useEffect(() => {
    let cancelled = false
    let cleanupWatch: (() => void) | null = null
    let retryTimer = 0
    let attempts = 0
    setFileUrl('')
    setRevision(0)
    setPreviewError('')
    if (!artifact || artifact.kind !== 'html' || !workspaceRoot) return
    if (typeof window.kunGui?.authorizeWritePrototype !== 'function') return

    const reportError = (message: string): void => {
      setPreviewError(message)
      setFileError(message)
    }

    const tryAuthorize = (): void => {
      attempts += 1
      void window.kunGui
        .authorizeWritePrototype({ path: artifact.relativePath, workspaceRoot })
        .then((res) => {
          if (cancelled) return
          if (res.ok) {
            setPreviewError('')
            setFileUrl(res.fileUrl)
            cleanupWatch?.()
            cleanupWatch = startDesignHtmlPreviewWatch({
              workspaceRoot,
              path: artifact.relativePath,
              onRevision: (nextRevision) => {
                setPreviewError('')
                setRevision(nextRevision)
              },
              onError: reportError
            })
            return
          }
          if (res.message === 'prototype file not found' && attempts < 24) {
            retryTimer = window.setTimeout(tryAuthorize, 250)
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
  }, [artifact?.relativePath, artifact?.kind, setFileError, workspaceRoot])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDoubleClick(shape.id)
    },
    [shape.id, onDoubleClick]
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
        pointerEvents: interactive ? 'auto' : 'none',
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
      <div style={{ height: screenHeight - titleBarHeight }} className="bg-white">
        {webviewUrl ? (
          <webview
            key={webviewUrl}
            ref={webviewRef as React.Ref<HTMLElement>}
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
      </div>
    </div>
  )
}

const ScreenOverlay = memo(ScreenOverlayInner)

type Props = {
  workspaceRoot: string
}

export function HtmlFrameOverlay({ workspaceRoot }: Props): ReactElement {
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
          />
        )
      })}
    </div>
  )
}

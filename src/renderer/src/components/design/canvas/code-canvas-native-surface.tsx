import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { CanvasViewport } from './CanvasViewport'
import type { CanvasViewportChromeSlots } from './canvas-viewport/CanvasViewportChrome'
import { useApplyShapeOpsLive } from '../../../design/canvas/use-apply-shape-ops-live'
import { useApplyExcalidrawLive } from '../../../whiteboard/use-apply-excalidraw-live'
import type { ExecuteOpsOptions } from '../../../design/canvas/shape-ops'
import {
  CODE_CANVAS_DIR,
  codeCanvasArtifactId,
  codeCanvasEnginePath,
  codeCanvasErrorKey,
  codeCanvasThreadBaseDir
} from '../../../design/canvas/code-canvas'
import {
  exportActiveCodeCanvasToWorkspace,
  type CanvasAgentExportRequest
} from '../../../design/canvas/canvas-export'
import { canvasDocumentKey } from '../../../design/canvas/canvas-persistence'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { ExcalidrawSurface } from '../../../whiteboard/excalidraw-surface'
import {
  canSwitchCanvasEngine,
  excalidrawScenePath,
  isKunCanvasDocumentEmpty,
  liveCanvasEngine,
  persistCanvasEngineRecord,
  resolvePersistedCanvasEngine
} from '../../../whiteboard/excalidraw-persistence'
import { DEFAULT_CANVAS_ENGINE, type CanvasEngine } from '../../../whiteboard/canvas-engine'
import { requestCodeCanvasPanelFocus } from '../../../lib/code-canvas-panel-event'
import { WhiteboardBoardHeader, type WhiteboardViewMode } from './whiteboard-chrome/WhiteboardBoardHeader'
import { WhiteboardBoardMenu, type WhiteboardBoardAction } from './whiteboard-chrome/WhiteboardBoardMenu'
import {
  excalidrawConsumesEscape,
  isEditableEventTarget,
  whiteboardEscapeAction
} from './whiteboard-chrome/whiteboard-view-escape'

const EXCALIDRAW_BOARD_ACTIONS: readonly WhiteboardBoardAction[] = ['export-png', 'export-svg', 'copy-image', 'reveal']

function exportStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

export function CodeCanvasNativeSurface(props: {
  workspaceRoot: string
  threadId: string
  chrome?: CanvasViewportChromeSlots
  /** `focused` when the panel covers the stage; fullscreen is layered on top locally. */
  presentation?: 'docked' | 'focused'
  onExitFocus?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const { workspaceRoot, threadId } = props
  const artifactId = codeCanvasArtifactId(threadId)
  const designSystemBaseDir = codeCanvasThreadBaseDir(threadId)
  const feedbackKey = codeCanvasErrorKey(threadId)
  const enginePath = codeCanvasEnginePath(threadId)
  const expectedDocumentKey = canvasDocumentKey(workspaceRoot, artifactId, CODE_CANVAS_DIR)
  const canvasDocument = useCanvasShapeStore((state) => state.document)
  const canvasDocumentKeyValue = useCanvasShapeStore((state) => state.documentKey)
  const [engine, setEngine] = useState<CanvasEngine>(
    () => liveCanvasEngine(workspaceRoot, enginePath) ?? DEFAULT_CANVAS_ENGINE
  )
  const [excalidrawEmpty, setExcalidrawEmpty] = useState(true)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const presentation = props.presentation ?? 'docked'
  const view: WhiteboardViewMode = fullscreen ? 'fullscreen' : presentation

  useEffect(() => {
    let cancelled = false
    void resolvePersistedCanvasEngine(workspaceRoot, enginePath).then((next) => {
      if (!cancelled) setEngine(next)
    })
    return () => {
      cancelled = true
    }
  }, [enginePath, workspaceRoot])

  const executeOptions = useMemo<ExecuteOpsOptions>(
    () => ({
      screenFallback: 'plain-frame',
      shapePreset: 'diagram',
      lintFeedbackKey: feedbackKey
    }),
    [feedbackKey]
  )
  const exportCanvas = useCallback(
    (request: CanvasAgentExportRequest) => exportActiveCodeCanvasToWorkspace({
      request,
      workspaceRoot,
      artifactId,
      expectedDocumentKey
    }),
    [artifactId, expectedDocumentKey, workspaceRoot]
  )
  const kunMode = engine === 'kun'
  useApplyShapeOpsLive(
    kunMode,
    undefined,
    executeOptions,
    feedbackKey,
    threadId,
    undefined,
    exportCanvas,
    undefined,
    expectedDocumentKey,
    undefined,
    'code'
  )

  useApplyExcalidrawLive({
    enabled: engine === 'excalidraw',
    threadId,
    workspaceRoot,
    identityId: artifactId,
    baseDir: CODE_CANVAS_DIR,
    surface: 'code'
  })

  const kunEmpty = canvasDocumentKeyValue !== expectedDocumentKey ||
    isKunCanvasDocumentEmpty(canvasDocument)
  const canSwitch = canSwitchCanvasEngine({
    currentEngine: engine,
    kunEmpty,
    excalidrawEmpty
  })
  const switchEngine = (next: CanvasEngine): void => {
    if (!canSwitch || next === engine) return
    setEngine(next)
    void persistCanvasEngineRecord(workspaceRoot, enginePath, next)
  }

  const onExitFocus = props.onExitFocus
  const changeView = useCallback((next: WhiteboardViewMode): void => {
    if (next === 'fullscreen') {
      setFullscreen(true)
      return
    }
    setFullscreen(false)
    if (next === 'focused' && presentation === 'docked') requestCodeCanvasPanelFocus()
    if (next === 'docked' && presentation === 'focused') onExitFocus?.()
  }, [onExitFocus, presentation])

  useEffect(() => {
    if (view === 'docked') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const appState = engine === 'excalidraw' ? excalidrawApi?.getAppState() : null
      const editorBusy = appState
        ? excalidrawConsumesEscape(appState)
        : engine === 'kun' && useCanvasSelectionStore.getState().selectedIds.size > 0
      const action = whiteboardEscapeAction({
        view,
        editorBusy,
        targetEditable: isEditableEventTarget(event.target),
        menuOpen: Boolean(rootRef.current?.querySelector('[role="menu"]'))
      })
      if (action === 'ignore') return
      // Marks the key as handled for the stage-level focus listener only;
      // the editor's own Escape handling ignores defaultPrevented.
      event.preventDefault()
      if (action === 'exit-fullscreen') setFullscreen(false)
      if (action === 'exit-focus') onExitFocus?.()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [engine, excalidrawApi, onExitFocus, view])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const title = props.chrome?.title ?? t('rightPanelWhiteboard')
  const runBoardAction = (action: WhiteboardBoardAction): void => {
    const api = excalidrawApi
    if (action === 'reveal') {
      void window.kunGui?.revealWorkspaceFileInFolder?.({
        workspaceRoot,
        path: excalidrawScenePath(artifactId, CODE_CANVAS_DIR)
      })
      return
    }
    if (!api) return
    void (async () => {
      try {
        const exporter = await import('../../../whiteboard/excalidraw-export')
        if (action === 'copy-image') {
          await exporter.copyExcalidrawBoardImage(api)
          setNotice(t('whiteboardCopied'))
          return
        }
        const saved = await exporter.saveExcalidrawBoardAs({
          api,
          format: action === 'export-svg' ? 'svg' : 'png',
          workspaceRoot,
          suggestedName: `${title}-${exportStamp()}`
        })
        if (saved) setNotice(t('whiteboardExported'))
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t('whiteboardExportFailed'))
      }
    })()
  }

  return (
    <div
      ref={rootRef}
      className={fullscreen
        ? 'fixed inset-0 z-[90] flex flex-col bg-ds-main'
        : 'relative flex h-full min-h-0 w-full flex-col'}
      data-canvas-engine={engine}
      data-whiteboard-view={view}
    >
      <WhiteboardBoardHeader
        view={view}
        onViewChange={changeView}
        notice={notice}
        boardMenu={(
          <WhiteboardBoardMenu
            title={title}
            engine={engine}
            canSwitchEngine={canSwitch}
            onEngineChange={switchEngine}
            actions={engine === 'excalidraw' && excalidrawApi ? EXCALIDRAW_BOARD_ACTIONS : []}
            onAction={runBoardAction}
          />
        )}
      />
      <div className="relative min-h-0 flex-1">
        {engine === 'excalidraw' ? (
          <ExcalidrawSurface
            workspaceRoot={workspaceRoot}
            identityId={artifactId}
            baseDir={CODE_CANVAS_DIR}
            onEmptyChange={setExcalidrawEmpty}
            onApiChange={setExcalidrawApi}
            kunToolbar
          />
        ) : (
          <CanvasViewport
            workspaceRoot={workspaceRoot}
            artifactId={artifactId}
            baseDir={CODE_CANVAS_DIR}
            designSystemBaseDir={designSystemBaseDir}
            surface="code"
            chrome={props.chrome}
          />
        )}
      </div>
    </div>
  )
}

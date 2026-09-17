import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CanvasViewport } from './CanvasViewport'
import { PropertiesPanel } from './PropertiesPanel'
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
import { CanvasEngineSwitcher, ExcalidrawSurface } from '../../../whiteboard/excalidraw-surface'
import {
  canSwitchCanvasEngine,
  isKunCanvasDocumentEmpty,
  liveCanvasEngine,
  persistCanvasEngineRecord,
  resolvePersistedCanvasEngine
} from '../../../whiteboard/excalidraw-persistence'
import { DEFAULT_CANVAS_ENGINE, type CanvasEngine } from '../../../whiteboard/canvas-engine'

export function CodeCanvasNativeSurface(props: {
  workspaceRoot: string
  threadId: string
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
    baseDir: CODE_CANVAS_DIR
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

  return (
    <div className="relative h-full min-h-0 w-full" data-canvas-engine={engine}>
      {engine === 'excalidraw' ? (
        <ExcalidrawSurface
          workspaceRoot={workspaceRoot}
          identityId={artifactId}
          baseDir={CODE_CANVAS_DIR}
          onEmptyChange={setExcalidrawEmpty}
        />
      ) : (
        <>
          <CanvasViewport
            workspaceRoot={workspaceRoot}
            artifactId={artifactId}
            baseDir={CODE_CANVAS_DIR}
            designSystemBaseDir={designSystemBaseDir}
            surface="code"
          />
          <PropertiesPanel surface="code" />
        </>
      )}
      <div className="pointer-events-none absolute right-3 top-3 z-40">
        <CanvasEngineSwitcher
          engine={engine}
          canSwitch={canSwitch}
          disabledReason={t('canvasEngineSwitchLocked')}
          onChange={switchEngine}
          kunLabel={t('canvasEngineKun')}
          excalidrawLabel={t('canvasEngineExcalidraw')}
        />
      </div>
    </div>
  )
}

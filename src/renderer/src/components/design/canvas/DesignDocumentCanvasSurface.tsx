import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesignArtifact } from '../../../design/design-types'
import { designDocumentResolvedEngine } from '../../../design/design-types'
import type { DesignHtmlElementContext } from '../../../design/design-composer-context'
import type { DesignRuntimeQualityPayload } from '../../../design/design-html-quality'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import {
  findDesignBoardArtifact,
  findDesignBoardArtifactById,
  ensureDesignBoardArtifact
} from '../../../design/design-board'
import { CanvasEngineSwitcher, ExcalidrawSurface } from '../../../whiteboard/excalidraw-surface'
import { canSwitchCanvasEngine, isKunCanvasDocumentEmpty } from '../../../whiteboard/excalidraw-persistence'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { setScreenCreationFactory } from '../../../design/canvas/screen-artifact-bridge'
import { createLinkedHtmlScreen } from '../../../design/canvas/screen-lifecycle'
import { createLinkedSvgArtifact } from '../../../design/canvas/svg-artifact-lifecycle'
import { useApplyShapeOpsLive } from '../../../design/canvas/use-apply-shape-ops-live'
import { useApplyExcalidrawLive } from '../../../whiteboard/use-apply-excalidraw-live'
import { canvasOpErrorKey } from '../../../design/canvas/apply-shape-ops'
import { canvasDocumentKey } from '../../../design/canvas/canvas-persistence'
import { useSvgArtifactStatusMonitor } from '../../../design/svg/use-svg-artifact-status-monitor'
import { CanvasViewport } from './CanvasViewport'
import { PropertiesPanel } from './PropertiesPanel'
import {
  exportActiveCanvasToWorkspace,
  type CanvasAgentExportRequest
} from '../../../design/canvas/canvas-export'

const DESIGN_DOCUMENTS_DIR = '.kun-design'

export type DesignDocumentCanvasSurfaceProps = {
  workspaceRoot: string
  documentId: string | null
  activeThreadId: string | null
  /** Board pinned by a locked task target; never falls back to another board. */
  boardArtifactId?: string
  readOnly?: boolean
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  busy?: boolean
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onScreenCreated?: (
    shapeId: string,
    userPrompt: string,
    brief?: string
  ) => boolean | void | Promise<boolean | void>
  onSvgCreated?: (
    artifactId: string,
    shapeId: string,
    userPrompt: string,
    brief: string
  ) => boolean | Promise<boolean>
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
}

export function canvasDocumentReadyForRuntime(
  expectedDocumentKey: string | undefined,
  loadedDocumentKey: string | null
): boolean {
  return Boolean(expectedDocumentKey && loadedDocumentKey === expectedDocumentKey)
}

function DesignEngineOverlay(props: {
  documentId: string
  engine: 'kun' | 'excalidraw'
  canSwitch: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-50">
      <CanvasEngineSwitcher
        engine={props.engine}
        canSwitch={props.canSwitch}
        disabledReason={t('canvasEngineSwitchLocked')}
        onChange={(engine) => {
          useDesignWorkspaceStore.getState().setDocumentEngine(props.documentId, engine)
        }}
        kunLabel={t('canvasEngineKun')}
        excalidrawLabel={t('canvasEngineExcalidraw')}
      />
    </div>
  )
}

/** Full DesignDocument runtime shared by the legacy stage and Code's right whiteboard. */
export function DesignDocumentCanvasSurface({
  workspaceRoot,
  documentId,
  activeThreadId,
  boardArtifactId,
  readOnly = false,
  leftSidebarCollapsed = false,
  onToggleLeftSidebar,
  busy = false,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onSvgCreated,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: DesignDocumentCanvasSurfaceProps): ReactElement {
  const document = useDesignWorkspaceStore((state) =>
    state.documents.find((item) => item.id === documentId) ?? null)
  const settingsLoaded = useDesignWorkspaceStore((state) => state.settingsLoaded)
  const activeDocumentId = useDesignWorkspaceStore((state) => state.activeDocumentId)
  const artifacts = document?.artifacts ?? []
  const engine = document ? designDocumentResolvedEngine(document) : 'kun'
  const excalidraw = engine === 'excalidraw'
  const requestedBoardArtifactId = boardArtifactId?.trim()
  const boardArtifact = requestedBoardArtifactId
    ? findDesignBoardArtifactById(artifacts, requestedBoardArtifactId)
    : findDesignBoardArtifact(artifacts)
  const lockedBoardMissing = Boolean(requestedBoardArtifactId && !boardArtifact)
  const documentIsActive = Boolean(documentId && activeDocumentId === documentId)
  const baseDir = documentId ? `${DESIGN_DOCUMENTS_DIR}/${documentId}` : undefined
  const liveOpsErrorKey = canvasOpErrorKey(workspaceRoot, documentId, boardArtifact?.id)
  const expectedCanvasDocumentKey = boardArtifact && baseDir
    ? canvasDocumentKey(workspaceRoot, boardArtifact.id, baseDir)
    : undefined
  const [loadedCanvasDocumentKey, setLoadedCanvasDocumentKey] = useState<string | null>(null)
  const [excalidrawEmpty, setExcalidrawEmpty] = useState(true)
  const canvasDocument = useCanvasShapeStore((state) => state.document)
  const canvasDocumentKeyValue = useCanvasShapeStore((state) => state.documentKey)
  const canvasRuntimeReady = canvasDocumentReadyForRuntime(
    expectedCanvasDocumentKey,
    loadedCanvasDocumentKey
  )
  const handleDocumentLoadStateChange = useCallback((loaded: boolean): void => {
    setLoadedCanvasDocumentKey(loaded ? expectedCanvasDocumentKey ?? null : null)
  }, [expectedCanvasDocumentKey])
  useSvgArtifactStatusMonitor(workspaceRoot, artifacts, !readOnly)

  useEffect(() => {
    if (!workspaceRoot || !settingsLoaded || !documentId || !documentIsActive || readOnly) return
    // A locked target is resolved by id and never auto-created or switched:
    // creating/reusing the most recently updated board would silently retarget
    // the task away from the whiteboard it is pinned to.
    if (requestedBoardArtifactId) return
    void ensureDesignBoardArtifact(workspaceRoot, documentId)
  }, [documentId, documentIsActive, readOnly, requestedBoardArtifactId, settingsLoaded, workspaceRoot, artifacts.length])

  useEffect(() => {
    if (excalidraw || !boardArtifact || !documentId || !documentIsActive || readOnly) return
    const activeBoardId = boardArtifact.id
    setScreenCreationFactory((request) => {
      const designState = useDesignWorkspaceStore.getState()
      if (designState.activeDocumentId !== documentId) return null
      const activeBoard = findDesignBoardArtifact(designState.artifacts)
      if (activeBoard?.id !== activeBoardId) return null
      const created = createLinkedHtmlScreen({
        boardArtifactId: activeBoardId,
        name: request.name,
        brief: request.brief,
        x: request.x,
        y: request.y,
        width: request.width,
        height: request.height,
        targetFrameId: request.targetFrameId,
        devicePreset: request.devicePreset,
        preparePreview: request.preparePreview,
        sizeMode: request.sizeMode
      })
      return created ? { artifactId: created.artifactId, shapeId: created.shape.id } : null
    })
    return () => setScreenCreationFactory(null)
  }, [boardArtifact, documentId, documentIsActive, excalidraw, readOnly])

  const exportCanvas = useCallback(
    (request: CanvasAgentExportRequest) => {
      if (!boardArtifact) throw new Error('The Design whiteboard is not open')
      return exportActiveCanvasToWorkspace({
        request,
        workspaceRoot,
        surface: 'design',
        artifactId: boardArtifact.id,
        expectedDocumentKey: expectedCanvasDocumentKey
      })
    },
    [boardArtifact, expectedCanvasDocumentKey, workspaceRoot]
  )

  useApplyShapeOpsLive(
    Boolean(
      !excalidraw &&
      boardArtifact && activeThreadId && documentId && documentIsActive &&
      !readOnly && canvasRuntimeReady
    ),
    onScreenCreated,
    undefined,
    liveOpsErrorKey,
    activeThreadId,
    !excalidraw && boardArtifact
      ? async (request, userPrompt) => {
          try {
            const created = await createLinkedSvgArtifact({
              boardArtifactId: boardArtifact.id,
              artifactId: request.artifactId,
              name: request.name,
              brief: request.brief,
              x: request.x,
              y: request.y,
              width: request.width,
              height: request.height
            })
            if (!created) return null
            const dispatched = onSvgCreated
              ? await onSvgCreated(
                  created.artifactId,
                  created.shape.id,
                  userPrompt,
                  request.brief
                )
              : true
            if (!dispatched) return null
            return {
              artifactId: created.artifactId,
              shapeId: created.shape.id,
              newlyCreated: created.newlyCreated
            }
          } catch (error) {
            useDesignWorkspaceStore.getState().setFileError(
              error instanceof Error ? error.message : String(error)
            )
            return null
          }
        }
      : undefined,
    !excalidraw && boardArtifact ? exportCanvas : undefined,
    !excalidraw && boardArtifact && documentId
      ? { documentId, boardArtifactId: boardArtifact.id }
      : undefined,
    expectedCanvasDocumentKey
  )

  useApplyExcalidrawLive({
    enabled: Boolean(excalidraw && documentId && activeThreadId && documentIsActive && !readOnly),
    threadId: activeThreadId,
    workspaceRoot,
    identityId: documentId ?? '',
    baseDir: DESIGN_DOCUMENTS_DIR,
    surface: 'design'
  })

  const kunEmpty = !expectedCanvasDocumentKey ||
    canvasDocumentKeyValue !== expectedCanvasDocumentKey ||
    isKunCanvasDocumentEmpty(canvasDocument)
  const engineLocked = artifacts.some((artifact) => artifact.kind === 'html' || artifact.kind === 'svg')
  const canSwitch = !readOnly && !engineLocked && canSwitchCanvasEngine({
    currentEngine: engine,
    kunEmpty,
    excalidrawEmpty
  })

  if (excalidraw && documentId && documentIsActive) {
    return (
      <div
        className="ds-stage-design-canvas relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main w-full"
        data-canvas-engine="excalidraw"
      >
        <ExcalidrawSurface
          workspaceRoot={workspaceRoot}
          identityId={documentId}
          baseDir={DESIGN_DOCUMENTS_DIR}
          readOnly={readOnly}
          onEmptyChange={setExcalidrawEmpty}
        />
        {!readOnly && !engineLocked ? (
          <DesignEngineOverlay
            documentId={documentId}
            engine="excalidraw"
            canSwitch={canSwitch}
          />
        ) : null}
      </div>
    )
  }

  if (!boardArtifact || !documentIsActive) {
    return (
      <div className="ds-stage-design-canvas relative flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-ds-main text-sm text-ds-faint w-full">
        {lockedBoardMissing
          ? 'The whiteboard bound to this Design task is unavailable.'
          : 'Loading design board...'}
      </div>
    )
  }

  return (
    <div
      className="ds-stage-design-canvas relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main w-full"
      data-canvas-engine="kun"
    >
      <CanvasViewport
        workspaceRoot={workspaceRoot}
        artifactId={boardArtifact.id}
        {...(baseDir ? { baseDir } : {})}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        busy={busy}
        onOpenAgentSettings={onOpenAgentSettings}
        surface="design"
        readOnly={readOnly}
        syncHtmlScreens
        onImplementDesign={onImplementDesign}
        onUseElementAsContext={onUseElementAsContext}
        onRuntimeQualityFindings={onRuntimeQualityFindings}
        onRequestQualityRepair={onRequestQualityRepair}
        onDocumentLoadStateChange={handleDocumentLoadStateChange}
      />
      {!readOnly ? (
        <PropertiesPanel
          surface="design"
          onImplementDesign={onImplementDesign}
          onRequestModify={(promptSeed) => onUseElementAsContext?.(null, promptSeed)}
        />
      ) : null}
      {!readOnly && !engineLocked ? (
        <DesignEngineOverlay
          documentId={documentId!}
          engine="kun"
          canSwitch={canSwitch}
        />
      ) : null}
    </div>
  )
}

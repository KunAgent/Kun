import { memo, useCallback, useMemo, useState } from 'react'
import {
  ArrowRight,
  Circle,
  Download,
  FileCode2,
  FileImage,
  Film,
  Frame,
  Hand,
  ImagePlus,
  Layers3,
  Minus,
  Monitor,
  MousePointer2,
  Palette,
  Pencil,
  Play,
  ShieldCheck,
  Sparkles,
  Shapes,
  Square,
  Type as TypeIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { lintDesignSystem, setLastLintFindings } from '../../../design/canvas/design-lint'
import { filterEditableRootShapeIds } from '../../../design/canvas/canvas-editability'
import { importWorkspaceImageToCanvas } from '../../../design/canvas/canvas-image-import'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useDesignSystemStore } from '../../../design/canvas/design-system-store'
import type { CanvasTool } from '../../../design/canvas/canvas-types'
import type { CanvasExportFormat } from '../../../design/canvas/canvas-export'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import {
  buildRecommendedDesignWorkflowAction,
  buildDesignAgentActions,
  type DesignAgentAction
} from '../../../design/agent-actions/design-agent-actions'
import { DesignContextPopover } from '../DesignContextPopover'
import { useDesignAgentActionRunner } from '../useDesignAgentActionRunner'
import { DesignAgentActionMenu } from './DesignAgentActionMenu'
import { CanvasLayersPanel } from './CanvasLayersPanel'
import type { DesignExportFormat } from '@shared/design-export'
import type { CanvasSurface } from '../../../design/canvas/canvas-surface'
import { isDesignCanvasSurface } from '../../../design/canvas/canvas-surface'

type Props = {
  workspaceRoot: string
  surface?: CanvasSurface
  designTargetDisabled?: boolean
  prototypePlayable?: boolean
  onOpenPrototypePlayer?: () => void
  onOpenAgentSettings?: () => void
  onRequestCanvasCritique?: (promptSeed: string) => void
  onExportCanvas?: (format: CanvasExportFormat) => Promise<void>
  onExportPrototype?: (format: DesignExportFormat) => Promise<void>
  onError?: (message: string | null) => void
}

type ToolButton = {
  id: CanvasTool
  icon: typeof MousePointer2
  labelKey: string
  codeLabelKey?: string
}

const tools: ToolButton[] = [
  { id: 'select', icon: MousePointer2, labelKey: 'canvasToolSelect' },
  { id: 'screen', icon: Monitor, labelKey: 'canvasToolScreen' },
  { id: 'frame', icon: Frame, labelKey: 'canvasToolFrame' },
  { id: 'image', icon: Sparkles, labelKey: 'canvasToolImage', codeLabelKey: 'codeCanvasToolImage' },
  { id: 'rect', icon: Square, labelKey: 'canvasToolRect' },
  { id: 'ellipse', icon: Circle, labelKey: 'canvasToolEllipse' },
  { id: 'text', icon: TypeIcon, labelKey: 'canvasToolText' },
  { id: 'arrow', icon: ArrowRight, labelKey: 'canvasToolArrow' },
  { id: 'line', icon: Minus, labelKey: 'canvasToolLine' },
  { id: 'draw', icon: Pencil, labelKey: 'canvasToolDraw' },
  { id: 'hand', icon: Hand, labelKey: 'canvasToolHand' }
]

const designSurfaceTools = tools.filter((tool) => (
  tool.id === 'select' ||
  tool.id === 'screen' ||
  tool.id === 'frame' ||
  tool.id === 'hand'
))
const designSurfaceMoreTools = tools.filter((tool) => !designSurfaceTools.includes(tool))

function CanvasToolbarInner({
  workspaceRoot,
  surface = 'design',
  designTargetDisabled = false,
  prototypePlayable = false,
  onOpenPrototypePlayer,
  onOpenAgentSettings,
  onRequestCanvasCritique,
  onExportCanvas,
  onExportPrototype,
  onError
}: Props) {
  const { t } = useTranslation('common')
  const canvasDocument = useCanvasShapeStore((s) => s.document)
  const designSystem = useDesignSystemStore((s) => s.system)
  const documents = useDesignWorkspaceStore((s) => s.documents)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const setActiveTool = useCanvasViewportStore((s) => s.setActiveTool)
  const motionOpen = useCanvasMotionStore((s) => s.open)
  const toggleMotionOpen = useCanvasMotionStore((s) => s.toggleOpen)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const [imageImportBusy, setImageImportBusy] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [agentActionsOpen, setAgentActionsOpen] = useState(false)
  const [moreToolsOpen, setMoreToolsOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const runAgentAction = useDesignAgentActionRunner(onRequestCanvasCritique)
  const reportError = onError ?? setFileError
  const designSurface = isDesignCanvasSurface(surface)
  const visibleTools = designSurface
    ? designSurfaceTools
    : tools.filter((tool) => tool.id !== 'screen')
  const agentActions = useMemo(
    () => {
      const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null
      const recommendedAction = buildRecommendedDesignWorkflowAction({
        document: activeDocument,
        artifacts,
        doc: canvasDocument,
        selectedIds,
        designTarget,
        designSystem
      })
      const baseActions = buildDesignAgentActions({ doc: canvasDocument, selectedIds, designTarget, designSystem })
      return recommendedAction ? [recommendedAction, ...baseActions] : baseActions
    },
    [activeDocumentId, artifacts, canvasDocument, designSystem, designTarget, documents, selectedIds]
  )

  const requestCanvasCritique = useCallback((): void => {
    const doc = useCanvasShapeStore.getState().document
    const scopeIds = filterEditableRootShapeIds(
      doc,
      useCanvasSelectionStore.getState().selectedIds
    )
    const findings = lintDesignSystem(
      doc,
      useDesignSystemStore.getState().system,
      scopeIds.length > 0 ? { scopeIds } : undefined
    )
    setLastLintFindings(findings)
    onRequestCanvasCritique?.(
      findings.length > 0
        ? t('canvasCritiquePromptWithFindings', { count: findings.length })
        : t('canvasCritiquePromptClean')
    )
  }, [onRequestCanvasCritique, t])

  const importImage = useCallback((): void => {
    if (imageImportBusy) return
    setImageImportBusy(true)
    reportError(null)
    void importWorkspaceImageToCanvas({ workspaceRoot, vbox })
      .then((result) => {
        if (!result.ok && !result.canceled) {
          reportError(result.message ?? t('canvasToolUploadFailed'))
        }
      })
      .finally(() => setImageImportBusy(false))
  }, [imageImportBusy, reportError, t, vbox, workspaceRoot])

  const requestAgentAction = useCallback((action: DesignAgentAction): void => {
    runAgentAction(action)
    setAgentActionsOpen(false)
  }, [runAgentAction])

  const requestExport = useCallback((format: CanvasExportFormat): void => {
    if (!onExportCanvas || exportBusy) return
    setExportBusy(true)
    setExportError(null)
    reportError(null)
    void onExportCanvas(format)
      .then(() => setExportOpen(false))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setExportError(message)
        reportError(message)
      })
      .finally(() => setExportBusy(false))
  }, [exportBusy, onExportCanvas, reportError])

  const requestPrototypeExport = useCallback((format: DesignExportFormat): void => {
    if (!onExportPrototype || exportBusy) return
    setExportBusy(true)
    setExportError(null)
    reportError(null)
    void onExportPrototype(format)
      .then(() => setExportOpen(false))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setExportError(message)
        reportError(message)
      })
      .finally(() => setExportBusy(false))
  }, [exportBusy, onExportPrototype, reportError])

  const iconBtnBase =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45'
  const btnActive = 'bg-[#1f2733] text-white shadow-[0_6px_16px_rgba(15,23,42,0.22)]'
  const btnInactive =
    'text-ds-muted hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10'
  const divider = 'my-1 h-px w-7 shrink-0 bg-ds-border-muted/80'
  const prototypePlayDisabled = !prototypePlayable || !onOpenPrototypePlayer
  const prototypePlayLabel = prototypePlayable
    ? t('designPrototypePlay')
    : t('designPrototypePlayUnavailable')

  return (
    <div className="relative pointer-events-auto">
      <div className="design-canvas-toolbar flex flex-col items-center gap-1 rounded-full border border-ds-border bg-white/82 px-1.5 py-1.5 shadow-[0_16px_42px_rgba(20,47,95,0.13)] backdrop-blur-2xl dark:bg-ds-card/84 dark:shadow-none">
        {visibleTools.map((tool) => {
          const label = t(!designSurface && tool.codeLabelKey ? tool.codeLabelKey : tool.labelKey)
          return (
            <button
              key={tool.id}
              type="button"
              className={`${iconBtnBase} ${activeTool === tool.id ? btnActive : btnInactive}`}
              onClick={() => setActiveTool(tool.id)}
              title={label}
              aria-label={label}
            >
              <tool.icon className="h-4 w-4" strokeWidth={1.9} />
            </button>
          )
        })}

        {designSurface ? (
          <button
            type="button"
            className={`${iconBtnBase} ${
              moreToolsOpen || designSurfaceMoreTools.some((tool) => tool.id === activeTool)
                ? btnActive
                : btnInactive
            }`}
            onClick={() => {
              setLayersOpen(false)
              setMoreToolsOpen((open) => !open)
            }}
            title={t('canvasMoreDrawingTools', 'More drawing tools')}
            aria-label={t('canvasMoreDrawingTools', 'More drawing tools')}
            aria-expanded={moreToolsOpen}
            aria-haspopup="menu"
          >
            <Shapes className="h-4 w-4" strokeWidth={1.9} />
          </button>
        ) : null}

        <button
          type="button"
          className={`${iconBtnBase} ${btnInactive}`}
          onClick={importImage}
          disabled={imageImportBusy}
          title={t(!designSurface ? 'codeCanvasToolUploadImage' : 'canvasToolUploadImage')}
          aria-label={t(!designSurface ? 'codeCanvasToolUploadImage' : 'canvasToolUploadImage')}
        >
          <ImagePlus className="h-4 w-4" strokeWidth={1.9} />
        </button>

        <div className={divider} />
        <button
          type="button"
          className={`${iconBtnBase} ${exportOpen ? btnActive : btnInactive}`}
          onClick={() => setExportOpen((open) => !open)}
          disabled={!onExportCanvas || exportBusy}
          title={t('canvasExport')}
          aria-label={t('canvasExport')}
          aria-expanded={exportOpen}
          aria-haspopup="menu"
        >
          <Download className="h-4 w-4" strokeWidth={1.9} />
        </button>

        {designSurface ? (
          <>
            <div className={divider} />

            <button
              type="button"
              className={`${iconBtnBase} ${layersOpen ? btnActive : btnInactive}`}
              onClick={() => {
                setMoreToolsOpen(false)
                setLayersOpen((open) => !open)
              }}
              title={t('canvasLayersTitle')}
              aria-label={t('canvasLayersTitle')}
              aria-expanded={layersOpen}
              aria-haspopup="dialog"
            >
              <Layers3 className="h-4 w-4" strokeWidth={1.9} />
            </button>

            <button
              type="button"
              className={`${iconBtnBase} ${motionOpen ? btnActive : btnInactive}`}
              onClick={() => {
                setActiveTool('select')
                toggleMotionOpen()
              }}
              title={t('canvasMotionMode', 'Motion')}
              aria-label={t('canvasMotionMode', 'Motion')}
              aria-pressed={motionOpen}
            >
              <Film className="h-4 w-4" strokeWidth={1.9} />
            </button>

            <button
              type="button"
              className={`${iconBtnBase} ${contextOpen ? btnActive : btnInactive}`}
              onClick={() => {
                setAgentActionsOpen(false)
                setContextOpen((open) => !open)
              }}
              title={t('designContextLabel')}
              aria-label={t('designContextLabel')}
            >
              <Palette className="h-4 w-4" strokeWidth={1.9} />
            </button>

            <DesignAgentActionMenu
              open={agentActionsOpen}
              actions={agentActions}
              buttonClassName={iconBtnBase}
              buttonActiveClassName={btnActive}
              buttonInactiveClassName={btnInactive}
              onToggle={() => {
                setContextOpen(false)
                setAgentActionsOpen((open) => !open)
              }}
              onSelect={requestAgentAction}
            />

            <button
              type="button"
              className={`${iconBtnBase} ${btnInactive}`}
              onClick={requestCanvasCritique}
              title={t('canvasToolCritique')}
              aria-label={t('canvasToolCritique')}
            >
              <ShieldCheck className="h-4 w-4" strokeWidth={1.9} />
            </button>

            <button
              type="button"
              className={`${iconBtnBase} ${btnInactive}`}
              onClick={onOpenPrototypePlayer}
              disabled={prototypePlayDisabled}
              title={prototypePlayLabel}
              aria-label={prototypePlayLabel}
            >
              <Play className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </>
        ) : null}
      </div>
      {designSurface && contextOpen ? (
        <div className="absolute right-14 top-1/2 -translate-y-1/2">
          <DesignContextPopover
            open={contextOpen}
            onClose={() => setContextOpen(false)}
            onOpenSettings={onOpenAgentSettings}
            titleKey="designContextLabel"
            designTargetDisabled={designTargetDisabled}
          />
        </div>
      ) : null}
      {designSurface && moreToolsOpen ? (
        <div role="menu" className="absolute right-14 top-0 z-50 grid w-44 grid-cols-2 gap-1 rounded-[12px] border border-ds-border bg-white/96 p-1.5 text-[12px] shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:bg-[#20252e]/96">
          {designSurfaceMoreTools.map((tool) => {
            const label = t(tool.labelKey)
            return (
              <button
                key={tool.id}
                type="button"
                role="menuitemradio"
                aria-checked={activeTool === tool.id}
                className={`flex h-9 items-center gap-2 rounded-[8px] px-2 text-left transition ${
                  activeTool === tool.id ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover'
                }`}
                onClick={() => {
                  setActiveTool(tool.id)
                  setMoreToolsOpen(false)
                }}
              >
                <tool.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {designSurface && layersOpen ? (
        <div role="dialog" aria-label={t('canvasLayersTitle')} className="absolute right-14 top-0 z-50 w-64 overflow-hidden rounded-[12px] border border-ds-border bg-white/96 p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:bg-[#20252e]/96">
          <div className="max-h-[min(420px,70vh)] overflow-y-auto">
            <CanvasLayersPanel />
          </div>
        </div>
      ) : null}
      {exportOpen ? (
        <div role="menu" className="absolute right-14 bottom-0 z-50 w-56 overflow-hidden rounded-[12px] border border-ds-border bg-white/96 p-1.5 text-[12px] shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:bg-[#20252e]/96">
          <button
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            onClick={() => requestExport('svg')}
            disabled={exportBusy}
          >
            <FileCode2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            {designSurface
              ? t('canvasExportBoardSvg', 'Board SVG (prototype previews excluded)')
              : t('canvasExportSvg')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            onClick={() => requestExport('png')}
            disabled={exportBusy}
          >
            <FileImage className="h-3.5 w-3.5" strokeWidth={1.8} />
            {designSurface
              ? t('canvasExportBoardPng', 'Board PNG (prototype previews excluded)')
              : t('canvasExportPng')}
          </button>
          {designSurface ? (
            <>
              <div className="my-1 h-px bg-ds-border-muted" />
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
                onClick={() => requestPrototypeExport('html')}
                disabled={exportBusy || !onExportPrototype}
              >
                <FileCode2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('designExportHtml')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
                onClick={() => requestPrototypeExport('pdf')}
                disabled={exportBusy || !onExportPrototype}
              >
                <FileImage className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('designExportPdf')}
              </button>
            </>
          ) : null}
          {exportError ? (
            <div role="alert" className="break-words px-2 py-1 text-[10px] leading-4 text-red-600 dark:text-red-400">
              {exportError}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const CanvasToolbar = memo(CanvasToolbarInner)

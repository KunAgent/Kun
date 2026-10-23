import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ArrowRight,
  ChevronDown,
  Circle,
  FileCode2,
  FileImage,
  Film,
  Frame,
  Hand,
  ImagePlus,
  ListTree,
  Menu,
  Minus,
  Monitor,
  MousePointer2,
  Palette,
  Pencil,
  Redo2,
  Shapes,
  ShieldCheck,
  Sparkles,
  Square,
  Type as TypeIcon,
  Undo2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { lintDesignSystem, setLastLintFindings } from '../../../design/canvas/design-lint'
import { filterEditableRootShapeIds } from '../../../design/canvas/canvas-editability'
import { importWorkspaceImageToCanvas } from '../../../design/canvas/canvas-image-import'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { useDesignSystemStore } from '../../../design/canvas/design-system-store'
import { openCanvasInspectorTab, useCanvasInspectorStore } from '../../../design/canvas/canvas-inspector-store'
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
import { useDesignAgentActionRunner } from '../useDesignAgentActionRunner'
import { DesignAgentActionMenu } from './DesignAgentActionMenu'
import type { DesignExportFormat } from '@shared/design-export'
import type { CanvasSurface } from '../../../design/canvas/canvas-surface'
import { isDesignCanvasSurface } from '../../../design/canvas/canvas-surface'
import {
  CANVAS_CHROME_DIVIDER,
  CANVAS_CHROME_MENU,
  CANVAS_CHROME_MENU_SECTION,
  CANVAS_CHROME_MENU_SEPARATOR,
  CANVAS_CHROME_PILL,
  CanvasChromeMenuItem,
  canvasChromeButtonClass,
  useCanvasChromeCompact,
  useCanvasChromeDismiss
} from './chrome/canvas-chrome-primitives'

type Props = {
  workspaceRoot: string
  surface?: CanvasSurface
  /** Drawing title shown on the menu button when the host has no header of its own. */
  documentTitle?: string
  onRequestCanvasCritique?: (promptSeed: string) => void
  onExportCanvas?: (format: CanvasExportFormat) => Promise<void>
  onExportPrototype?: (format: DesignExportFormat) => Promise<void>
  onError?: (message: string | null) => void
}

type ToolDef = {
  id: CanvasTool
  icon: typeof MousePointer2
  labelKey: string
  codeLabelKey?: string
  shortcut?: string
}

type ToolGroupId = 'pen' | 'shape' | 'image'

type ToolSlot =
  | { kind: 'tool'; tool: ToolDef }
  | { kind: 'group'; id: ToolGroupId; labelKey: string; tools: ToolDef[] }

const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+'

const TOOL: Record<CanvasTool, ToolDef> = {
  select: { id: 'select', icon: MousePointer2, labelKey: 'canvasToolSelect', shortcut: 'V' },
  hand: { id: 'hand', icon: Hand, labelKey: 'canvasToolHand', shortcut: 'H' },
  text: { id: 'text', icon: TypeIcon, labelKey: 'canvasToolText', shortcut: 'T' },
  frame: { id: 'frame', icon: Frame, labelKey: 'canvasToolFrame', shortcut: 'F' },
  screen: { id: 'screen', icon: Monitor, labelKey: 'canvasToolScreen' },
  draw: { id: 'draw', icon: Pencil, labelKey: 'canvasToolDraw', shortcut: 'P' },
  line: { id: 'line', icon: Minus, labelKey: 'canvasToolLine', shortcut: 'L' },
  arrow: { id: 'arrow', icon: ArrowRight, labelKey: 'canvasToolArrow', shortcut: 'A' },
  rect: { id: 'rect', icon: Square, labelKey: 'canvasToolRect', shortcut: 'R' },
  ellipse: { id: 'ellipse', icon: Circle, labelKey: 'canvasToolEllipse', shortcut: 'O' },
  image: { id: 'image', icon: Sparkles, labelKey: 'canvasToolImage', codeLabelKey: 'codeCanvasToolImage', shortcut: 'I' }
}

/** Tool slots in display order; grouped tools share one button that remembers the last pick. */
export function canvasToolbarSlots(designSurface: boolean): ToolSlot[] {
  return [
    { kind: 'tool', tool: TOOL.select },
    { kind: 'tool', tool: TOOL.hand },
    { kind: 'tool', tool: TOOL.text },
    { kind: 'tool', tool: TOOL.frame },
    ...(designSurface ? [{ kind: 'tool' as const, tool: TOOL.screen }] : []),
    { kind: 'group', id: 'pen', labelKey: 'canvasPenTools', tools: [TOOL.draw, TOOL.line, TOOL.arrow] },
    { kind: 'group', id: 'shape', labelKey: 'canvasShapeTools', tools: [TOOL.rect, TOOL.ellipse] },
    { kind: 'group', id: 'image', labelKey: 'canvasImageTools', tools: [TOOL.image] }
  ]
}

function toolLabel(t: (key: string) => string, tool: ToolDef, designSurface: boolean): string {
  return t(!designSurface && tool.codeLabelKey ? tool.codeLabelKey : tool.labelKey)
}

function toolTitle(label: string, tool: ToolDef): string {
  return tool.shortcut ? `${label} (${tool.shortcut})` : label
}

function ToolGroupButton({
  slot,
  designSurface,
  activeTool,
  open,
  onToggle,
  onPick,
  extraItems,
  compact
}: {
  slot: Extract<ToolSlot, { kind: 'group' }>
  compact: boolean
  designSurface: boolean
  activeTool: CanvasTool
  open: boolean
  onToggle: () => void
  onPick: (tool: CanvasTool) => void
  extraItems?: ReactElement | null
}): ReactElement {
  const { t } = useTranslation('common')
  const [lastPicked, setLastPicked] = useState<CanvasTool>(slot.tools[0].id)
  const activeInGroup = slot.tools.find((tool) => tool.id === activeTool)
  const current = activeInGroup ?? slot.tools.find((tool) => tool.id === lastPicked) ?? slot.tools[0]
  const label = toolLabel(t, current, designSurface)
  const groupLabel = t(slot.labelKey)
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        className={canvasChromeButtonClass(Boolean(activeInGroup), compact)}
        onClick={() => onPick(current.id)}
        title={toolTitle(label, current)}
        aria-label={label}
        aria-pressed={Boolean(activeInGroup)}
      >
        <current.icon className="h-4 w-4" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        className={`-ml-0.5 inline-flex ${compact ? 'h-7 w-3' : 'h-8 w-3.5'} shrink-0 items-center justify-center rounded-[6px] text-ds-faint transition-colors hover:bg-ds-hover hover:text-ds-ink ${open ? 'bg-ds-hover text-ds-ink' : ''}`}
        onClick={onToggle}
        title={groupLabel}
        aria-label={groupLabel}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </button>
      {open ? (
        <div role="menu" aria-label={groupLabel} className={`${CANVAS_CHROME_MENU} left-0 top-full mt-2 w-52`}>
          {slot.tools.map((tool) => (
            <CanvasChromeMenuItem
              key={tool.id}
              role="menuitemradio"
              checked={activeTool === tool.id}
              icon={<tool.icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={toolLabel(t, tool, designSurface)}
              shortcut={tool.shortcut}
              onSelect={() => {
                setLastPicked(tool.id)
                onPick(tool.id)
              }}
            />
          ))}
          {extraItems}
        </div>
      ) : null}
    </div>
  )
}

type OpenMenu = 'main' | ToolGroupId | 'agent' | null

function CanvasToolbarInner({
  workspaceRoot,
  surface = 'design',
  documentTitle,
  onRequestCanvasCritique,
  onExportCanvas,
  onExportPrototype,
  onError
}: Props) {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasDocument = useCanvasShapeStore((s) => s.document)
  const designSystem = useDesignSystemStore((s) => s.system)
  const documents = useDesignWorkspaceStore((s) => s.documents)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const setActiveTool = useCanvasViewportStore((s) => s.setActiveTool)
  const motionOpen = useCanvasMotionStore((s) => s.open)
  const toggleMotionOpen = useCanvasMotionStore((s) => s.toggleOpen)
  const undoCount = useCanvasUndoStore((s) => s.undoStack.length)
  const redoCount = useCanvasUndoStore((s) => s.redoStack.length)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const [imageImportBusy, setImageImportBusy] = useState(false)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const runAgentAction = useDesignAgentActionRunner(onRequestCanvasCritique)
  const reportError = onError ?? setFileError
  const designSurface = isDesignCanvasSurface(surface)
  const slots = useMemo(() => canvasToolbarSlots(designSurface), [designSurface])
  const compact = useCanvasChromeCompact()
  const closeMenus = useCallback(() => setOpenMenu(null), [])
  useCanvasChromeDismiss(openMenu !== null, rootRef, closeMenus)
  const toggleMenu = (menu: Exclude<OpenMenu, null>): void => {
    setOpenMenu((current) => (current === menu ? null : menu))
  }
  const agentActions = useMemo(
    () => {
      if (!designSurface) return []
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
    [activeDocumentId, artifacts, canvasDocument, designSurface, designSystem, designTarget, documents, selectedIds]
  )

  const requestCanvasCritique = useCallback((): void => {
    setOpenMenu(null)
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
    setOpenMenu(null)
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
    setOpenMenu(null)
  }, [runAgentAction])

  const runExport = useCallback((task: (() => Promise<void>) | null): void => {
    if (!task || exportBusy) return
    setExportBusy(true)
    setExportError(null)
    reportError(null)
    void task()
      .then(() => setOpenMenu(null))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setExportError(message)
        reportError(message)
      })
      .finally(() => setExportBusy(false))
  }, [exportBusy, reportError])

  const pickTool = (tool: CanvasTool): void => {
    setActiveTool(tool)
    setOpenMenu(null)
  }
  const openInspector = (tab: 'outline' | 'tweaks'): void => {
    openCanvasInspectorTab(tab)
    setOpenMenu(null)
  }
  const uploadLabel = t(!designSurface ? 'codeCanvasToolUploadImage' : 'canvasToolUploadImage')
  const uploadItem = (
    <>
      <div className={CANVAS_CHROME_MENU_SEPARATOR} />
      <CanvasChromeMenuItem
        icon={<ImagePlus className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={uploadLabel}
        disabled={imageImportBusy}
        onSelect={importImage}
      />
    </>
  )
  const mainMenuLabel = t('canvasMainMenu')
  const icon = (Icon: typeof Menu): ReactElement => <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />

  return (
    <div ref={rootRef} className="relative pointer-events-auto">
      <div
        className={`design-canvas-toolbar ${CANVAS_CHROME_PILL}`}
        role="toolbar"
        aria-label={t('canvasToolbarLabel')}
        data-code-canvas-titlebar={documentTitle ? 'true' : undefined}
      >
        <div className="relative flex items-center">
          <button
            type="button"
            className={`${canvasChromeButtonClass(openMenu === 'main', compact)} w-auto gap-1 px-1.5`}
            onClick={() => toggleMenu('main')}
            title={documentTitle || mainMenuLabel}
            aria-label={mainMenuLabel}
            aria-expanded={openMenu === 'main'}
            aria-haspopup="menu"
          >
            {documentTitle && compact ? (
              <>
                <Shapes className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
                <span className="sr-only">{documentTitle}</span>
              </>
            ) : documentTitle ? (
              <>
                <Shapes className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
                <span className="max-w-[148px] truncate text-[12.5px] font-medium text-ds-ink">{documentTitle}</span>
              </>
            ) : (
              <Menu className="h-4 w-4" strokeWidth={1.9} />
            )}
            <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
          </button>
          {openMenu === 'main' ? (
            <div role="menu" aria-label={mainMenuLabel} className={`${CANVAS_CHROME_MENU} left-0 top-full mt-2 w-64`}>
              <div className={CANVAS_CHROME_MENU_SECTION}>{t('canvasMenuEdit')}</div>
              <CanvasChromeMenuItem
                icon={icon(Undo2)}
                label={t('canvasUndo')}
                shortcut={`${MOD}Z`}
                disabled={undoCount === 0}
                onSelect={() => useCanvasShapeStore.getState().undo()}
              />
              <CanvasChromeMenuItem
                icon={icon(Redo2)}
                label={t('canvasRedo')}
                shortcut={`${MOD}⇧Z`}
                disabled={redoCount === 0}
                onSelect={() => useCanvasShapeStore.getState().redo()}
              />
              <CanvasChromeMenuItem
                icon={icon(ImagePlus)}
                label={uploadLabel}
                disabled={imageImportBusy}
                onSelect={importImage}
              />
              <div className={CANVAS_CHROME_MENU_SECTION}>{t('canvasMenuView')}</div>
              <CanvasChromeMenuItem
                icon={icon(ListTree)}
                label={t('canvasInspectorTabOutline')}
                onSelect={() => openInspector('outline')}
              />
              {designSurface ? (
                <CanvasChromeMenuItem
                  role="menuitemcheckbox"
                  checked={motionOpen}
                  icon={icon(Film)}
                  label={t('canvasMotionMode', 'Motion')}
                  onSelect={() => {
                    setActiveTool('select')
                    if (!motionOpen) useCanvasInspectorStore.getState().setOpen(false)
                    toggleMotionOpen()
                    setOpenMenu(null)
                  }}
                />
              ) : null}
              {designSurface ? (
                <>
                  <div className={CANVAS_CHROME_MENU_SECTION}>{t('canvasMenuDesign')}</div>
                  <CanvasChromeMenuItem
                    icon={icon(Palette)}
                    label={t('designContextLabel')}
                    onSelect={() => openInspector('tweaks')}
                  />
                  <CanvasChromeMenuItem
                    icon={icon(ShieldCheck)}
                    label={t('canvasToolCritique')}
                    onSelect={requestCanvasCritique}
                  />
                </>
              ) : null}
              <div className={CANVAS_CHROME_MENU_SECTION}>{t('canvasMenuExport')}</div>
              <CanvasChromeMenuItem
                icon={icon(FileCode2)}
                label={designSurface
                  ? t('canvasExportBoardSvg', 'Board SVG (prototype previews excluded)')
                  : t('canvasExportSvg')}
                disabled={!onExportCanvas || exportBusy}
                onSelect={() => runExport(onExportCanvas ? () => onExportCanvas('svg') : null)}
              />
              <CanvasChromeMenuItem
                icon={icon(FileImage)}
                label={designSurface
                  ? t('canvasExportBoardPng', 'Board PNG (prototype previews excluded)')
                  : t('canvasExportPng')}
                disabled={!onExportCanvas || exportBusy}
                onSelect={() => runExport(onExportCanvas ? () => onExportCanvas('png') : null)}
              />
              {designSurface ? (
                <>
                  <CanvasChromeMenuItem
                    icon={icon(FileCode2)}
                    label={t('designExportHtml')}
                    disabled={!onExportPrototype || exportBusy}
                    onSelect={() => runExport(onExportPrototype ? () => onExportPrototype('html') : null)}
                  />
                  <CanvasChromeMenuItem
                    icon={icon(FileImage)}
                    label={t('designExportPdf')}
                    disabled={!onExportPrototype || exportBusy}
                    onSelect={() => runExport(onExportPrototype ? () => onExportPrototype('pdf') : null)}
                  />
                </>
              ) : null}
              {exportError ? (
                <div role="alert" className="break-words px-2 py-1 text-[11px] leading-4 text-ds-danger">
                  {exportError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={CANVAS_CHROME_DIVIDER} />

        {slots.map((slot) => {
          if (slot.kind === 'tool') {
            const label = toolLabel(t, slot.tool, designSurface)
            return (
              <button
                key={slot.tool.id}
                type="button"
                className={canvasChromeButtonClass(activeTool === slot.tool.id, compact)}
                onClick={() => pickTool(slot.tool.id)}
                title={toolTitle(label, slot.tool)}
                aria-label={label}
                aria-pressed={activeTool === slot.tool.id}
              >
                <slot.tool.icon className="h-4 w-4" strokeWidth={1.9} />
              </button>
            )
          }
          return (
            <ToolGroupButton
              key={slot.id}
              slot={slot}
              compact={compact}
              designSurface={designSurface}
              activeTool={activeTool}
              open={openMenu === slot.id}
              onToggle={() => toggleMenu(slot.id)}
              onPick={pickTool}
              extraItems={slot.id === 'image' ? uploadItem : null}
            />
          )
        })}

        {designSurface ? (
          <>
            <div className={CANVAS_CHROME_DIVIDER} />
            <DesignAgentActionMenu
              open={openMenu === 'agent'}
              actions={agentActions}
              buttonClassName={canvasChromeButtonClass(openMenu === 'agent', compact)}
              onToggle={() => toggleMenu('agent')}
              onSelect={requestAgentAction}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

export const CanvasToolbar = memo(CanvasToolbarInner)

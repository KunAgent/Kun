import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose, Shapes } from 'lucide-react'
import { CanvasViewport } from './CanvasViewport'
import { PropertiesPanel } from './PropertiesPanel'
import { useApplyShapeOpsLive } from '../../../design/canvas/use-apply-shape-ops-live'
import type { ExecuteOpsOptions } from '../../../design/canvas/shape-ops'
import {
  CODE_CANVAS_DIR,
  codeCanvasArtifactId,
  codeCanvasErrorKey,
  codeCanvasThreadBaseDir
} from '../../../design/canvas/code-canvas'
import {
  exportActiveCodeCanvasToWorkspace,
  type CanvasAgentExportRequest
} from '../../../design/canvas/canvas-export'
import { canvasDocumentKey } from '../../../design/canvas/canvas-persistence'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Props = {
  workspaceRoot: string
  activeThreadId: string | null
  onCollapse: () => void
  className?: string
}

export function codeCanvasPanelShellClass(className?: string): string {
  return cx(
    'ds-no-drag relative flex min-h-0 flex-col overflow-hidden border-l border-ds-border-muted bg-[#f8fafc] dark:bg-[#111318]',
    className
  )
}

export function codeCanvasPanelTitlebarClass(): string {
  return 'pointer-events-auto flex h-10 max-w-[calc(100%-72px)] min-w-0 items-center gap-1.5 rounded-full border border-ds-border bg-white/82 px-1.5 shadow-[0_16px_42px_rgba(20,47,95,0.13)] backdrop-blur-2xl dark:bg-ds-card/84 dark:shadow-none'
}

/**
 * Hosts the reusable {@link CanvasViewport} as a code-workspace right panel.
 * The canvas is per-thread (`code-<threadId>`), persisted under
 * {@link CODE_CANVAS_DIR}. The main chat agent drives it via ShapeOps (Block C).
 */
export function CodeCanvasPanel({ workspaceRoot, activeThreadId, onCollapse, className }: Props) {
  const { t } = useTranslation('common')
  const ready = Boolean(workspaceRoot && activeThreadId)
  const artifactId = activeThreadId ? codeCanvasArtifactId(activeThreadId) : ''
  const designSystemBaseDir = activeThreadId ? codeCanvasThreadBaseDir(activeThreadId) : undefined
  const feedbackKey = activeThreadId ? codeCanvasErrorKey(activeThreadId) : undefined
  const expectedDocumentKey = ready
    ? canvasDocumentKey(workspaceRoot, artifactId, CODE_CANVAS_DIR)
    : undefined
  const executeOptions = useMemo<ExecuteOpsOptions>(
    () => ({
      screenFallback: 'plain-frame',
      shapePreset: 'diagram',
      ...(feedbackKey ? { lintFeedbackKey: feedbackKey } : {})
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
  useApplyShapeOpsLive(
    ready,
    undefined,
    executeOptions,
    feedbackKey,
    activeThreadId,
    undefined,
    exportCanvas
  )

  return (
    <aside className={codeCanvasPanelShellClass(className)}>
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex min-w-0 items-start">
        <div className={codeCanvasPanelTitlebarClass()} data-code-canvas-titlebar="true">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 pl-1 pr-2">
            <Shapes className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[12.5px] font-medium text-ds-ink">
              {t('rightPanelWhiteboard')}
            </span>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {ready ? (
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
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full bg-ds-surface-subtle p-3 text-ds-faint dark:bg-white/6">
              <Shapes className="h-6 w-6" strokeWidth={1.65} />
            </div>
            <div className="max-w-64 text-[12px] leading-5 text-ds-muted">
              {t('codeCanvasPanelNeedsThread')}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

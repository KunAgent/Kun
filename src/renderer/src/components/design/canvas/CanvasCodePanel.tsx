import { memo, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Check, Copy, FileCode2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { filterEditableShapeIds } from '../../../design/canvas/canvas-editability'
import type { CanvasShape } from '../../../design/canvas/canvas-types'
import { embeddedArtifactFile } from '../../../design/canvas/embedded-artifact-file'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignArtifact } from '../../../design/design-types'
import { WorkspaceCodePreview } from '../../WorkspaceCodePreview'

export type CanvasCodeTarget =
  | { kind: 'file'; path: string; revision: string }
  | { kind: 'layers'; path: string; content: string }
  | null

const INLINE_DATA_PREVIEW_CHARS = 64

function shapeForCode(shape: CanvasShape): CanvasShape {
  if (!shape.imageUrl?.startsWith('data:') || shape.imageUrl.length <= INLINE_DATA_PREVIEW_CHARS) return shape
  return { ...shape, imageUrl: `${shape.imageUrl.slice(0, INLINE_DATA_PREVIEW_CHARS)}…` }
}

/**
 * What the Code tab shows for a selection: the source file of one embedded
 * HTML/SVG board, otherwise the selected layers as JSON.
 */
export function resolveCanvasCodeTarget(
  objects: Record<string, CanvasShape>,
  editableIds: readonly string[],
  artifacts: readonly DesignArtifact[]
): CanvasCodeTarget {
  const shapes = editableIds.map((id) => objects[id]).filter((shape): shape is CanvasShape => Boolean(shape))
  if (shapes.length === 0) return null
  const file = shapes.length === 1 ? embeddedArtifactFile(shapes[0], artifacts) : null
  if (file) return { kind: 'file', path: file.path, revision: file.artifact.updatedAt }
  return {
    kind: 'layers',
    path: 'layers.json',
    content: JSON.stringify(shapes.length === 1 ? shapeForCode(shapes[0]) : shapes.map(shapeForCode), null, 2)
  }
}

type FileState =
  | { status: 'loading' }
  | { status: 'ready'; content: string; truncated: boolean }
  | { status: 'error'; message: string }

function useCanvasCodeFile(workspaceRoot: string, path: string | null, revision: string): FileState {
  const [state, setState] = useState<FileState>({ status: 'loading' })
  useEffect(() => {
    if (!path) return
    let cancelled = false
    setState({ status: 'loading' })
    const read = window.kunGui?.readWorkspaceFile
    if (typeof read !== 'function') {
      setState({ status: 'error', message: 'unavailable' })
      return
    }
    void read({ path, workspaceRoot })
      .then((result) => {
        if (cancelled) return
        setState(result.ok
          ? { status: 'ready', content: result.content, truncated: result.truncated }
          : { status: 'error', message: result.message ?? '' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [path, revision, workspaceRoot])
  return state
}

function CanvasCodePanelInner({ workspaceRoot }: { workspaceRoot: string }): ReactElement {
  const { t } = useTranslation('common')
  const document = useCanvasShapeStore((s) => s.document)
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const [copied, setCopied] = useState(false)
  const target = useMemo(
    () => resolveCanvasCodeTarget(document.objects, filterEditableShapeIds(document, selectedIds), artifacts),
    [artifacts, document, selectedIds]
  )
  const file = useCanvasCodeFile(
    workspaceRoot,
    target?.kind === 'file' ? target.path : null,
    target?.kind === 'file' ? target.revision : ''
  )
  const content = target?.kind === 'layers'
    ? target.content
    : file.status === 'ready' ? file.content : ''

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1_400)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!target) {
    return (
      <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-ds-faint">
        <FileCode2 className="h-5 w-5" strokeWidth={1.6} />
        {t('canvasCodeEmpty')}
      </div>
    )
  }

  const copy = (): void => {
    if (!content) return
    void navigator.clipboard?.writeText(content).then(() => setCopied(true)).catch(() => undefined)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ds-border-muted px-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ds-muted" title={target.path}>
          {target.kind === 'layers' ? t('canvasCodeLayerData') : target.path}
        </span>
        <button
          type="button"
          onClick={copy}
          disabled={!content}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
          data-canvas-code-copy="true"
        >
          {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
          {t(copied ? 'canvasCodeCopied' : 'canvasCodeCopy')}
        </button>
      </div>
      {target.kind === 'file' && file.status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-ds-faint">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          {t('canvasCodeLoading')}
        </div>
      ) : target.kind === 'file' && file.status === 'error' ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-ds-danger">
          {t('canvasCodeReadFailed')}
        </div>
      ) : (
        <WorkspaceCodePreview content={content} path={target.path} className="min-h-0 flex-1" />
      )}
    </div>
  )
}

export const CanvasCodePanel = memo(CanvasCodePanelInner)

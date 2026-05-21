import type { WorkspaceFileReadResult, WorkspaceFileTarget } from '@shared/workspace-file'
import { Check, Copy, ExternalLink, FileCode2, Loader2, PanelRightClose } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import { openWorkspacePathInEditor } from '../lib/open-workspace-path'

type Props = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  className?: string
  onClose: () => void
}

const COPY_RESET_MS = 1400

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

export function WorkspaceFilePreviewPanel({
  target,
  workspaceRoot,
  className,
  onClose
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [result, setResult] = useState<WorkspaceFileReadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const copyResetRef = useRef<number | null>(null)

  useEffect(() => {
    if (!target) {
      setResult(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setResult(null)

    void window.dsGui
      .readWorkspaceFile({
        ...target,
        workspaceRoot: target.workspaceRoot ?? workspaceRoot
      })
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .catch((error) => {
        if (!cancelled) {
          setResult({
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [target, workspaceRoot])

  useEffect(() => {
    if (!result?.ok || !result.line) return
    const id = window.requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector(`[data-line="${result.line}"]`)
      row?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [result])

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    },
    []
  )

  const displayPath = useMemo(() => {
    if (result?.ok) return formatFilePathForDisplay(result.path, workspaceRoot) ?? result.path
    return target?.path ?? ''
  }, [result, target, workspaceRoot])
  const lines = useMemo(() => (result?.ok ? result.content.split('\n') : []), [result])

  const openInEditor = (): void => {
    const path = result?.ok ? result.path : target?.path
    if (!path) return
    void openWorkspacePathInEditor(
      {
        path,
        line: result?.ok ? result.line : target?.line,
        column: result?.ok ? result.column : target?.column
      },
      target?.workspaceRoot ?? workspaceRoot
    ).then((next) => {
      if (!next.ok) {
        void window.dsGui?.logError?.('editor-open', 'Failed to open previewed file', {
          message: next.message,
          target
        })
      }
    })
  }

  const copyPath = async (): Promise<void> => {
    const path = result?.ok ? result.path : target?.path
    if (!path || !navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(path)
    setCopied(true)
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
  }

  return (
    <aside
      className={`ds-no-drag ds-panel-ghost flex min-h-0 flex-col border-l border-ds-border-muted backdrop-blur-xl ${className ?? ''}`}
    >
      <div className="flex min-h-[58px] shrink-0 items-center gap-3 border-b border-ds-border-muted px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="ds-sidebar-toggle-button shrink-0"
          title={t('rightPanelCollapse')}
          aria-label={t('rightPanelCollapse')}
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
        </button>
        <div className="ds-card-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ds-muted">
          <FileCode2 className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </div>
        <button
          type="button"
          onDoubleClick={openInEditor}
          className="min-w-0 flex-1 text-left"
          title={displayPath}
        >
          <div className="truncate text-[13px] font-semibold text-ds-ink">
            {displayPath ? fileNameFromPath(displayPath) : t('filePreviewTitle')}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-ds-faint">
            {displayPath || t('filePreviewEmpty')}
          </div>
        </button>
        <button
          type="button"
          onClick={openInEditor}
          disabled={!target}
          className="rounded-md p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
          title={t('filePreviewOpenEditor')}
          aria-label={t('filePreviewOpenEditor')}
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void copyPath()}
          disabled={!target}
          className="rounded-md p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
          title={copied ? t('copySuccess') : t('filePreviewCopyPath')}
          aria-label={copied ? t('copySuccess') : t('filePreviewCopyPath')}
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600" strokeWidth={2} />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!target ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-ds-muted">
            {t('filePreviewEmpty')}
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            {t('filePreviewLoading')}
          </div>
        ) : result?.ok ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ds-border-muted/70 px-4 py-2 font-mono text-[11px] text-ds-faint">
              <span className="truncate">{formatBytes(result.size)}</span>
              {result.truncated ? (
                <span className="shrink-0 text-amber-700 dark:text-amber-300">
                  {t('filePreviewTruncated')}
                </span>
              ) : null}
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-auto bg-ds-subtle/35 font-mono text-[12px] leading-[22px] text-ds-ink"
            >
              <table className="w-max min-w-full border-collapse">
                <tbody>
                  {lines.map((line, index) => {
                    const lineNo = index + 1
                    const active = result.line === lineNo
                    return (
                      <tr
                        key={lineNo}
                        data-line={lineNo}
                        className={active ? 'bg-accent/10 text-ds-ink' : 'hover:bg-ds-hover/45'}
                      >
                        <td className="select-none border-r border-ds-border-muted/45 px-3 text-right tabular-nums text-ds-faint">
                          {lineNo}
                        </td>
                        <td className="whitespace-pre px-3 pr-6">{line || ' '}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-red-700 dark:text-red-300">
            {result?.message ?? t('filePreviewFailed')}
          </div>
        )}
      </div>
    </aside>
  )
}

import type { WorkspaceFileReadResult, WorkspaceFileTarget } from '@shared/workspace-file'
import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  ExternalLink,
  FileCode2,
  Loader2,
  PanelRightClose,
  X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { harden } from 'rehype-harden'
import rehypeRaw from 'rehype-raw'
import type { PluggableList } from 'unified'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import { openWorkspacePathInEditor } from '../lib/open-workspace-path'
import {
  highlightCodeHtml,
  languageFromFilePath,
  renderFallbackCodeHtml
} from '../lib/code-highlighting'
import { isWorkspaceTextPreviewPath } from '../lib/workspace-text-preview'
import {
  initialWriteMarkdownImageSrc,
  loadWriteMarkdownImage
} from '../write/markdown-image'

type Props = {
  target: WorkspaceFileTarget | null
  openTargets?: WorkspaceFileTarget[]
  workspaceRoot: string
  className?: string
  onSelectTarget?: (target: WorkspaceFileTarget) => void
  onCloseTarget?: (target: WorkspaceFileTarget) => void
  onClose: () => void
}

const COPY_RESET_MS = 1400
const MARKDOWN_DEFAULT_ORIGIN = 'https://kun.local'
const markdownRehypePlugins = [
  rehypeRaw,
  [
    harden,
    {
      defaultOrigin: MARKDOWN_DEFAULT_ORIGIN,
      allowedLinkPrefixes: ['*'],
      allowedImagePrefixes: ['*']
    }
  ]
] as unknown as PluggableList

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function splitPath(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean)
}

function relativePathSegments(path: string, workspaceRoot: string): string[] {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return splitPath(normalizedPath.slice(normalizedRoot.length + 1))
  }
  return [fileNameFromPath(path)]
}

function extensionBadge(path: string, language: string): string {
  const fileName = fileNameFromPath(path)
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : ''
  const value = ext || language || 'txt'
  return value.slice(0, 3).toUpperCase()
}

function targetKey(target: WorkspaceFileTarget | null | undefined): string {
  if (!target?.path) return ''
  return `${target.workspaceRoot ?? ''}\n${target.path}`.replaceAll('\\', '/').toLowerCase()
}

function isMarkdownPreviewPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

function normalizePreviewImageSrc(src: string | undefined): string | undefined {
  if (!src?.startsWith(`${MARKDOWN_DEFAULT_ORIGIN}/`)) return src

  try {
    const url = new URL(src)
    if (url.origin !== MARKDOWN_DEFAULT_ORIGIN) return src
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return src
  }
}

type ResolvedPreviewImageProps = {
  src?: string
  alt?: string | null
  filePath?: string | null
} & Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt'>

function ResolvedPreviewImage({
  src,
  alt,
  filePath,
  ...props
}: ResolvedPreviewImageProps): ReactElement {
  const normalizedSrc = normalizePreviewImageSrc(src)
  const [resolvedSrc, setResolvedSrc] = useState(() => initialWriteMarkdownImageSrc(normalizedSrc, filePath))
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    setResolvedSrc(initialWriteMarkdownImageSrc(normalizedSrc, filePath))

    void loadWriteMarkdownImage(normalizedSrc, filePath).then((next) => {
      if (cancelled) return
      if (next.ok) {
        setResolvedSrc(next.src)
      } else {
        setLoadError(next.message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [normalizedSrc, filePath])

  if (loadError) {
    return (
      <span
        className="inline-flex max-w-full items-center rounded-lg border border-red-200/70 bg-red-50/80 px-2 py-1 text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        title={loadError}
      >
        {alt || src || 'Image could not be loaded'}
      </span>
    )
  }

  if (!resolvedSrc) {
    return (
      <span
        className="inline-flex max-w-full items-center rounded-lg border border-ds-border px-2 py-1 text-[12px] text-ds-muted"
        title={src}
      >
        {alt || src || 'Image'}
      </span>
    )
  }

  return <img {...props} src={resolvedSrc} alt={alt ?? ''} />
}

export function WorkspaceFilePreviewPanel({
  target,
  openTargets = target ? [target] : [],
  workspaceRoot,
  className,
  onSelectTarget,
  onCloseTarget,
  onClose
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [result, setResult] = useState<WorkspaceFileReadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [markdownRendered, setMarkdownRendered] = useState(true)
  const [highlightHtml, setHighlightHtml] = useState(() => renderFallbackCodeHtml(''))
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

    if (!isWorkspaceTextPreviewPath(target.path)) {
      setResult({
        ok: false,
        message: t('filePreviewUnsupported')
      })
      setLoading(false)
      return
    }

    void window.kunGui
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
  }, [t, target, workspaceRoot])

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
    const root = target?.workspaceRoot ?? workspaceRoot
    if (result?.ok) return formatFilePathForDisplay(result.path, root) ?? fileNameFromPath(result.path)
    return target?.path ? formatFilePathForDisplay(target.path, root) ?? fileNameFromPath(target.path) : ''
  }, [result, target, workspaceRoot])
  const language = useMemo(() => {
    if (result?.ok) return languageFromFilePath(result.path)
    return target?.path ? languageFromFilePath(target.path) : ''
  }, [result, target])
  const activeTargetKey = targetKey(target)
  const isMarkdownFile = isMarkdownPreviewPath(result?.ok ? result.path : target?.path ?? '')
  const lines = useMemo(() => (result?.ok ? result.content.split('\n') : []), [result])
  const breadcrumbSegments = useMemo(() => {
    const path = result?.ok ? result.path : target?.path ?? ''
    if (!path) return []
    return relativePathSegments(path, target?.workspaceRoot ?? workspaceRoot)
  }, [result, target, workspaceRoot])
  const currentFileName = displayPath ? fileNameFromPath(displayPath) : t('filePreviewTitle')
  const badge = extensionBadge(result?.ok ? result.path : target?.path ?? '', language)
  const activeLine = result?.ok && result.line && result.line >= 1 && result.line <= lines.length
    ? result.line
    : null
  const codeSurfaceStyle = activeLine
    ? ({
        '--ds-file-preview-active-line': activeLine - 1
      } as CSSProperties)
    : undefined

  useEffect(() => {
    if (!result?.ok) {
      setHighlightHtml(renderFallbackCodeHtml(''))
      return
    }

    let cancelled = false
    const fallback = renderFallbackCodeHtml(result.content)
    setHighlightHtml(fallback)

    void highlightCodeHtml(result.content, language).then((html) => {
      if (!cancelled) setHighlightHtml(html)
    })

    return () => {
      cancelled = true
    }
  }, [result, language])

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
        void window.kunGui?.logError?.('editor-open', 'Failed to open previewed file', {
          message: next.message,
          target
        })?.catch(() => undefined)
      }
    })
  }

  const copyContent = async (): Promise<void> => {
    if (!result?.ok || !navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(result.content)
      setCopied(true)
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
      copyResetRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside
      className={`ds-no-drag ds-code-sidebar flex min-h-0 flex-col border-l border-ds-border-muted ${className ?? ''}`}
    >
      <div className="ds-code-sidebar-topbar">
        <div className="ds-code-sidebar-tabs" role="tablist" aria-label={t('filePreviewOpenFiles')}>
          {(openTargets.length ? openTargets : target ? [target] : []).map((item) => {
            const active = targetKey(item) === activeTargetKey
            const itemPath = item.path
            const itemRoot = item.workspaceRoot ?? workspaceRoot
            const itemLabel = fileNameFromPath(itemPath)
            const itemBadge = extensionBadge(itemPath, languageFromFilePath(itemPath))
            const itemTitle = formatFilePathForDisplay(itemPath, itemRoot) ?? itemPath
            return (
              <div
                key={targetKey(item)}
                role="tab"
                tabIndex={0}
                aria-selected={active}
                onDoubleClick={openInEditor}
                onClick={() => onSelectTarget?.(item)}
                className={`ds-code-sidebar-tab ${active ? 'is-active' : ''}`}
                title={itemTitle}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSelectTarget?.(item)
                }}
              >
                <span className="ds-code-sidebar-file-badge">{itemBadge}</span>
                <span className="min-w-0 truncate">{itemLabel}</span>
                {onCloseTarget ? (
                  <button
                    type="button"
                    aria-label={t('filePreviewCloseTab', { file: itemLabel })}
                    title={t('filePreviewCloseTab', { file: itemLabel })}
                    className="ds-code-sidebar-tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTarget(item)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      onCloseTarget(item)
                    }}
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                ) : null}
              </div>
            )
          })}
          {!openTargets.length && !target ? (
            <div
              role="tab"
              aria-selected="false"
              className="ds-code-sidebar-tab"
              title={t('filePreviewEmpty')}
            >
              <span className="ds-code-sidebar-file-badge">{badge}</span>
              <span className="truncate">{currentFileName}</span>
            </div>
          ) : null}
        </div>

        <div className="ds-code-sidebar-actions">
          {isMarkdownFile ? (
            <button
              type="button"
              onClick={() => setMarkdownRendered((value) => !value)}
              disabled={!result?.ok}
              className="ds-code-sidebar-icon-button"
              title={markdownRendered ? t('filePreviewShowSource') : t('filePreviewRenderMarkdown')}
              aria-label={markdownRendered ? t('filePreviewShowSource') : t('filePreviewRenderMarkdown')}
              aria-pressed={markdownRendered}
            >
              {markdownRendered ? (
                <Code2 className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Eye className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={openInEditor}
            disabled={!target}
            className="ds-code-sidebar-icon-button"
            title={t('filePreviewOpenEditor')}
            aria-label={t('filePreviewOpenEditor')}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => void copyContent()}
            disabled={!result?.ok}
            className="ds-code-sidebar-icon-button"
            title={copied ? t('copySuccess') : t('filePreviewCopyContent')}
            aria-label={copied ? t('copySuccess') : t('filePreviewCopyContent')}
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" strokeWidth={2} />
            ) : (
              <Copy className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ds-code-sidebar-icon-button"
            title={t('rightPanelCollapse')}
            aria-label={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
      </div>

      <div className="ds-code-sidebar-breadcrumbs">
        <div className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden">
          {breadcrumbSegments.length ? breadcrumbSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="contents">
              {index > 0 ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint/70" strokeWidth={1.8} />
              ) : null}
              <span
                className={[
                  'truncate',
                  index === breadcrumbSegments.length - 1 ? 'text-ds-ink' : 'text-ds-muted'
                ].join(' ')}
                title={segment}
              >
                {segment}
              </span>
            </span>
          )) : (
            <span className="truncate text-ds-muted">{t('filePreviewEmpty')}</span>
          )}
        </div>
        {result?.ok ? (
          <span className="shrink-0 font-mono text-[10px] text-ds-faint">
            {formatBytes(result.size)}
            {language ? ` · ${language}` : ''}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!target ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-ds-muted">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-ds-border-muted text-ds-faint">
                <FileCode2 className="h-5 w-5" strokeWidth={1.7} />
              </div>
              {t('filePreviewEmpty')}
            </div>
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            {t('filePreviewLoading')}
          </div>
        ) : result?.ok ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {result.truncated ? (
              <div className="shrink-0 border-b border-ds-border-muted/70 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                {t('filePreviewTruncated')}
              </div>
            ) : null}
            {isMarkdownFile && markdownRendered ? (
              <div className="ds-file-preview-markdown min-h-0 flex-1 overflow-auto px-5 py-4">
                <div className="ds-markdown min-h-full text-ds-ink">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={markdownRehypePlugins}
                    components={{
                      a: ({ href, children, ...props }): ReactNode => (
                        <a
                          {...props}
                          href={href}
                          onClick={(event) => {
                            if (!href) return
                            event.preventDefault()
                            void window.kunGui?.openExternal?.(href)?.catch(() => undefined)
                          }}
                        >
                          {children}
                        </a>
                      ),
                      img: ({ src, alt, ...props }): ReactNode => (
                        <ResolvedPreviewImage
                          {...props}
                          src={src}
                          alt={alt}
                          filePath={result.path}
                        />
                      )
                    }}
                  >
                    {result.content}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="ds-file-preview-scroll min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[22px] text-ds-ink"
              >
                <div
                  className="ds-file-preview-code-surface"
                  style={codeSurfaceStyle}
                >
                  {activeLine ? (
                    <div className="ds-file-preview-active-line" aria-hidden="true" />
                  ) : null}
                  <div className="ds-file-preview-gutter">
                    {lines.map((_, index) => {
                      const lineNo = index + 1
                      return (
                        <div
                          key={lineNo}
                          data-line={lineNo}
                          className={`ds-file-preview-line-number ${activeLine === lineNo ? 'is-active' : ''}`}
                        >
                          {lineNo}
                        </div>
                      )
                    })}
                  </div>
                  <div
                    className="ds-file-preview-code-html"
                    dangerouslySetInnerHTML={{ __html: highlightHtml }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-red-700 dark:text-red-300">
            {result?.message ?? t('filePreviewFailed')}
          </div>
        )}
      </div>
    </aside>
  )
}

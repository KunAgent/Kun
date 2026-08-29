import type { Element } from 'hast'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Shapes
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import { StreamdownContext } from 'streamdown'
import {
  findFileReferences,
  type FileReferenceTarget
} from '../../lib/file-references'
import { useValidatedFileReference } from '../../lib/file-reference-validation'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import {
  extensionForLanguage,
  highlightCodeHtml,
  renderFallbackCodeHtml
} from '../../lib/code-highlighting'
import { useTimelineFilePreviewWorkspaceRoot } from './timeline-file-preview-workspace'
import { ChartRenderer } from './ChartRenderer'
import { parseRendererChartSpec } from '../../agent/chart-spec-adapter'

const LANGUAGE_REGEX = /language-([^\s]+)/
const TRAILING_NEWLINES_REGEX = /\n+$/
const PLAIN_TEXT_LANGUAGES = new Set(['', 'plain', 'plaintext', 'text', 'txt'])
const COLLAPSE_HEIGHT = 200
const COPY_RESET_MS = 2000

type CodeProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  'data-block'?: string | boolean
  node?: Element | undefined
}

type MarkdownPoint = { line?: number; column?: number }
type MarkdownPosition = { start?: MarkdownPoint; end?: MarkdownPoint }
type MarkdownNode = {
  position?: MarkdownPosition
}

function sameNodePosition(prev?: MarkdownNode, next?: MarkdownNode): boolean {
  if (!(prev?.position || next?.position)) return true
  if (!(prev?.position && next?.position)) return false

  const prevStart = prev.position.start
  const nextStart = next.position.start
  const prevEnd = prev.position.end
  const nextEnd = next.position.end

  return (
    prevStart?.line === nextStart?.line &&
    prevStart?.column === nextStart?.column &&
    prevEnd?.line === nextEnd?.line &&
    prevEnd?.column === nextEnd?.column
  )
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    return extractText(props.children)
  }
  return ''
}

function downloadCode(code: string, language: string): void {
  const ext = extensionForLanguage(language)
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `code.${ext}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function isPlainTextLanguage(language: string): boolean {
  return PLAIN_TEXT_LANGUAGES.has(language.trim().toLowerCase())
}

function displayCodeLanguage(language: string): string {
  return isPlainTextLanguage(language) ? 'plain text' : language
}

function canvasOpsJsonCount(code: string): number | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(code)
  } catch {
    return null
  }

  const countValue = (value: unknown): number | null => {
    if (Array.isArray(value)) {
      if (value.length === 0) return null
      if (value.every((item) => isRecord(item) && typeof item.op === 'string')) {
        return value.length
      }
      let total = 0
      for (const item of value) {
        const count = countValue(item)
        if (count !== null) total += count
      }
      return total > 0 ? total : null
    }
    if (!isRecord(value)) return null
    if (typeof value.op === 'string') return 1
    const action = typeof value.action === 'string' ? value.action : ''
    if (action === 'add_screen' || action === 'update_shapes' || action === 'create_board') return 1
    return null
  }

  return countValue(parsed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function inlineFileReference(text: string): { text: string; target: FileReferenceTarget } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const matches = findFileReferences(trimmed)
  const match = matches.length === 1 ? matches[0] : null
  if (!match || match.start !== 0 || match.end !== trimmed.length) return null
  return { text: trimmed, target: match.target }
}

function InlineFileReferenceCode({
  text,
  target,
  className
}: {
  text: string
  target: FileReferenceTarget
  className?: string
}): ReactNode {
  const workspaceRoot = useTimelineFilePreviewWorkspaceRoot()
  const validation = useValidatedFileReference(target, workspaceRoot)

  if (validation.status !== 'valid') {
    return (
      <code
        className={className ? `ds-code-inline ${className}` : 'ds-code-inline'}
        data-streamdown="inline-code"
      >
        {text}
      </code>
    )
  }

  const resolvedTarget = { ...target, path: validation.path }

  const handlePreview = (): void => {
    previewWorkspaceFile({ ...resolvedTarget, workspaceRoot })
  }

  const handleOpenEditor = (): void => {
    void openWorkspacePathInEditor(resolvedTarget, workspaceRoot).then((result) => {
      if (!result.ok) {
        void window.kunGui?.logError?.('editor-open', 'Failed to open inline file reference', {
          message: result.message,
          target: resolvedTarget
        })?.catch(() => undefined)
      }
    })
  }

  return (
    <button
      type="button"
      className={`ds-code-inline ds-file-reference-code ${className ?? ''}`.trim()}
      data-streamdown="inline-code"
      title={target.line ? `${target.path}:${target.line}` : target.path}
      onClick={handlePreview}
      onDoubleClick={handleOpenEditor}
    >
      {text}
    </button>
  )
}

function CodeBlock({
  code,
  language
}: {
  code: string
  language: string
}): ReactNode {
  const { t } = useTranslation('common')
  const { isAnimating } = useContext(StreamdownContext)
  const trimmedCode = useMemo(() => code.replace(TRAILING_NEWLINES_REGEX, ''), [code])
  const [html, setHtml] = useState(() => renderFallbackCodeHtml(trimmedCode))
  const [isCopied, setIsCopied] = useState(false)
  const [expandable, setExpandable] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const copyResetRef = useRef<number | null>(null)
  const displayLanguage = displayCodeLanguage(language)

  useEffect(() => {
    let cancelled = false
    setHtml(renderFallbackCodeHtml(trimmedCode))

    void highlightCodeHtml(trimmedCode, language).then((nextHtml) => {
      if (!cancelled) setHtml(nextHtml)
    })

    return () => {
      cancelled = true
    }
  }, [trimmedCode, language])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return

    const update = (): void => {
      setExpandable(el.scrollHeight > COLLAPSE_HEIGHT)
    }

    update()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => update())
    observer.observe(el)
    return () => observer.disconnect()
  }, [html, trimmedCode])

  useEffect(() => {
    setExpanded(false)
  }, [trimmedCode, language])

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    },
    []
  )

  const handleCopy = async (): Promise<void> => {
    if (!navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(trimmedCode)
      setIsCopied(true)
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
      copyResetRef.current = window.setTimeout(() => setIsCopied(false), COPY_RESET_MS)
    } catch {
      setIsCopied(false)
    }
  }

  return (
    <div
      className="ds-code-block"
      data-language={displayLanguage}
      data-streamdown="code-block"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 220px'
      }}
    >
      <div className="ds-code-block-header" data-streamdown="code-block-header">
        <span className="ds-code-block-language">{displayLanguage}</span>
        <div className="ds-code-block-actions">
          <button
            type="button"
            className="ds-code-block-action"
            title={t('codeActionDownload')}
            aria-label={t('codeActionDownload')}
            onClick={() => downloadCode(trimmedCode, language)}
            disabled={isAnimating}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="ds-code-block-action"
            title={t('codeActionCopy')}
            aria-label={t('codeActionCopy')}
            onClick={() => void handleCopy()}
            disabled={isAnimating}
          >
            {isCopied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.1} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />
            )}
          </button>
          {expandable ? (
            <button
              type="button"
              className="ds-code-block-action"
              title={expanded ? t('codeActionCollapse') : t('codeActionExpand')}
              aria-label={expanded ? t('codeActionCollapse') : t('codeActionExpand')}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.9} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={`ds-code-block-body ${expandable && !expanded ? 'is-collapsed' : ''}`}
      >
        <div
          ref={bodyRef}
          className="ds-code-block-html"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {expandable && !expanded ? (
          <button
            type="button"
            className="ds-code-block-fade"
            aria-label={t('codeActionExpand')}
            onClick={() => setExpanded(true)}
          />
        ) : null}
      </div>
    </div>
  )
}

function CodeComponent({ node, className, children, ...props }: CodeProps) {
  const text = extractText(children)
  const startLine = node?.position?.start?.line
  const endLine = node?.position?.end?.line
  const hasLanguageClass = LANGUAGE_REGEX.test(className ?? '')
  const isFencedBlock = props['data-block'] !== undefined
  const hasNodePosition = typeof startLine === 'number' && typeof endLine === 'number'
  const inline = !isFencedBlock && (
    hasNodePosition
      ? startLine === endLine
      : !hasLanguageClass && !text.includes('\n')
  )

  if (inline) {
    const fileReference = inlineFileReference(text)
    if (fileReference) {
      return (
        <InlineFileReferenceCode
          text={fileReference.text}
          target={fileReference.target}
          className={className}
        />
      )
    }

    return (
      <code
        className={className ? `ds-code-inline ${className}` : 'ds-code-inline'}
        data-streamdown="inline-code"
        {...props}
      >
        {children}
      </code>
    )
  }

  const match = className?.match(LANGUAGE_REGEX)
  const language = match?.[1] ?? ''

  if (language === 'chart') {
    const spec = parseRendererChartSpec(text.replace(TRAILING_NEWLINES_REGEX, ''))
    return spec ? <ChartRenderer spec={spec} /> : <CodeBlock code={text} language="json" />
  }

  if (language === 'shapeops' || language === 'design_canvas') {
    return <CanvasOpsChip code={text} language={language} />
  }

  if (language === 'json' && canvasOpsJsonCount(text) !== null) {
    return <CanvasOpsChip code={text} language="design_canvas" />
  }

  if (isPlainTextLanguage(language) && !text.replace(TRAILING_NEWLINES_REGEX, '').trim()) {
    return null
  }

  return <CodeBlock code={text} language={language} />
}

/**
 * Renders ```shapeops``` / ```design_canvas``` blocks as compact chips instead
 * of dumping raw JSON (which may embed full HTML payloads). Click to inspect.
 */
function CanvasOpsChip({
  code,
  language
}: {
  code: string
  language: 'shapeops' | 'design_canvas'
}): ReactNode {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const count = useMemo(() => {
    if (language === 'design_canvas') return canvasOpsJsonCount(code)
    try {
      const parsed = JSON.parse(code)
      return Array.isArray(parsed) ? parsed.length : 1
    } catch {
      return null
    }
  }, [code, language])
  const labelKey = count === null ? 'canvasOpsApplied' : 'canvasOpsAppliedCount'
  const label = count === null ? t(labelKey) : t(labelKey, { count })
  const fallbackLabel = count === null ? 'Canvas ops' : `Canvas ops (${count})`

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[12px] font-medium text-accent transition hover:bg-accent/15"
      >
        <Shapes className="h-3.5 w-3.5" strokeWidth={1.9} />
        {label === labelKey ? fallbackLabel : label}
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded ? (
        <div className="mt-1.5">
          <CodeBlock code={code} language="json" />
        </div>
      ) : null}
    </div>
  )
}

const MemoCode = memo(CodeComponent, (prev, next) => {
  return (
    prev.className === next.className &&
    sameNodePosition(prev.node, next.node) &&
    extractText(prev.children) === extractText(next.children)
  )
})

MemoCode.displayName = 'StreamdownCode'

export { MemoCode as StreamdownCode }

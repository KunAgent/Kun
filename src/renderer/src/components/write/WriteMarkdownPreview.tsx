import {
  Component,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { harden } from 'rehype-harden'
import type { PluggableList } from 'unified'
import { useTranslation } from 'react-i18next'
import {
  initialWriteMarkdownImageSrc,
  loadWriteMarkdownImage
} from '../../write/markdown-image'
import { parsePendingInfographicId } from '../../write/infographic-pending'
import { createInfographicPendingElement } from '../../write/infographic-pending-dom'
import { createHtmlEmbedElement } from '../../write/html-embed-dom'
import { isHtmlEmbedSrc } from '@shared/write-prototype'
import {
  highlightCodeHtml,
  renderFallbackCodeHtml
} from '../../lib/code-highlighting'
import { createMathPlugin } from '@streamdown/math'
import 'katex/dist/katex.min.css'

export {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  writePathToFileUrl
} from '@shared/write-markdown-resource'

type Props = {
  content: string
  isMarkdown: boolean
  filePath?: string | null
  workspaceRoot?: string | null
  previewErrorMessage?: string
}

type MarkdownAstNode = {
  type?: string
  url?: unknown
  identifier?: unknown
  children?: MarkdownAstNode[]
  data?: {
    hProperties?: Record<string, unknown>
    [key: string]: unknown
  }
}

type CodeProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  node?: { tagName?: string }
}

export const writeMarkdownHardenOptions = {
  defaultOrigin: 'https://kun.local',
  allowedLinkPrefixes: ['*'],
  allowedImagePrefixes: ['*']
}

const math = createMathPlugin({
  singleDollarTextMath: false,
  errorColor: 'var(--ds-text-muted)'
})

const rehypePlugins = [
  math.rehypePlugin,
  [
    harden,
    writeMarkdownHardenOptions
  ]
] as unknown as PluggableList

function visitMarkdownAst(node: MarkdownAstNode, visitor: (node: MarkdownAstNode) => void): void {
  visitor(node)
  for (const child of node.children ?? []) {
    visitMarkdownAst(child, visitor)
  }
}

function setRawImageSource(node: MarkdownAstNode, rawSrc: string): void {
  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      'data-raw-src': rawSrc
    }
  }
}

export function preserveRawMarkdownImageSrc() {
  return (tree: MarkdownAstNode): void => {
    const definitions = new Map<string, string>()
    visitMarkdownAst(tree, (node) => {
      if (node.type === 'definition' && typeof node.identifier === 'string' && typeof node.url === 'string') {
        definitions.set(node.identifier.toLowerCase(), node.url)
      }
    })
    visitMarkdownAst(tree, (node) => {
      if (node.type === 'image' && typeof node.url === 'string') {
        setRawImageSource(node, node.url)
        return
      }
      if (node.type === 'imageReference' && typeof node.identifier === 'string') {
        const rawSrc = definitions.get(node.identifier.toLowerCase())
        if (rawSrc) setRawImageSource(node, rawSrc)
      }
    })
  }
}

const remarkPlugins = [
  remarkGfm,
  math.remarkPlugin,
  preserveRawMarkdownImageSrc
] as unknown as PluggableList

const LANGUAGE_REGEX = /language-([^\s]+)/
const TRAILING_NEWLINES_REGEX = /\n+$/
const COLLAPSE_HEIGHT = 200
const COPY_RESET_MS = 2000

function plainTextFallback(content: string): ReactElement {
  return (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13.5px] leading-6 text-ds-ink">
      {content}
    </pre>
  )
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = node.props as { children?: ReactNode }
    return extractText(props.children)
  }
  return ''
}

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  return ok
}

function PreviewCodeBlock({
  code,
  language
}: {
  code: string
  language: string
}): ReactElement {
  const { t } = useTranslation('common')
  const trimmedCode = code.replace(TRAILING_NEWLINES_REGEX, '')
  const [html, setHtml] = useState(() => renderFallbackCodeHtml(trimmedCode))
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [expandable, setExpandable] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const copyResetRef = useRef<number | null>(null)

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
    const element = bodyRef.current
    if (!element) return

    const update = (): void => {
      setExpandable(element.scrollHeight > COLLAPSE_HEIGHT)
    }

    update()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => update())
    observer.observe(element)
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
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(trimmedCode)
      } else if (!copyTextFallback(trimmedCode)) {
        throw new Error('copy-failed')
      }
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
      return
    }
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => {
      setCopied(false)
      setCopyFailed(false)
    }, COPY_RESET_MS)
  }

  return (
    <div className="ds-code-block" data-language={language}>
      <div className="ds-code-block-header">
        <span className="ds-code-block-language">{language || 'text'}</span>
        <div className="ds-code-block-actions">
          <button
            type="button"
            className="ds-code-block-action"
            title={copied ? t('copySuccess') : copyFailed ? t('copyFailed') : t('copyMessage')}
            aria-label={copied ? t('copySuccess') : copyFailed ? t('copyFailed') : t('copyMessage')}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.1} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />
            )}
          </button>
          {expandable ? (
            <button
              type="button"
              className="ds-code-block-action"
              title={expanded ? 'Collapse code' : 'Expand code'}
              aria-label={expanded ? 'Collapse code' : 'Expand code'}
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

      <div className={`ds-code-block-body ${expandable && !expanded ? 'is-collapsed' : ''}`}>
        <div
          ref={bodyRef}
          className="ds-code-block-html"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {expandable && !expanded ? (
          <button
            type="button"
            className="ds-code-block-fade"
            aria-label="Expand code"
            onClick={() => setExpanded(true)}
          />
        ) : null}
      </div>
    </div>
  )
}

function PreviewCode({ className, children, node, ...props }: CodeProps): ReactNode {
  const text = extractText(children)
  const isInline = node?.tagName !== 'code' || (!LANGUAGE_REGEX.test(className ?? '') && !text.includes('\n'))

  if (isInline) {
    return (
      <code
        className={className ? `ds-code-inline ${className}` : 'ds-code-inline'}
        {...props}
      >
        {children}
      </code>
    )
  }

  const match = className?.match(LANGUAGE_REGEX)
  const language = match?.[1] ?? ''
  return <PreviewCodeBlock code={text} language={language} />
}

type ResolvedMarkdownImageProps = {
  src?: string
  alt?: string | null
  filePath?: string | null
  workspaceRoot?: string | null
  'data-raw-src'?: string
} & Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt'>

function PendingInfographicFigure({ id }: { id: string }): ReactElement {
  const hostRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.replaceChildren(createInfographicPendingElement(id))
    return () => host.replaceChildren()
  }, [id])

  return <span ref={hostRef} className="block" />
}

function HtmlEmbedFigure({
  rawSrc,
  alt,
  filePath,
  workspaceRoot
}: {
  rawSrc: string
  alt: string
  filePath: string | null
  workspaceRoot: string | null
}): ReactElement {
  const hostRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.replaceChildren(createHtmlEmbedElement({ rawSrc, alt, filePath, workspaceRoot }))
    return () => host.replaceChildren()
  }, [rawSrc, alt, filePath, workspaceRoot])

  return <span ref={hostRef} className="block" />
}

function ResolvedMarkdownImage({
  src,
  alt,
  filePath,
  workspaceRoot,
  'data-raw-src': rawSrc,
  ...props
}: ResolvedMarkdownImageProps): ReactElement {
  const imageSrc = rawSrc ?? src
  const pendingId = parsePendingInfographicId(imageSrc)
  const htmlEmbed = pendingId === null && isHtmlEmbedSrc(imageSrc)
  const [resolvedSrc, setResolvedSrc] = useState(() => initialWriteMarkdownImageSrc(imageSrc, filePath))
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (pendingId !== null || htmlEmbed) return undefined
    let cancelled = false
    setLoadError(null)
    setResolvedSrc(initialWriteMarkdownImageSrc(imageSrc, filePath))

    void loadWriteMarkdownImage(imageSrc, filePath)
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setResolvedSrc(result.src)
        } else {
          setLoadError(result.message)
        }
      })

    return () => {
      cancelled = true
    }
  }, [imageSrc, filePath, pendingId, htmlEmbed])

  if (pendingId !== null) {
    return <PendingInfographicFigure id={pendingId} />
  }

  if (htmlEmbed && imageSrc) {
    return (
      <HtmlEmbedFigure
        rawSrc={imageSrc}
        alt={alt ?? ''}
        filePath={filePath ?? null}
        workspaceRoot={workspaceRoot ?? null}
      />
    )
  }

  if (loadError) {
    return (
      <span
        className="inline-flex max-w-full items-center rounded-lg border border-red-200/70 bg-red-50/80 px-2 py-1 text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        title={loadError}
      >
        {alt || imageSrc || 'Image could not be loaded'}
      </span>
    )
  }

  if (!resolvedSrc) {
    return (
      <span
        className="inline-flex max-w-full items-center rounded-lg border border-ds-border px-2 py-1 text-[12px] text-ds-muted"
        title={imageSrc}
      >
        {alt || imageSrc || 'Image'}
      </span>
    )
  }

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt ?? ''}
    />
  )
}

type PreviewBoundaryProps = {
  content: string
  filePath?: string | null
  previewErrorMessage: string
  children: ReactNode
}

type PreviewBoundaryState = {
  error: string | null
}

class PreviewErrorBoundary extends Component<PreviewBoundaryProps, PreviewBoundaryState> {
  state: PreviewBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): PreviewBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidUpdate(previousProps: PreviewBoundaryProps): void {
    if (
      this.state.error &&
      (previousProps.content !== this.props.content || previousProps.filePath !== this.props.filePath)
    ) {
      this.setState({ error: null })
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-full px-6 py-6">
        <div className="mb-4 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-[13px] leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
          {this.props.previewErrorMessage}
        </div>
        {plainTextFallback(this.props.content)}
      </div>
    )
  }
}

function WriteMarkdownPreviewContent({ content, isMarkdown, filePath, workspaceRoot }: Props): ReactElement {
  if (!isMarkdown) return plainTextFallback(content)

  return (
    <div className="ds-markdown write-markdown-preview min-h-full text-ds-ink">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
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
            <ResolvedMarkdownImage
              {...props}
              src={src}
              alt={alt}
              filePath={filePath}
              workspaceRoot={workspaceRoot}
            />
          ),
          code: ({ className, children, node, ...props }): ReactNode => (
            <PreviewCode
              className={className}
              node={node}
              {...props}
            >
              {children}
            </PreviewCode>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function WriteMarkdownPreview(props: Props): ReactElement {
  return (
    <PreviewErrorBoundary
      content={props.content}
      filePath={props.filePath}
      previewErrorMessage={props.previewErrorMessage ?? 'Markdown preview failed, showing source text instead.'}
    >
      <WriteMarkdownPreviewContent {...props} />
    </PreviewErrorBoundary>
  )
}

import type { Element } from 'hast'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download
} from 'lucide-react'
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
import type { ThemeRegistration } from 'shiki'
import { StreamdownContext } from 'streamdown'
import {
  findFileReferences,
  type FileReferenceTarget
} from '../../lib/file-references'
import { useValidatedFileReference } from '../../lib/file-reference-validation'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { useChatStore } from '../../store/chat-store'

const LANGUAGE_REGEX = /language-([^\s]+)/
const TRAILING_NEWLINES_REGEX = /\n+$/
const COLLAPSE_HEIGHT = 200
const COPY_RESET_MS = 2000
const CODEX_CODE_THEME = {
  name: 'codex',
  displayName: 'Codex',
  type: 'dark',
  fg: '#ffffff',
  bg: '#181818',
  colors: {
    'editor.background': '#181818',
    'editor.foreground': '#ffffff',
    'editor.selectionBackground': '#339cff44',
    'editor.inactiveSelectionBackground': '#339cff22',
    'editor.lineHighlightBackground': '#ffffff08',
    'editorCursor.foreground': '#ffffff',
    'editorGutter.addedBackground': '#40c977',
    'editorGutter.deletedBackground': '#fa423e',
    'editorGutter.modifiedBackground': '#339cff',
    'diffEditor.insertedTextBackground': '#40c97724',
    'diffEditor.removedTextBackground': '#fa423e24',
    'terminal.ansiGreen': '#40c977',
    'terminal.ansiRed': '#fa423e',
    'terminal.ansiBlue': '#339cff',
    'terminal.ansiMagenta': '#ad7bf9'
  },
  settings: [
    {
      settings: {
        foreground: '#ffffff',
        background: '#181818'
      }
    },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: {
        foreground: '#858585',
        fontStyle: 'italic'
      }
    },
    {
      scope: ['keyword', 'storage', 'storage.type', 'storage.modifier'],
      settings: {
        foreground: '#fa423e'
      }
    },
    {
      scope: ['string', 'punctuation.definition.string'],
      settings: {
        foreground: '#40c977'
      }
    },
    {
      scope: ['constant', 'constant.numeric', 'variable.language', 'support.constant'],
      settings: {
        foreground: '#7bbcff'
      }
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'meta.function-call',
        'entity.name.type',
        'entity.other.inherited-class'
      ],
      settings: {
        foreground: '#ad7bf9'
      }
    },
    {
      scope: ['variable.parameter', 'variable.other', 'meta.property-name', 'support.type.property-name'],
      settings: {
        foreground: '#c7c7c7'
      }
    },
    {
      scope: ['entity.name.tag', 'entity.other.attribute-name'],
      settings: {
        foreground: '#339cff'
      }
    },
    {
      scope: ['punctuation', 'meta.brace'],
      settings: {
        foreground: '#c7c7c7'
      }
    },
    {
      scope: ['markup.inserted', 'meta.diff.header.to-file', 'punctuation.definition.inserted'],
      settings: {
        foreground: '#40c977',
        background: '#173222'
      }
    },
    {
      scope: ['markup.deleted', 'meta.diff.header.from-file', 'punctuation.definition.deleted'],
      settings: {
        foreground: '#fa423e',
        background: '#351b1b'
      }
    },
    {
      scope: ['markup.changed', 'punctuation.definition.changed', 'meta.diff.range'],
      settings: {
        foreground: '#339cff'
      }
    }
  ]
} satisfies ThemeRegistration
const SHIKI_THEMES = {
  light: 'github-light',
  dark: CODEX_CODE_THEME
} as const

const LANGUAGE_ALIASES: Record<string, string> = {
  csharp: 'cs',
  docker: 'dockerfile',
  plaintext: '',
  shellscript: 'shell',
  text: '',
  typescriptreact: 'tsx',
  javascriptreact: 'jsx'
}

const DOWNLOAD_EXTENSIONS: Record<string, string> = {
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  cs: 'cs',
  css: 'css',
  diff: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  html: 'html',
  java: 'java',
  js: 'js',
  json: 'json',
  jsx: 'jsx',
  md: 'md',
  php: 'php',
  py: 'py',
  python: 'py',
  rb: 'rb',
  rs: 'rs',
  rust: 'rs',
  sh: 'sh',
  shell: 'sh',
  sql: 'sql',
  swift: 'swift',
  ts: 'ts',
  tsx: 'tsx',
  txt: 'txt',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yml',
  yml: 'yml'
}

type CodeProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  node?: Element | undefined
}

type MarkdownPoint = { line?: number; column?: number }
type MarkdownPosition = { start?: MarkdownPoint; end?: MarkdownPoint }
type MarkdownNode = {
  position?: MarkdownPosition
}

let shikiPromise: Promise<typeof import('shiki')> | null = null
const highlightCache = new Map<string, string>()
const inflightHighlights = new Map<string, Promise<string>>()

function loadShiki(): Promise<typeof import('shiki')> {
  shikiPromise ??= import('shiki')
  return shikiPromise
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

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderFallbackHtml(code: string): string {
  const lines = code.split('\n')
  return `<pre class="shiki shiki-themes"><code>${lines
    .map((line) => `<span class="line">${line ? escapeHtml(line) : ' '}</span>`)
    .join('\n')}</code></pre>`
}

function normalizeLanguage(language: string): string {
  const raw = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[raw] ?? raw
}

async function highlightCodeHtml(code: string, language: string): Promise<string> {
  const normalized = normalizeLanguage(language)
  const cacheKey = `${normalized || 'plain'}\u0000${code}`
  const cached = highlightCache.get(cacheKey)
  if (cached) return cached

  const inflight = inflightHighlights.get(cacheKey)
  if (inflight) return inflight

  const task = (async () => {
    if (!normalized) {
      const fallback = renderFallbackHtml(code)
      highlightCache.set(cacheKey, fallback)
      return fallback
    }

    try {
      const { codeToHtml } = await loadShiki()
      const html = await codeToHtml(code, {
        lang: normalized,
        themes: SHIKI_THEMES
      })
      highlightCache.set(cacheKey, html)
      return html
    } catch {
      const fallback = renderFallbackHtml(code)
      highlightCache.set(cacheKey, fallback)
      return fallback
    }
  })()

  inflightHighlights.set(cacheKey, task)
  try {
    return await task
  } finally {
    inflightHighlights.delete(cacheKey)
  }
}

function extensionForLanguage(language: string): string {
  const normalized = normalizeLanguage(language)
  if (!normalized) return 'txt'
  return DOWNLOAD_EXTENSIONS[normalized] ?? normalized
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
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
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
        void window.dsGui?.logError?.('editor-open', 'Failed to open inline file reference', {
          message: result.message,
          target: resolvedTarget
        })
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
  const { isAnimating } = useContext(StreamdownContext)
  const trimmedCode = useMemo(() => code.replace(TRAILING_NEWLINES_REGEX, ''), [code])
  const [html, setHtml] = useState(() => renderFallbackHtml(trimmedCode))
  const [isCopied, setIsCopied] = useState(false)
  const [expandable, setExpandable] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const copyResetRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setHtml(renderFallbackHtml(trimmedCode))

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
    await navigator.clipboard.writeText(trimmedCode)
    setIsCopied(true)
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => setIsCopied(false), COPY_RESET_MS)
  }

  return (
    <div
      className="ds-code-block"
      data-language={language}
      data-streamdown="code-block"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 220px'
      }}
    >
      <div className="ds-code-block-header" data-streamdown="code-block-header">
        <span className="ds-code-block-language">{language || 'text'}</span>
        <div className="ds-code-block-actions">
          <button
            type="button"
            className="ds-code-block-action"
            title="Download code"
            aria-label="Download code"
            onClick={() => downloadCode(trimmedCode, language)}
            disabled={isAnimating}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="ds-code-block-action"
            title="Copy code"
            aria-label="Copy code"
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
            aria-label="Expand code"
            onClick={() => setExpanded(true)}
          />
        ) : null}
      </div>
    </div>
  )
}

function CodeComponent({ node, className, children, ...props }: CodeProps) {
  const inline = node?.position?.start?.line === node?.position?.end?.line

  if (inline) {
    const text = extractText(children)
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
  const code = extractText(children)

  return <CodeBlock code={code} language={language} />
}

const MemoCode = memo(CodeComponent, (prev, next) => {
  return prev.className === next.className && sameNodePosition(prev.node, next.node)
})

MemoCode.displayName = 'StreamdownCode'

export { MemoCode as StreamdownCode }

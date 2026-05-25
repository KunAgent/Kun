import { Component, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { harden } from 'rehype-harden'
import type { PluggableList } from 'unified'

type Props = {
  content: string
  isMarkdown: boolean
  filePath?: string | null
  previewErrorMessage?: string
}

export const writeMarkdownHardenOptions = {
  defaultOrigin: 'https://deepseek-gui.local',
  allowedLinkPrefixes: ['*'],
  allowedImagePrefixes: ['*']
}

const rehypePlugins = [
  [
    harden,
    writeMarkdownHardenOptions
  ]
] as unknown as PluggableList

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function dirnamePortable(filePath: string): string {
  const normalized = normalizePath(filePath)
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return ''
  if (slash === 0) return '/'
  return normalized.slice(0, slash)
}

function isExplicitUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

function normalizeJoinedPath(pathname: string): string {
  const normalized = normalizePath(pathname)
  const prefix = normalized.startsWith('/') ? '/' : ''
  const parts: string[] = []
  for (const part of normalized.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }
  return `${prefix}${parts.join('/')}`
}

function pathToFileUrl(pathname: string): string {
  const normalized = normalizeJoinedPath(pathname)
  const encoded = normalized
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`
}

export function resolveWriteMarkdownResource(src: string | undefined, filePath?: string | null): string | undefined {
  if (!src?.trim() || !filePath) return src
  const value = src.trim()
  if (isExplicitUrl(value) || value.startsWith('#')) return src
  const [pathname, suffix = ''] = value.split(/([?#].*)/, 2)
  const baseDir = dirnamePortable(filePath)
  if (!baseDir) return src
  const resolved = pathname.startsWith('/')
    ? normalizeJoinedPath(pathname)
    : normalizeJoinedPath(`${baseDir}/${pathname}`)
  return `${pathToFileUrl(resolved)}${suffix}`
}

function plainTextFallback(content: string): ReactElement {
  return (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13.5px] leading-6 text-ds-ink">
      {content}
    </pre>
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

function WriteMarkdownPreviewContent({ content, isMarkdown, filePath }: Props): ReactElement {
  if (!isMarkdown) return plainTextFallback(content)

  return (
    <div className="ds-markdown write-markdown-preview min-h-full text-ds-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ href, children, ...props }): ReactNode => (
            <a
              {...props}
              href={href}
              onClick={(event) => {
                if (!href) return
                event.preventDefault()
                void window.dsGui?.openExternal?.(href)
              }}
            >
              {children}
            </a>
          ),
          img: ({ src, alt, ...props }): ReactNode => (
            <img
              {...props}
              src={resolveWriteMarkdownResource(src, filePath)}
              alt={alt ?? ''}
            />
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

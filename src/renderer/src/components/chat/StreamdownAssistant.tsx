import type { ComponentPropsWithRef, MouseEvent, ReactElement } from 'react'
import { Streamdown, type StreamdownProps } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { harden } from 'rehype-harden'
import 'streamdown/styles.css'
import { parseFileReferenceHref, rehypeFileReferences } from '../../lib/file-references'
import { useValidatedFileReference } from '../../lib/file-reference-validation'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { sanitizeAssistantCanvasToolDisplay } from '../../design/canvas/strip-canvas-tool-display'
import { StreamdownCode } from './StreamdownCode'
import { useAssistantTextReveal } from './use-assistant-text-reveal'
import { useTimelineFilePreviewWorkspaceRoot } from './timeline-file-preview-workspace'
import { createMathPlugin } from '@streamdown/math'
import 'katex/dist/katex.min.css'

export { nextVisibleLength, visibleTextForTypewriter } from './assistant-text-reveal'

const rehypePlugins = [
  rehypeFileReferences,
  [
    harden,
    {
      allowedLinkPrefixes: ['*'],
      // Internal scheme synthesized by rehypeFileReferences; StreamdownLink
      // re-validates every target against the workspace before any click
      // handling, so allowing this protocol does not widen access.
      allowedProtocols: ['deepseek-file:'],
      // Harden's default "indicator" policy appends " [blocked]" after every
      // denied link; that internal security state must not leak into chat.
      linkBlockPolicy: 'text-only'
    }
  ]
] satisfies StreamdownProps['rehypePlugins']

type MarkdownAstNode = {
  type?: unknown
  value?: unknown
  children?: MarkdownAstNode[]
}

function removeHtmlCommentNodes(node: MarkdownAstNode): void {
  if (!Array.isArray(node.children)) return
  node.children = node.children.filter((child) => {
    return !(
      child.type === 'html' &&
      typeof child.value === 'string' &&
      child.value.trimStart().startsWith('<!--')
    )
  })
  for (const child of node.children) removeHtmlCommentNodes(child)
}

/** Hide model-supplied HTML comments without touching code/inlineCode AST nodes. */
export function remarkHideHtmlComments(): (tree: MarkdownAstNode) => void {
  return removeHtmlCommentNodes
}

const math = createMathPlugin({
  singleDollarTextMath: false,
  errorColor: 'var(--ds-text-muted)'
})

const components = {
  code: StreamdownCode,
  a: StreamdownLink
} satisfies StreamdownProps['components']

type StreamdownLinkProps = ComponentPropsWithRef<'a'> & { node?: unknown }

function StreamdownLink({
  href,
  children,
  className,
  title
}: StreamdownLinkProps): ReactElement {
  const workspaceRoot = useTimelineFilePreviewWorkspaceRoot()
  const fileTarget = parseFileReferenceHref(href)
  const validation = useValidatedFileReference(fileTarget, workspaceRoot)
  const isExternal = href ? /^(https?:|mailto:)/i.test(href) : false
  const cleanClassName = className?.replace(/\bds-file-reference-link\b/g, '').trim()

  if (fileTarget && validation.status !== 'valid') {
    return (
      <span className={cleanClassName} title={title}>
        {children}
      </span>
    )
  }

  const resolvedFileTarget =
    fileTarget && validation.status === 'valid'
      ? { ...fileTarget, path: validation.path }
      : null

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (resolvedFileTarget) {
      event.preventDefault()
      previewWorkspaceFile({ ...resolvedFileTarget, workspaceRoot })
      return
    }

    if (isExternal && href && typeof window.kunGui?.openExternal === 'function') {
      event.preventDefault()
      void window.kunGui.openExternal(href).catch(() => undefined)
    }
  }

  const handleDoubleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!resolvedFileTarget) return
    event.preventDefault()
    void openWorkspacePathInEditor(resolvedFileTarget, workspaceRoot).then((result) => {
      if (!result.ok) {
        void window.kunGui?.logError?.('editor-open', 'Failed to open file reference', {
          message: result.message,
          target: resolvedFileTarget
        })?.catch(() => undefined)
      }
    })
  }

  return (
    <a
      href={href}
      title={title}
      className={[
        resolvedFileTarget ? 'ds-file-reference-link' : '',
        cleanClassName
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </a>
  )
}

type Props = {
  /** Markdown source */
  text: string
  /**
   * When true (live SSE chunking), uses Streamdown `streaming` mode with a
   * char-level blur-in on newly appended content.
   */
  streaming: boolean
  className?: string
  /** Hide HTML comment nodes for reasoning-summary presentation. */
  hideHtmlComments?: boolean
}

export function StreamdownAssistant({
  text,
  streaming,
  className,
  hideHtmlComments = false
}: Props): ReactElement {
  const displayText = sanitizeAssistantCanvasToolDisplay(text)
  const pacedText = useAssistantTextReveal(displayText, streaming)
  const remarkPlugins = hideHtmlComments
    ? [remarkGfm, remarkHideHtmlComments]
    : [remarkGfm]

  // While streaming, keep a stable key so the typewriter doesn't tear down
  // mid-stroke. Once settled, key on `text.length` — any subsequent edit
  // remounts Streamdown clean instead of relying on its block-diff to swap
  // children in place, which has been observed to leave stale fragments
  // (bullet tail spliced into the next paragraph) on bullet→paragraph
  // transitions containing inline code.
  const streamdownKey = streaming ? 'live' : `static:${displayText.length}`

  return (
    <Streamdown
      key={streamdownKey}
      className={className}
      mode="static"
      parseIncompleteMarkdown={false}
      isAnimating={false}
      // The pacing hook above is the typewriter. Keep Streamdown's own
      // streaming/remend pipeline disabled here: in long Markdown responses
      // with GFM tables, its block repair path can leave stale text fragments
      // next to the repaired block, producing copied DOM text such as
      // "Work Workstreamstream".
      animated={false}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
      plugins={{ math }}
    >
      {pacedText}
    </Streamdown>
  )
}

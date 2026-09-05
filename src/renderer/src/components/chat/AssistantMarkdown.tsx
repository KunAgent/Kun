import type { ReactElement } from 'react'
import { lazy, Suspense } from 'react'
import { useLiveAssistantStreaming } from './live-assistant-streaming'
import { loadAssistantMarkdownRenderer } from '../../lib/assistant-markdown-loader'

const LazyStreamdownAssistant = lazy(() =>
  loadAssistantMarkdownRenderer().then((module) => ({ default: module.StreamdownAssistant }))
)

export function AssistantMarkdown({
  text,
  streaming,
  className,
  hideHtmlComments = false
}: {
  text: string
  streaming: boolean
  className?: string
  hideHtmlComments?: boolean
}): ReactElement {
  // The bubble's presentation gate keeps catch-up replay out of the
  // typewriter. The context also covers nested Markdown rendered by it.
  const liveStreaming = useLiveAssistantStreaming()
  const effectiveStreaming = streaming && liveStreaming
  const fallbackText = hideHtmlComments
    ? text.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    : text

  return (
    <Suspense
      fallback={
        <div className={className}>
          {fallbackText}
        </div>
      }
    >
      <LazyStreamdownAssistant
        // Switching from hidden catch-up to live output must establish a new
        // typewriter baseline at the already-rendered text length. Otherwise
        // the hook retains its pre-catch-up cursor and re-types the backlog.
        key={effectiveStreaming ? 'streaming' : 'settled'}
        text={text}
        streaming={effectiveStreaming}
        className={className}
        hideHtmlComments={hideHtmlComments}
      />
    </Suspense>
  )
}

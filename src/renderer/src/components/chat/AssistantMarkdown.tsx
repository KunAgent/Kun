import type { ReactElement } from 'react'
import { lazy, Suspense } from 'react'
import { useLiveAssistantStreaming } from './live-assistant-streaming'

let streamdownAssistantModule: Promise<typeof import('./StreamdownAssistant')> | null = null

function loadStreamdownAssistant(): Promise<typeof import('./StreamdownAssistant')> {
  if (!streamdownAssistantModule) {
    streamdownAssistantModule = import('./StreamdownAssistant').catch((error) => {
      streamdownAssistantModule = null
      throw error
    })
  }
  return streamdownAssistantModule
}

const LazyStreamdownAssistant = lazy(() =>
  loadStreamdownAssistant().then((module) => ({ default: module.StreamdownAssistant }))
)

/** Warm the settled Markdown renderer before a restored conversation is revealed. */
export async function prepareAssistantMarkdownRenderer(): Promise<void> {
  await loadStreamdownAssistant()
}

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

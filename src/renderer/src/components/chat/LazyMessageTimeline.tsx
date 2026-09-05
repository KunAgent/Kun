import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode
} from 'react'
import type { MessageTimeline } from './MessageTimeline'
import { useChatStore } from '../../store/chat-store'
import { prepareAssistantMarkdownRenderer } from '../../lib/assistant-markdown-loader'
import { ThreadHydrationGate } from './ThreadHydrationLoading'
import { LiveAssistantStreamingProvider } from './live-assistant-streaming'

const LazyLoadedMessageTimeline = lazy(() =>
  import('./MessageTimeline').then((module) => ({ default: module.MessageTimeline }))
)

export type LazyMessageTimelineProps = ComponentProps<typeof MessageTimeline> & {
  fallback?: ReactNode
}

export function LazyMessageTimeline({
  fallback = null,
  ...props
}: LazyMessageTimelineProps): ReactElement {
  const threadLoadingId = useChatStore((state) => state.threadLoadingId)
  const activeThreadId = props.activeThreadId
  const hydrating = Boolean(activeThreadId && threadLoadingId === activeThreadId)
  const [preparedThreadId, setPreparedThreadId] = useState<string | null>(null)
  const timelineKey = activeThreadId ?? 'empty'

  useEffect(() => {
    if (!activeThreadId) {
      setPreparedThreadId(null)
      return
    }
    let cancelled = false
    void prepareAssistantMarkdownRenderer()
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setPreparedThreadId(activeThreadId)
      })
    return () => {
      cancelled = true
    }
  }, [activeThreadId])

  const preparingRenderer = Boolean(activeThreadId && preparedThreadId !== activeThreadId)
  const trustedContentVisible = props.blocks.length > 0 || Boolean(props.live || props.liveReasoning)
  return (
    <ThreadHydrationGate
      loading={hydrating || preparingRenderer}
      catchingUp={hydrating}
      trustedContentVisible={trustedContentVisible}
      presentationKey={activeThreadId}
    >
      <LiveAssistantStreamingProvider streaming={!hydrating && !preparingRenderer}>
        <Suspense fallback={fallback}>
          <LazyLoadedMessageTimeline key={timelineKey} {...props} />
        </Suspense>
      </LiveAssistantStreamingProvider>
    </ThreadHydrationGate>
  )
}

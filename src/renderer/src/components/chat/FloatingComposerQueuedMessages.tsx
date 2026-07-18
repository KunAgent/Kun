import { useRef, useState, type ReactElement } from 'react'
import { CornerDownRight, ListPlus, Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type QueuedComposerMessage = {
  id: string
  text: string
  displayText?: string
  guidanceEligible?: boolean
}

type Props = {
  messages: QueuedComposerMessage[]
  onRemove: (id: string) => void
  onGuide?: (id: string) => void | Promise<unknown>
}

export function FloatingComposerQueuedMessages({
  messages,
  onRemove,
  onGuide
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const guidingIdsRef = useRef(new Set<string>())
  const [guidingIds, setGuidingIds] = useState<Set<string>>(() => new Set())
  if (messages.length === 0) return null

  const guide = async (id: string): Promise<void> => {
    if (!onGuide || guidingIdsRef.current.has(id)) return
    guidingIdsRef.current.add(id)
    setGuidingIds(new Set(guidingIdsRef.current))
    try {
      await onGuide(id)
    } finally {
      guidingIdsRef.current.delete(id)
      setGuidingIds(new Set(guidingIdsRef.current))
    }
  }

  return (
    <div
      className="mb-2 space-y-2"
      aria-label={t('queuedMessagesTitle', { count: messages.length })}
    >
      {messages.map((message) => {
        const guiding = guidingIds.has(message.id)
        const guidanceEligible = message.guidanceEligible !== false
        const guideTitle = guidanceEligible
          ? t('guideQueuedMessageHint')
          : t('guideQueuedMessageTextOnly')
        return (
          <div
            key={message.id}
            className="group flex min-h-12 min-w-0 items-center gap-2 rounded-[20px] border border-ds-border bg-white/92 px-3 py-2 shadow-[0_8px_26px_rgba(20,47,95,0.07)] backdrop-blur-xl dark:bg-ds-card/94"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint"
              aria-hidden="true"
            >
              <ListPlus className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ds-ink">
              {message.displayText ?? message.text}
            </span>
            {onGuide ? (
              <button
                type="button"
                onClick={() => void guide(message.id)}
                disabled={!guidanceEligible || guiding}
                className="ds-no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
                aria-label={guiding ? t('guideQueuedMessagePending') : t('guideQueuedMessage')}
                title={guiding ? t('guideQueuedMessagePending') : guideTitle}
              >
                {guiding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                ) : (
                  <CornerDownRight className="h-3.5 w-3.5" strokeWidth={1.9} />
                )}
                <span>{guiding ? t('guideQueuedMessagePending') : t('guideQueuedMessage')}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(message.id)}
              disabled={guiding}
              className="ds-no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              aria-label={t('queuedMessageRemove')}
              title={t('queuedMessageRemove')}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

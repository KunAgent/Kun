import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownRight, Reply, X } from 'lucide-react'
import type { DesignComposerContext } from '../../design/design-composer-context'
import type { MessageQuote, MessageQuoteDisplay } from '../../lib/message-quote'
import { jumpToMessageQuoteSource } from '../../lib/message-quote-jump'

type Translate = (key: string, values?: unknown) => string

/** Composer chip for a quote waiting in a side-conversation composer. */
export function messageQuoteComposerChip(quote: MessageQuote): DesignComposerContext {
  return {
    id: quote.id,
    kind: 'message-quote',
    label: quote.role,
    removable: true,
    messageQuote: { text: quote.text, role: quote.role, truncated: quote.truncated }
  }
}

export function ComposerMessageQuoteChip({
  chip,
  onRemove,
  t
}: {
  chip: DesignComposerContext & { messageQuote?: NonNullable<DesignComposerContext['messageQuote']> }
  onRemove?: (id: string) => void
  t: Translate
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const quote = chip.messageQuote!
  const label = quote.role === 'user'
    ? t('messageQuoteReplyingToUser')
    : t('messageQuoteReplyingToAssistant')
  return (
    <div
      className="ds-no-drag flex w-full min-w-0 basis-full items-start gap-2.5 rounded-xl border border-ds-border-muted bg-ds-subtle py-2 pl-2.5 pr-1.5 text-left"
      data-message-quote-chip
    >
      <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
      <button
        type="button"
        className="min-w-0 flex-1 text-left focus-visible:outline-none"
        aria-expanded={expanded}
        title={expanded ? t('messageQuoteCollapse') : t('messageQuoteExpand')}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold leading-4 text-accent">
          <span className="truncate">{label}</span>
          {quote.truncated ? (
            <span className="shrink-0 font-medium text-ds-faint">· {t('messageQuoteTruncated')}</span>
          ) : null}
        </span>
        <span
          className={`mt-0.5 block whitespace-pre-wrap break-words text-[12.5px] font-normal leading-[18px] text-ds-muted [overflow-wrap:anywhere] ${
            expanded ? 'max-h-44 overflow-y-auto' : 'line-clamp-2'
          }`}
        >
          {quote.text}
        </span>
      </button>
      {chip.removable !== false && onRemove ? (
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition-colors hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('messageQuoteRemove')}
          title={t('messageQuoteRemove')}
          onClick={() => onRemove(chip.id)}
        >
          <X className="h-3 w-3" strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/** Quotes a sent user turn replied to, shown above the message text. */
export function SentMessageQuotes({
  quotes
}: {
  quotes: readonly MessageQuoteDisplay[]
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (quotes.length === 0) return null
  return (
    <div className="mb-2 flex min-w-0 flex-col gap-1" data-sent-message-quotes>
      {quotes.map((quote, index) => {
        const canJump = Boolean(quote.sourceBlockId)
        return (
          <button
            key={`${quote.sourceBlockId ?? 'quote'}-${index}`}
            type="button"
            disabled={!canJump}
            onClick={() => jumpToMessageQuoteSource(quote)}
            title={canJump ? t('messageQuoteJumpToSource') : undefined}
            aria-label={canJump
              ? t('messageQuoteJumpToSourceLabel', { text: quote.text.slice(0, 80) })
              : undefined}
            className="flex w-full min-w-0 items-start gap-1.5 rounded-[10px] border border-ds-border-muted bg-ds-subtle px-2 py-1.5 text-left text-[12.5px] font-normal leading-[18px] text-ds-muted transition-colors enabled:hover:bg-ds-hover enabled:hover:text-ds-ink disabled:cursor-default"
          >
            <CornerDownRight className="mt-[3px] h-3 w-3 shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
            <span className="line-clamp-2 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {quote.text}
            </span>
          </button>
        )
      })}
    </div>
  )
}

import {
  ChevronDown,
  Monitor,
  Puzzle,
  Quote,
  Target,
  Type as TypeIcon,
  X
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ReactElement
} from 'react'
import type { DesignComposerContext } from '../../design/design-composer-context'
import { ComposerMessageQuoteChip } from './MessageQuoteViews'
import { TerminalOutputChip } from './TerminalOutputChip'

type Translate = (key: string, values?: unknown) => string

export function FloatingComposerContextChips({
  chips,
  onRemove,
  t
}: {
  chips: DesignComposerContext[]
  onRemove?: (id: string) => void
  t: Translate
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      {chips.map((chip) => chip.kind === 'message-quote' && chip.messageQuote
        ? <ComposerMessageQuoteChip key={chip.id} chip={chip} onRemove={onRemove} t={t} />
        : chip.kind === 'document-quote' && chip.quote
          ? <DocumentQuoteChip key={chip.id} chip={chip} onRemove={onRemove} t={t} />
          : chip.kind === 'terminal-output' && chip.terminalOutput
            ? <TerminalOutputChip key={chip.id} id={chip.id} label={chip.label} output={chip.terminalOutput} onRemove={onRemove} />
            : <DefaultContextChip key={chip.id} chip={chip} onRemove={onRemove} t={t} />)}
    </div>
  )
}

function DocumentQuoteChip({
  chip,
  onRemove,
  t
}: {
  chip: DesignComposerContext & { quote?: NonNullable<DesignComposerContext['quote']> }
  onRemove?: (id: string) => void
  t: Translate
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const quote = chip.quote!
  const pageLabel = quote.pageStart === quote.pageEnd
    ? t('composerDocumentQuotePage', { page: quote.pageStart })
    : t('composerDocumentQuotePages', { start: quote.pageStart, end: quote.pageEnd })
  const charLabel = t('composerDocumentQuoteCharacters', { count: quote.charCount })

  useEffect(() => {
    if (!expanded) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setExpanded(false)
    }
    const closeWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeWithKeyboard)
    }
  }, [expanded])

  return (
    <div
      ref={rootRef}
      className={`ds-no-drag relative inline-flex max-w-full items-center rounded-lg border border-ds-border bg-ds-card text-[12px] shadow-sm ${expanded ? 'h-auto w-full flex-wrap' : 'h-8'}`}
    >
      <button
        type="button"
        data-document-quote-chip
        aria-expanded={expanded}
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-l-lg pl-2 pr-1 text-left hover:bg-ds-hover"
        onClick={() => setExpanded((current) => !current)}
        title={t('composerDocumentQuoteExpand')}
      >
        <Quote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
        <span className="max-w-48 truncate font-medium text-ds-ink">{chip.label}</span>
        <span className="shrink-0 text-ds-faint">· {pageLabel} · {charLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {chip.removable !== false && onRemove ? (
        <button
          type="button"
          className="mr-1 rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('composerRemoveContext')}
          title={t('composerRemoveContext')}
          onClick={() => onRemove(chip.id)}
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      ) : null}
      {expanded ? (
        <div
          role="dialog"
          aria-label={t('composerDocumentQuotePreview')}
          className="w-full basis-full border-t border-ds-border-muted text-left"
        >
          <div className="max-h-44 overflow-auto whitespace-pre-wrap px-3 py-2.5 text-[12px] leading-5 text-ds-muted">
            {quote.text}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DefaultContextChip({
  chip,
  onRemove,
  t
}: {
  chip: DesignComposerContext
  onRemove?: (id: string) => void
  t: Translate
}): ReactElement {
  const Icon = chip.kind === 'extension-context'
    ? Puzzle
    : chip.kind === 'design-target' || chip.kind === 'canvas-selection'
      ? Target
      : chip.kind === 'html-element' ? TypeIcon : Monitor
  const title = chip.detail ? `${chip.label} - ${chip.detail}` : chip.label
  const removable = chip.removable !== false && Boolean(onRemove)
  return (
    <span
      className="ds-no-drag inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-ds-border bg-ds-subtle px-2.5 text-[12px] font-medium text-ds-muted"
      title={title}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
      <span className="max-w-52 truncate text-ds-ink">{chip.label}</span>
      {chip.detail ? <span className="hidden max-w-44 truncate text-ds-faint sm:inline">{chip.detail}</span> : null}
      {removable ? (
        <button
          type="button"
          onClick={() => onRemove?.(chip.id)}
          className="rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label={t('composerRemoveContext')}
          title={t('composerRemoveContext')}
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      ) : null}
    </span>
  )
}

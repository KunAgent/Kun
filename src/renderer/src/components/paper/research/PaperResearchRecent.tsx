import { useMemo, type ReactElement } from 'react'
import { Loader2, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../../../lib/format-relative-time'
import type { AgentHistorySession } from '../../../paper/paper-research-sessions'
import type { PaperSearchHistoryEntry } from '../../../paper/paper-search-prefs'
import { threadLooksRunning } from '../../../store/chat-store-runtime-helpers'

const MAX_CARDS = 6

type Card =
  | { kind: 'agent'; id: string; title: string; at: string; running: boolean; session: AgentHistorySession }
  | { kind: 'quick'; id: string; title: string; at: string; running: false; entry: PaperSearchHistoryEntry }

/**
 * "Recent searches" on the home screen: Agent research sessions (from every
 * space) and quick searches in one list, newest first. Sessions are also the
 * sidebar's conversations, so this is a shortcut, not a second history.
 */
export function PaperResearchRecent({
  sessions,
  quick,
  onOpenSession,
  onRunQuick
}: {
  sessions: readonly AgentHistorySession[]
  quick: readonly PaperSearchHistoryEntry[]
  onOpenSession: (session: AgentHistorySession) => void
  onRunQuick: (entry: PaperSearchHistoryEntry) => void
}): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const cards = useMemo<Card[]>(() => {
    const agent: Card[] = sessions.map((session) => ({
      kind: 'agent',
      id: `a:${session.libraryRoot}:${session.sessionId}`,
      title: session.title,
      at: session.updatedAt ?? '',
      running: threadLooksRunning(session),
      session
    }))
    const fast: Card[] = quick.map((entry) => ({
      kind: 'quick',
      id: `q:${entry.at}:${entry.query}`,
      title: entry.query,
      at: entry.at,
      running: false,
      entry
    }))
    return [...agent, ...fast]
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
      .slice(0, MAX_CARDS)
  }, [sessions, quick])
  if (!cards.length) return null
  return (
    <section aria-label={t('paperRecentTitle')} className="w-full">
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-semibold text-ds-ink">{t('paperRecentTitle')}</h2>
        <span className="flex-1" />
        <span className="text-[12px] text-ds-faint">{t('paperRecentHint')}</span>
      </div>
      <ul className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              onClick={() => (card.kind === 'agent' ? onOpenSession(card.session) : onRunQuick(card.entry))}
              className="flex h-full w-full flex-col gap-2 rounded-xl border border-ds-border-muted bg-ds-main p-3.5 text-left transition hover:border-ds-border hover:bg-ds-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span className="flex items-center gap-1.5 text-[12px] text-ds-faint">
                {card.kind === 'agent' ? (
                  card.running
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ds-accent)]" />
                    : <Sparkles className="h-3.5 w-3.5 text-[var(--ds-accent)]" strokeWidth={1.8} />
                ) : (
                  <Search className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                <span>{t(card.kind === 'agent' ? 'paperRecentAgent' : 'paperRecentQuick')}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {card.running
                    ? t('paperResearchStatusRunning')
                    : card.at ? formatRelativeTime(new Date(card.at).toISOString(), i18n.language) : ''}
                </span>
              </span>
              <span className="line-clamp-2 min-h-[40px] text-[13.5px] font-semibold leading-5 text-ds-ink">{card.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

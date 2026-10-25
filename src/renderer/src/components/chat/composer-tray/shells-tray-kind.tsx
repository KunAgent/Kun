import { useMemo, useState, type ReactElement } from 'react'
import { SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import type { TrayTranslate } from './tray-elapsed'
import type { TrayKind } from './tray-kind'
import { TraySegmentContent } from './tray-primitives'
import { summarizeBackgroundShells, type BackgroundShellSummary } from './shells-tray-data'
import { useBackgroundShellPoller, useDismissedBackgroundShells } from './shells-tray-poller'
import { ShellsTraySheet } from './shells-tray-sheet'
import './shells-tray.css'

/*
 * Background commands segment ("npm run dev •" for one live command and
 * nothing else to report, "2 个后台命令 •1 •1" otherwise) and its sheet
 * (Shells board).
 *
 * Visible while a command of this thread runs, or while a failure from this
 * app session has not been dismissed; successful / stopped commands are only
 * listed while the segment is visible anyway. An open sheet keeps the segment
 * until it closes, so a command finishing does not yank the output away.
 * Polling and the dismissed set live in ./shells-tray-poller (one poller per
 * composer, gated on runtimeReady + an active thread, as before).
 */

/**
 * The single live command when it alone drives the segment label. With a
 * failure next to it the counts label takes over, so the red count never
 * reads as that command's failure.
 */
function soloRunningCommand(summary: BackgroundShellSummary): string | null {
  return summary.running.length === 1 && summary.failed.length === 0 ? summary.running[0]!.command : null
}

/** "1 个在后台 · 1 个失败" (aria label / compact tooltip detail). */
function backgroundShellCountsLabel(summary: BackgroundShellSummary, t: TrayTranslate): string {
  return [
    summary.running.length > 0 ? t('composerTrayShells.inBackground', { count: summary.running.length }) : null,
    summary.failed.length > 0 ? t('composerTrayShells.failedCount', { count: summary.failed.length }) : null
  ].filter(Boolean).join(' · ')
}

/** "后台命令：npm run dev" / "后台命令：2 个在后台 · 1 个失败". */
export function backgroundShellSegmentLabel(summary: BackgroundShellSummary, t: TrayTranslate): string {
  const detail = soloRunningCommand(summary) ?? backgroundShellCountsLabel(summary, t)
  return detail
    ? t('composerTrayShells.ariaLabel', { detail })
    : t('composerTrayShells.title')
}

function SegmentCount({ tone, count }: { tone: 'running' | 'error'; count: number | null }): ReactElement {
  return (
    <span className="ds-shells-segment-count" data-tone={tone}>
      <span
        className="ds-composer-tray-dot"
        data-tone={tone === 'running' ? 'done' : 'error'}
        aria-hidden="true"
      />
      {count !== null ? count : null}
    </span>
  )
}

/**
 * Segment content. Regular: terminal icon + the one live command (mono) and a
 * green dot when nothing else needs attention, else "n 个后台命令" with green
 * / red dot counts. Compact: icon + live count (+ red failure count).
 */
export function ShellsTraySegment({
  summary,
  compact
}: {
  summary: BackgroundShellSummary
  compact: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const running = summary.running.length
  const failed = summary.failed.length
  const solo = soloRunningCommand(summary)
  const icon = <SquareTerminal className="h-3.5 w-3.5" strokeWidth={2} />
  if (compact) {
    return (
      <TraySegmentContent
        compact
        icon={icon}
        count={running > 0 ? running : null}
        trailing={failed > 0 ? (
          <span className="ds-shells-segment-counts"><SegmentCount tone="error" count={failed} /></span>
        ) : null}
      />
    )
  }
  const label = solo !== null
    ? <span className="ds-shells-segment-command ds-shells-mono">{solo}</span>
    : t('composerTrayShells.segmentCount', { count: running + failed || summary.finished.length })
  return (
    <TraySegmentContent
      icon={icon}
      label={label}
      trailing={(
        <span className="ds-shells-segment-counts">
          {running > 0 ? <SegmentCount tone="running" count={solo !== null ? null : running} /> : null}
          {failed > 0 ? <SegmentCount tone="error" count={failed} /> : null}
        </span>
      )}
    />
  )
}

export function useShellsTrayKind(context: FloatingComposerRenderContext): TrayKind | null {
  const { t } = useTranslation('common')
  const threadId = typeof context.activeThreadId === 'string' && context.activeThreadId
    ? context.activeThreadId
    : null
  const runtimeReady = Boolean(context.runtimeReady)
  const { sessions, stop } = useBackgroundShellPoller({ threadId, runtimeReady })
  const dismissed = useDismissedBackgroundShells()
  const [sheetPresent, setSheetPresent] = useState(false)
  const summary = useMemo(
    () => summarizeBackgroundShells(sessions, { dismissed }),
    [dismissed, sessions]
  )
  // Only the main Code composer can take the output as context; side
  // conversations and other compact composers offer "copy output" instead.
  const canSendToKun = context.route === 'chat' && context.compact !== true && context.side !== true

  if (!runtimeReady || !threadId) return null
  const listed = summary.running.length + summary.failed.length + summary.finished.length
  if (!summary.active && !(sheetPresent && listed > 0)) return null

  const solo = soloRunningCommand(summary)
  return {
    id: 'shells',
    align: 'start',
    tone: summary.failed.length > 0 ? 'error' : summary.running.length > 0 ? 'running' : 'default',
    ariaLabel: backgroundShellSegmentLabel(summary, t),
    title: solo ?? undefined,
    marker: 'background-shell',
    segmentAttributes: {
      'data-background-shell-running': summary.running.length,
      'data-background-shell-failed': summary.failed.length
    },
    renderSegment: ({ compact }) => <ShellsTraySegment summary={summary} compact={compact} />,
    renderSheet: ({ close, compact }) => (
      <ShellsTraySheet
        summary={summary}
        compact={compact}
        canSendToKun={canSendToKun}
        onClose={close}
        onStop={stop}
        onPresenceChange={setSheetPresent}
      />
    )
  }
}

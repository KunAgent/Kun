import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { elapsedSecondsSince, formatTrayDuration, useTrayNow, type TrayTranslate } from './tray-elapsed'
import { TraySheetBody, TraySheetHeader } from './tray-primitives'
import { sendOrCopyBackgroundShell } from './shells-tray-actions'
import { backgroundShellOutcome, type BackgroundShellSession, type BackgroundShellSummary } from './shells-tray-data'
import { dismissBackgroundShell } from './shells-tray-poller'
import { BackgroundShellRow, type BackgroundShellRowActions } from './shells-tray-rows'
import './shells-tray.css'

/** "12 分 8 秒 · 1 个在后台 · 1 个失败": longest running time, live count, failures. */
export function backgroundShellSheetSummary(
  summary: BackgroundShellSummary,
  nowMs: number,
  t: TrayTranslate
): string {
  const longest = summary.running[0] ? elapsedSecondsSince(summary.running[0].startedAt, nowMs) : null
  return [
    longest !== null ? formatTrayDuration(longest, t) : null,
    summary.running.length > 0 ? t('composerTrayShells.inBackground', { count: summary.running.length }) : null,
    summary.failed.length > 0 ? t('composerTrayShells.failedCount', { count: summary.failed.length }) : null
  ].filter(Boolean).join(' · ')
}

/** Row expanded by default: the only live command. */
export function defaultExpandedBackgroundShell(summary: BackgroundShellSummary): string | null {
  return summary.running.length === 1 ? summary.running[0]!.id : null
}

function isListedBackgroundShell(summary: BackgroundShellSummary, sessionId: string): boolean {
  return [summary.running, summary.failed, summary.finished].some((rows) => rows.some((row) => row.id === sessionId))
}

/**
 * The row showing its output: the selected one while it is still listed,
 * else the default. `undefined` follows the default, `null` means the user
 * collapsed every row.
 */
export function resolveExpandedBackgroundShell(
  selectedId: string | null | undefined,
  summary: BackgroundShellSummary
): string | null {
  if (selectedId === null) return null
  if (selectedId !== undefined && isListedBackgroundShell(summary, selectedId)) return selectedId
  return defaultExpandedBackgroundShell(summary)
}

/**
 * The "后台命令" sheet: live commands, then failures, then recently finished
 * ones. Owns the one-second clock (running times, "2 分钟前") and which row
 * shows its output, so ticking never re-renders the tray host.
 */
export function ShellsTraySheet({
  summary,
  compact = false,
  canSendToKun,
  onClose,
  onStop,
  onPresenceChange
}: {
  summary: BackgroundShellSummary
  compact?: boolean
  /** The main Code composer can take the output as context ("发给 Kun"). */
  canSendToKun: boolean
  onClose: () => void
  onStop: (sessionId: string) => Promise<void>
  /** Mounted / unmounted, so the segment stays while the sheet is being read. */
  onPresenceChange: (open: boolean) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const nowMs = useTrayNow(true)
  // undefined: follow the default (the only live command); null: user collapsed every row.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined)
  const home = typeof window !== 'undefined' ? window.kunGui?.homeDir : undefined

  useEffect(() => {
    onPresenceChange(true)
    return () => onPresenceChange(false)
  }, [onPresenceChange])

  const sessions: BackgroundShellSession[] = [...summary.running, ...summary.failed, ...summary.finished]
  const expandedId = resolveExpandedBackgroundShell(selectedId, summary)
  // Latch the default: the only live command's output stays open after it
  // finishes or is stopped (it leaves `running`, the sheet is still open).
  if (expandedId !== null && selectedId !== null && selectedId !== expandedId) setSelectedId(expandedId)
  const actions: BackgroundShellRowActions = {
    onToggle: (sessionId) => setSelectedId(sessionId === expandedId ? null : sessionId),
    onStop,
    onDismiss: dismissBackgroundShell,
    onSendToKun: canSendToKun
      ? async (session) => {
          const result = await sendOrCopyBackgroundShell(session)
          if (result === 'attached') onClose()
          return result
        }
      : null
  }

  return (
    <div className="ds-shells-sheet" data-background-shell-sheet>
      <TraySheetHeader
        title={t('composerTrayShells.title')}
        summary={backgroundShellSheetSummary(summary, nowMs, t)}
        onCollapse={onClose}
      />
      {sessions.length === 0 ? (
        <p className="ds-shells-empty">{t('composerTrayShells.empty')}</p>
      ) : (
        <TraySheetBody role="list" aria-label={t('composerTrayShells.title')}>
          {sessions.map((session) => (
            <BackgroundShellRow
              key={session.id}
              session={session}
              outcome={backgroundShellOutcome(session)}
              nowMs={nowMs}
              expanded={session.id === expandedId}
              compact={compact}
              home={home}
              actions={actions}
            />
          ))}
        </TraySheetBody>
      )}
    </div>
  )
}

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { elapsedSecondsSince, formatTrayAgo, formatTrayDuration, type TrayTranslate } from './tray-elapsed'
import { TrayButton, TrayIconButton, TrayRow, TrayStatusPill, TrayStopButton } from './tray-primitives'
import { copyBackgroundShellOutput, type BackgroundShellSendResult } from './shells-tray-actions'
import {
  backgroundShellDirectoryLabel,
  backgroundShellEndedBySignal,
  backgroundShellFailureLine,
  backgroundShellOutputLines,
  backgroundShellSettledAtMs,
  type BackgroundShellOutcome,
  type BackgroundShellSession
} from './shells-tray-data'
import './shells-tray.css'

/** Lines kept in the preview; about eight are visible, the rest scroll. */
const OUTPUT_PREVIEW_LINES = 200
/** Longer commands are repeated in full above the output (the row title truncates). */
const LONG_COMMAND_CHARS = 64

export type BackgroundShellRowActions = {
  onToggle: (sessionId: string) => void
  onStop: (sessionId: string) => Promise<void>
  onDismiss: (sessionId: string) => void
  /**
   * Attaches a failed command's output to the composer (copying it when the
   * composer refuses); null offers "copy output" instead.
   */
  onSendToKun: ((session: BackgroundShellSession) => Promise<BackgroundShellSendResult>) | null
}

/**
 * "已运行 3 分 12 秒 · ~/code/kun" / "退出码 1 · 2 分钟前 · <error>" /
 * "被信号终止 · 刚刚 · Segmentation fault" / "退出码 0 · 8 分钟前".
 */
export function backgroundShellRowSubtitle(
  session: BackgroundShellSession,
  outcome: BackgroundShellOutcome,
  nowMs: number,
  t: TrayTranslate,
  home: string | undefined
): string {
  if (outcome === 'running') {
    const elapsed = elapsedSecondsSince(session.startedAt, nowMs) ?? 0
    return [
      t('composerTrayShells.runningFor', { duration: formatTrayDuration(elapsed, t) }),
      backgroundShellDirectoryLabel(session.cwd, home)
    ].filter(Boolean).join(' · ')
  }
  const settledAt = backgroundShellSettledAtMs(session)
  const ago = settledAt === null ? null : formatTrayAgo((nowMs - settledAt) / 1000, t)
  const status = outcome === 'stopped'
    ? t('composerTrayShells.stopped')
    : session.exitCode !== null
      ? t('composerTrayShells.exitCode', { code: session.exitCode })
      : backgroundShellEndedBySignal(session)
        ? t('composerTrayShells.endedBySignal')
        : null
  const reason = outcome === 'failed' ? backgroundShellFailureLine(session) : null
  return [status, ago, reason].filter(Boolean).join(' · ')
}

function ShellStatusMark({ outcome }: { outcome: BackgroundShellOutcome }): ReactElement {
  if (outcome === 'succeeded' || outcome === 'stopped') {
    return <Check className="ds-shells-finished-icon h-3 w-3" strokeWidth={3} aria-hidden="true" />
  }
  return <span className="ds-shells-status-dot" data-outcome={outcome} aria-hidden="true" />
}

function ShellCopyButton({
  session,
  iconOnly = false
}: {
  session: BackgroundShellSession
  iconOnly?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  const label = copied ? t('composerTrayShells.copied') : t('composerTrayShells.copyOutput')
  const copy = (): void => {
    void copyBackgroundShellOutput(session).then(setCopied)
  }
  if (iconOnly) {
    const Icon = copied ? Check : Copy
    return (
      <TrayIconButton label={label} disabled={!session.output.trim()} onClick={copy}>
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      </TrayIconButton>
    )
  }
  return (
    <TrayButton disabled={!session.output.trim()} onClick={copy}>
      <span aria-live="polite">{label}</span>
    </TrayButton>
  )
}

function ShellStopControl({
  sessionId,
  onStop,
  iconOnly
}: {
  sessionId: string
  onStop: (sessionId: string) => Promise<void>
  iconOnly: boolean
}): ReactElement {
  const [stopping, setStopping] = useState(false)
  return (
    <TrayStopButton
      iconOnly={iconOnly}
      disabled={stopping}
      onClick={() => {
        setStopping(true)
        void onStop(sessionId).catch(() => undefined).finally(() => setStopping(false))
      }}
    />
  )
}

/** How long "已改为复制" / "无法附加" replaces the label after a refused attach. */
const SEND_FALLBACK_NOTICE_MS = 2500

function ShellSendButton({
  session,
  onSend
}: {
  session: BackgroundShellSession
  onSend: (session: BackgroundShellSession) => Promise<BackgroundShellSendResult>
}): ReactElement {
  const { t } = useTranslation('common')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<'copied' | 'unavailable' | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), SEND_FALLBACK_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])
  const label = notice === 'copied'
    ? t('composerTrayShells.sendCopiedInstead')
    : notice === 'unavailable'
      ? t('composerTrayShells.sendUnavailable')
      : t('composerTrayShells.sendToKun')
  return (
    <TrayButton
      disabled={sending}
      data-send-notice={notice ?? undefined}
      title={t(notice ? 'composerTrayShells.sendUnavailableTitle' : 'composerTrayShells.sendToKunTitle')}
      onClick={() => {
        setSending(true)
        setNotice(null)
        void onSend(session)
          .then((result) => setNotice(result === 'attached' ? null : result))
          .catch(() => setNotice('unavailable'))
          .finally(() => setSending(false))
      }}
    >
      <span aria-live="polite">{label}</span>
    </TrayButton>
  )
}

/**
 * Output tail of the expanded command: ANSI stripped, ~8 lines visible, kept
 * scrolled to the newest line unless the user scrolled up to read.
 */
export function BackgroundShellOutput({ session }: { session: BackgroundShellSession }): ReactElement {
  const { t } = useTranslation('common')
  const preRef = useRef<HTMLPreElement | null>(null)
  const pinnedRef = useRef(true)
  const text = useMemo(
    () => backgroundShellOutputLines(session.output, OUTPUT_PREVIEW_LINES).join('\n'),
    [session.output]
  )
  useLayoutEffect(() => {
    const pre = preRef.current
    if (pre && pinnedRef.current) pre.scrollTop = pre.scrollHeight
  }, [text])
  const fileLine = session.outputFilePath
    ? [
        t('composerTrayShells.outputFile', { path: session.outputFilePath }),
        session.outputTruncated ? t('composerTrayShells.outputTruncated') : null
      ].filter(Boolean).join(' · ')
    : session.outputTruncated
      ? t('composerTrayShells.outputTruncated')
      : null
  return (
    <>
      {session.command.length > LONG_COMMAND_CHARS ? (
        <p className="ds-shells-output-command ds-shells-mono">$ {session.command}</p>
      ) : null}
      <pre
        ref={preRef}
        tabIndex={0}
        aria-label={t('composerTrayShells.outputLabel', { command: session.command })}
        className="ds-shells-output ds-shells-mono"
        data-empty={text ? undefined : 'true'}
        data-background-shell-output
        onScroll={() => {
          const pre = preRef.current
          if (!pre) return
          pinnedRef.current = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8
        }}
      >
        {text || t('composerTrayShells.noOutput')}
      </pre>
      {fileLine ? (
        <span className="ds-shells-output-file ds-shells-mono" title={session.outputFilePath}>{fileLine}</span>
      ) : null}
    </>
  )
}

/**
 * The row's detail slot, rendered for every row (an empty hidden box while
 * collapsed). A detail that came and went would switch TrayRow between a bare
 * row and a row group, remounting the open button and dropping keyboard focus
 * to <body> on every expand / collapse.
 *
 * It also marks the row's open button as the disclosure control
 * (aria-expanded / aria-controls). TrayRow has no props for that yet; React
 * never manages these two attributes on that button, so setting them here
 * survives re-renders. Replace with TrayRow props once the foundation has them.
 */
function BackgroundShellDetail({
  session,
  expanded
}: {
  session: BackgroundShellSession
  expanded: boolean
}): ReactElement {
  const id = useId()
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const toggle = ref.current
      ?.closest('.ds-composer-tray-row-group')
      ?.querySelector('.ds-composer-tray-row-open')
    if (!toggle) return
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    toggle.setAttribute('aria-controls', id)
  }, [expanded, id])
  return (
    <div ref={ref} id={id} className="ds-shells-detail" hidden={!expanded} data-background-shell-detail>
      {expanded ? <BackgroundShellOutput session={session} /> : null}
    </div>
  )
}

/**
 * One command row of the sheet; the expanded row becomes a raised card with
 * its output. Compact (side conversation) rows use icon buttons and drop the
 * "失败" pill (the red dot and exit code already say it).
 */
export function BackgroundShellRow({
  session,
  outcome,
  nowMs,
  expanded,
  compact = false,
  home,
  actions
}: {
  session: BackgroundShellSession
  outcome: BackgroundShellOutcome
  nowMs: number
  expanded: boolean
  compact?: boolean
  home: string | undefined
  actions: BackgroundShellRowActions
}): ReactElement {
  const { t } = useTranslation('common')
  const dismiss = (
    <TrayIconButton label={t('composerTrayShells.dismiss')} onClick={() => actions.onDismiss(session.id)}>
      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
    </TrayIconButton>
  )
  let trailing: ReactNode
  if (outcome === 'running') {
    trailing = (
      <>
        <ShellCopyButton session={session} iconOnly={compact} />
        <ShellStopControl sessionId={session.id} onStop={actions.onStop} iconOnly={compact} />
      </>
    )
  } else if (outcome === 'failed') {
    trailing = (
      <>
        {compact ? null : <TrayStatusPill tone="error">{t('composerTrayShells.failed')}</TrayStatusPill>}
        {actions.onSendToKun
          ? <ShellSendButton session={session} onSend={actions.onSendToKun} />
          : <ShellCopyButton session={session} iconOnly={compact} />}
        {dismiss}
      </>
    )
  } else {
    trailing = dismiss
  }
  return (
    <TrayRow
      role="listitem"
      className="ds-shells-row"
      data-outcome={outcome}
      data-background-shell-row={session.id}
      leading={<span className="ds-shells-row-leading"><ShellStatusMark outcome={outcome} /></span>}
      title={<span className="ds-shells-mono">{session.command}</span>}
      subtitle={backgroundShellRowSubtitle(session, outcome, nowMs, t, home)}
      trailing={trailing}
      highlighted={expanded}
      onOpen={() => actions.onToggle(session.id)}
      openLabel={t(expanded ? 'composerTrayShells.hideOutput' : 'composerTrayShells.showOutput', {
        command: session.command
      })}
      detail={<BackgroundShellDetail session={session} expanded={expanded} />}
    />
  )
}

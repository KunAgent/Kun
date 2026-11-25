import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, HardDrive, Loader2, X } from 'lucide-react'
import { useColabDriveStore } from './colab-drive-store'

const iconButton =
  'flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40'

export function ColabDriveAuthCard({
  sessionId,
  accountLabel,
  authUrl,
  compact = false
}: {
  sessionId: string
  accountLabel?: string
  authUrl: string
  compact?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const completeAuth = useColabDriveStore((s) => s.completeAuth)
  const openAuth = useColabDriveStore((s) => s.openAuth)
  const cancelMount = useColabDriveStore((s) => s.cancelMount)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const handleConfirm = async (): Promise<void> => {
    setSubmitting(true)
    setFeedback(null)
    try {
      const res = await completeAuth(sessionId)
      if (!res.ok) {
        setFeedback(
          res.code === 'auth_incomplete' ? t('colabNb.driveMountAuthIncomplete') : res.message
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(authUrl)
      setFeedback(t('colabNb.pullAuthNotice.copied'))
    } catch {
      setFeedback(t('colabNb.pullAuthNotice.copyError'))
    }
  }

  return (
    <div
      role="status"
      data-colab-drive-auth-card
      onMouseDown={(e) => e.stopPropagation()}
      className={`rounded-[10px] border border-accent-tint/35 bg-accent-tint/[0.06] ${
        compact ? 'px-3 py-2.5' : 'mx-3 mt-2.5 p-3'
      } space-y-2 text-[12px]`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-semibold text-ds-ink">
          <HardDrive className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">{t('colabNb.driveMountAuthTitle')}</span>
        </div>
        <button
          type="button"
          onClick={() => void cancelMount(sessionId)}
          title={t('colabNb.driveMountCancel')}
          aria-label={t('colabNb.driveMountCancel')}
          className={iconButton}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ds-muted">
        {t('colabNb.driveMountAuthDesc', { account: accountLabel || 'Google' })}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-colab-drive-auth-confirm
          disabled={submitting}
          onClick={() => void handleConfirm()}
          className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-accent px-2.5 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          <span>{t('colabNb.driveMountAuthConfirm')}</span>
        </button>
        <button
          type="button"
          onClick={async () => {
            const ok = await openAuth(sessionId)
            if (!ok) setFeedback(t('colabNb.pullAuthNotice.openError'))
          }}
          className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-ds-border bg-ds-card px-2 text-[11.5px] text-ds-ink hover:bg-ds-hover"
        >
          <ExternalLink className="h-3 w-3 text-ds-muted" />
          <span>{t('colabNb.driveAuthOpenBrowser')}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-ds-border bg-ds-card px-2 text-[11.5px] text-ds-ink hover:bg-ds-hover"
        >
          <Copy className="h-3 w-3 text-ds-muted" />
          <span>{t('colabNb.driveAuthCopyLink')}</span>
        </button>
      </div>
      {feedback ? <p className="text-[11px] text-amber-700 dark:text-amber-300">{feedback}</p> : null}
    </div>
  )
}

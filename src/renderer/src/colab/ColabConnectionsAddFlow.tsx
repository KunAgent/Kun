import { useEffect, useState, type ReactElement } from 'react'
import { AlertTriangle, Check, Copy, ExternalLink, KeyRound, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ColabLoginOutcome, ColabOAuthPendingState } from '@shared/colab/colab-types'
import { formatColabDuration, useColabStore } from './colab-store'

type Props = {
  workspaceRoot: string
  oauthPending: ColabOAuthPendingState | null
  lastOutcome: ColabLoginOutcome | null
  reauthConnectionId: string | null
  reauthName?: string
  onCancelForm: () => void
}

export function ColabConnectionsAddFlow({
  workspaceRoot,
  oauthPending,
  lastOutcome,
  reauthConnectionId,
  reauthName,
  onCancelForm
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const showToast = useColabStore((s) => s.showToast)
  // Blank is intentional: the main process names the connection after the email prefix.
  const [name, setName] = useState('')
  const [setAsCurrent, setSetAsCurrent] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(300)

  useEffect(() => {
    if (!oauthPending) return
    const updateRemaining = (): void => {
      const diff = Math.max(0, Math.ceil((oauthPending.expiresAt - Date.now()) / 1000))
      setRemainingSeconds(diff)
    }
    updateRemaining()
    const timer = setInterval(updateRemaining, 1000)
    return () => clearInterval(timer)
  }, [oauthPending])

  const failure = lastOutcome && !lastOutcome.ok ? lastOutcome : null

  const clearOutcome = (): void => {
    if (failure) void window.kunGui.colabClearLastLoginOutcome()
  }

  const cancelForm = (): void => {
    clearOutcome()
    onCancelForm()
  }

  if (failure?.kind === 'email_mismatch') {
    return (
      <div className="mt-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[12px]">
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {t('colab.mismatchTitle', {
                actual: failure.actualEmail ?? '',
                expected: failure.expectedEmail ?? ''
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {failure.pendingTokenId ? (
                <button
                  type="button"
                  onClick={async () => {
                    const res = await window.kunGui.colabPromoteMismatchedToken({
                      pendingTokenId: failure.pendingTokenId!,
                      workspaceRoot,
                      setAsCurrent: true
                    })
                    if (res.ok) {
                      showToast(t('colab.createdToast', { email: res.connection.email }))
                      onCancelForm()
                    }
                  }}
                  className="rounded-lg bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:opacity-90"
                >
                  {t('colab.promoteAsNew')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={cancelForm}
                className="rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('colab.cancelBtn')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (oauthPending) {
    return (
      <div
        data-testid="colab-oauth-waiting"
        className="mt-2 rounded-xl border border-accent/30 bg-ds-card p-3 text-[12px]"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-medium text-ds-ink">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            <span className="truncate">{t('colab.waitingAuthTitle')}</span>
          </div>
          <span className="shrink-0 font-mono text-[11px] text-ds-faint">
            {t('colab.waitingCountdown', { time: formatColabDuration(remainingSeconds) })}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(oauthPending.authUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-subtle px-2 py-1 text-[11.5px] text-ds-ink hover:bg-ds-hover"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? t('colab.copiedAuthUrl') : t('colab.copyAuthUrl')}</span>
          </button>
          <button
            type="button"
            onClick={() => void window.kunGui.colabReopenOAuthUrl({ flowId: oauthPending.flowId })}
            className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-subtle px-2 py-1 text-[11.5px] text-ds-ink hover:bg-ds-hover"
          >
            <ExternalLink className="h-3 w-3" />
            <span>{t('colab.reopenBrowser')}</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await window.kunGui.colabCancelOAuthLogin({ flowId: oauthPending.flowId })
              // A user-initiated cancel needs no failure banner.
              void window.kunGui.colabClearLastLoginOutcome()
              onCancelForm()
            }}
            className="ml-auto rounded-lg px-2 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('colab.cancelBtn')}
          </button>
        </div>

        <div className="mt-2 border-t border-ds-border-muted pt-2">
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-ds-faint hover:text-ds-ink"
          >
            <KeyRound className="h-3 w-3" />
            <span>{t('colab.pasteManualCode')}</span>
          </button>
          {manualOpen ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder={t('colab.manualCodePlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-ds-border bg-ds-subtle px-2 py-1 font-mono text-[11.5px] text-ds-ink focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={!manualCode.trim() || submitting}
                onClick={async () => {
                  setSubmitting(true)
                  setErrorText(null)
                  try {
                    const res = await window.kunGui.colabSubmitOAuthManualCode({
                      flowId: oauthPending.flowId,
                      code: manualCode.trim()
                    })
                    if (!res.ok) setErrorText(res.message)
                  } catch (error) {
                    setErrorText(error instanceof Error ? error.message : String(error))
                  } finally {
                    setSubmitting(false)
                  }
                }}
                className="rounded-lg bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-50"
              >
                {t('colab.submitCode')}
              </button>
            </div>
          ) : null}
          {errorText ? <p className="mt-1 text-[11px] text-red-500">{errorText}</p> : null}
        </div>
      </div>
    )
  }

  const startLogin = async (): Promise<void> => {
    clearOutcome()
    setSubmitting(true)
    setErrorText(null)
    try {
      const res = await window.kunGui.colabStartOAuthLogin({
        ...(name.trim() ? { name: name.trim() } : {}),
        setAsCurrent,
        workspaceRoot,
        ...(reauthConnectionId ? { reauthConnectionId } : {})
      })
      if (!res.ok) setErrorText(res.message)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const failureText = failure
    ? failure.kind === 'cancelled'
      ? t('colab.loginCancelled')
      : failure.kind === 'timeout'
        ? t('colab.loginTimedOut')
        : t('colab.loginFailed', { message: failure.message })
    : null

  return (
    <div
      data-testid="colab-add-account-form"
      className="mt-2 rounded-xl border border-ds-border bg-ds-card p-3 text-[12px]"
    >
      {failureText ? (
        <div
          role="alert"
          className="mb-2.5 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-600 dark:text-red-300"
        >
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{failureText}</span>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void startLogin()}
            className="shrink-0 font-semibold hover:underline disabled:opacity-50"
          >
            {t('colab.retryBtn')}
          </button>
        </div>
      ) : null}

      {reauthConnectionId ? (
        <div className="font-medium text-ds-ink">
          {t('colab.errAuthExpiredTitle', { name: reauthName ?? '' })}
        </div>
      ) : (
        <div>
          <label className="block text-[11px] font-medium text-ds-muted" htmlFor="colab-connection-name">
            {t('colab.connectionNameLabel')}
          </label>
          <input
            id="colab-connection-name"
            type="text"
            value={name}
            autoFocus
            maxLength={48}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting) void startLogin()
              else if (e.key === 'Escape') cancelForm()
            }}
            placeholder={t('colab.connectionNamePlaceholder')}
            className="mt-1 w-full rounded-lg border border-ds-border bg-ds-subtle px-2.5 py-1.5 text-[12px] text-ds-ink focus:border-accent focus:outline-none"
          />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11.5px] text-ds-ink">
            <input
              type="checkbox"
              checked={setAsCurrent}
              onChange={(e) => setSetAsCurrent(e.target.checked)}
              className="rounded border-ds-border text-accent"
            />
            <span>{t('colab.setAsCurrentAfterLogin')}</span>
          </label>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-ds-faint">{t('colab.oauthBrowserHint')}</p>
      {errorText ? <p className="mt-1.5 text-[11px] text-red-500">{errorText}</p> : null}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={cancelForm}
          className="rounded-lg px-2.5 py-1.5 text-[11.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          {t('colab.cancelBtn')}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void startLogin()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-sm hover:opacity-95 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <span>{t('colab.signInWithGoogleExt')}</span>
        </button>
      </div>
    </div>
  )
}

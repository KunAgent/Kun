import { CalendarDays, ExternalLink, Files, LoaderCircle, Mail, Plug, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GOOGLE_WORKSPACE_DOCUMENTATION_URL } from '@shared/google-workspace'
import { useGoogleWorkspace } from './use-google-workspace'

export function IntegrationsSettingsSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const api = window.kunGui?.googleWorkspace
  const { status, loading, error, cancelling, refresh, run, cancel, busy } = useGoogleWorkspace(api)
  const connected = status?.auth.state === 'connected'
  const setupRequired = status?.setup?.required || status?.auth.state === 'setup_required'
  const actionClass = 'rounded-xl border border-ds-border px-3 py-2 text-xs font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-40'
  const disconnect = (): void => {
    if (!window.confirm(t('googleWorkspaceDisconnectConfirm'))) return
    void run('logout')
  }

  return (
    <section aria-labelledby="google-workspace-title" className="rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600"><Plug className="h-5 w-5" /></div>
          <div>
            <h2 id="google-workspace-title" className="text-[15px] font-semibold text-ds-ink">Google Workspace</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-ds-muted">{t('googleWorkspaceDescription')}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-700 dark:text-amber-300">{t('googleWorkspaceExperimental')}</span>
      </div>

      {!api ? <p role="alert" className="mt-4 text-xs text-ds-muted">{t('googleWorkspaceDesktopOnly')}</p> : <>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ds-subtle p-3 text-xs">
          <span className="font-medium text-ds-ink" role="status">
            {loading && !status ? t('googleWorkspaceLoading') : status ? t(`googleWorkspaceAuth_${status.auth.state}`) : t('googleWorkspaceUnavailable')}
          </span>
          {status ? <span className="text-ds-muted">{status.binary.available ? `gws ${status.binary.version || ''}` : t('googleWorkspaceBinaryMissing')}</span> : null}
        </div>
        {status?.binary.error ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{status.binary.error}</p> : null}
        <p className="mt-3 text-xs leading-5 text-ds-muted">{t('googleWorkspacePermissions')}</p>
        <p className="mt-1 text-xs leading-5 text-ds-faint">{t('googleWorkspaceCredentialOwnership')}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {([{ key: 'gmail', name: 'Gmail', Icon: Mail }, { key: 'calendar', name: 'Calendar', Icon: CalendarDays }, { key: 'drive', name: 'Drive', Icon: Files }] as const).map(({ key, name, Icon }) => (
            <div key={key} className="min-w-0 rounded-xl border border-ds-border p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-ds-ink"><Icon className="h-4 w-4" />{name}</div>
              <p className="mt-2 text-xs text-ds-muted">{t(`googleWorkspaceService_${status?.services[key].state || 'unknown'}`)}</p>
              {status?.services[key].message ? <p className="mt-1 break-words text-xs text-ds-muted">{status.services[key].message}</p> : null}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ds-faint">{t('googleWorkspaceTestDescription')}</p>

        {status?.auth.scopes.length ? <details className="mt-4 text-xs text-ds-muted">
          <summary className="cursor-pointer">{t('googleWorkspaceScopes')}</summary>
          <ul className="mt-2 space-y-1">{status.auth.scopes.map((scope) => <li className="break-all" key={scope}>{scope}</li>)}</ul>
        </details> : null}

        {setupRequired || status?.operation?.kind === 'setup' ? <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <h3 className="text-xs font-semibold text-ds-ink">{t('googleWorkspaceSetupTitle')}</h3>
          <p className="mt-2 text-xs leading-5 text-ds-muted">{t('googleWorkspaceSetupDescription')}</p>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-5 text-ds-muted">
            {(status?.setup?.instructions.length ? status.setup.instructions : [t('googleWorkspaceSetupStep1'), t('googleWorkspaceSetupStep2'), t('googleWorkspaceSetupStep3')]).map((step, index) => <li key={index}>{step}</li>)}
          </ol>
          <p className="mt-3 text-xs text-ds-muted">{t('googleWorkspaceSetupTerminal')}</p>
        </div> : null}

        {status?.operation ? <div aria-live="polite" className="mt-4 flex gap-2 rounded-xl bg-ds-subtle p-3 text-xs text-ds-muted">
          {busy ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" /> : null}
          <div><p>{t(`googleWorkspaceOperation_${status.operation.kind}`)}: {t(`googleWorkspaceOperationState_${status.operation.state}`)}</p>{status.operation.message ? <p className="mt-1">{status.operation.message}</p> : null}</div>
        </div> : null}
        {busy ? <p className="mt-2 text-xs text-ds-muted">{t('googleWorkspaceCloseCancels')}</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{t(error)}</p> : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className={actionClass} disabled={busy || loading || !status?.binary.available || Boolean(setupRequired)} onClick={() => void run('login')}>{t(connected ? 'googleWorkspaceReconnect' : 'googleWorkspaceConnect')}</button>
          <button type="button" className={actionClass} disabled={busy || loading || !status?.binary.available} onClick={() => void run('setup')}>{t('googleWorkspaceSetup')}</button>
          <button type="button" className={actionClass} disabled={busy || loading || !status?.binary.available || Boolean(setupRequired) || status?.auth.state === 'disconnected'} onClick={() => void run('test')}>{t('googleWorkspaceTest')}</button>
          <button type="button" className={actionClass} disabled={busy || loading || !status?.binary.available || status?.auth.state === 'disconnected' || Boolean(setupRequired)} onClick={disconnect}>{t('googleWorkspaceDisconnect')}</button>
          <button type="button" className={actionClass} disabled={busy || loading} onClick={() => void refresh()}><RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />{t('googleWorkspaceRefresh')}</button>
          {busy ? <button type="button" className={actionClass} disabled={cancelling} onClick={() => void cancel()}>{t(cancelling ? 'googleWorkspaceCancelling' : 'googleWorkspaceCancel')}</button> : null}
        </div>
      </>}
      <button type="button" className="mt-4 inline-flex items-center gap-1.5 text-xs text-accent hover:underline" onClick={() => void window.kunGui.openExternal(GOOGLE_WORKSPACE_DOCUMENTATION_URL).catch(() => undefined)}><ExternalLink className="h-3.5 w-3.5" />{t('googleWorkspaceDocumentation')}</button>
    </section>
  )
}

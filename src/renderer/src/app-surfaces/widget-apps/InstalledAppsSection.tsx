import { useState } from 'react'
import { AppWindow, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WidgetApp } from '../../../../../kun/src/contracts/widget-app'
import { extensionWorkbenchClient, ExtensionWorkbenchClientError } from '../../extensions/extension-workbench-client'
import { refreshWidgetApps, useInstalledWidgetApps, widgetAppsApi } from './installed-apps'

export function InstalledAppsSection() {
  const { t } = useTranslation('common')
  const apps = useInstalledWidgetApps()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  if (!apps.length) return null
  async function act(app: WidgetApp, remove = false) {
    const api = widgetAppsApi()
    if (!api) return
    setBusy(app.id)
    setError('')
    try {
      if (remove) { await extensionWorkbenchClient.uninstall(app.id); await refreshWidgetApps() }
      else await api.open(app.id)
    } catch (cause) {
      if (!(cause instanceof ExtensionWorkbenchClientError && cause.code === 'EXTENSION_CONSENT_DENIED')) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    finally { setBusy('') }
  }
  return <section className="flex flex-col gap-2" aria-label={t('widgetAppsTitle')}>
    <h3 className="text-[13px] font-semibold text-ds-muted">{t('widgetAppsTitle')}</h3>
    <div className="flex flex-wrap gap-2">
      {apps.map(app => <div key={app.id} className="inline-flex items-center gap-1 rounded-xl border border-ds-border bg-ds-card px-2">
        <button type="button" className="flex items-center gap-2 px-2 py-2 text-sm text-ds-ink" disabled={busy === app.id || !app.enabled}
          onClick={() => void act(app)}><AppWindow className="h-4 w-4" aria-hidden/>{app.title}</button>
        <button type="button" aria-label={t('widgetAppRemoveConfirm', { title: app.title })} disabled={busy === app.id}
          className="rounded p-1 text-ds-muted hover:bg-ds-hover" onClick={() => void act(app, true)}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden/></button>
      </div>)}
    </div>
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </section>
}

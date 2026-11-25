import { useState } from 'react'
import { AppWindow, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { widgetAppKey, type WidgetAppSource } from '../../../../../kun/src/contracts/widget-app'
import { refreshWidgetApps, useInstalledWidgetApps, widgetAppsApi } from './installed-apps'

export function InstallWidgetButton({ source }: { source: WidgetAppSource }) {
  const { t } = useTranslation('common')
  const apps = useInstalledWidgetApps()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const api = widgetAppsApi()
  if (!api) return null
  const installed = apps.find(app => app.threadId === source.threadId && widgetAppKey(app) === widgetAppKey(source))
  const action = async () => {
    setBusy(true)
    setError('')
    try {
      if (installed) await api.open(installed.id)
      else await api.install(source)
      await refreshWidgetApps()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const Icon = installed ? AppWindow : Download
  return <>
    {error && <span role="alert" className="max-w-48 truncate text-red-600" title={error}>{error}</span>}
    <button type="button" data-widget-app-action={installed ? 'open' : 'install'} disabled={busy}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
      onClick={() => void action()}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{t(installed ? 'widgetAppOpen' : 'widgetAppInstall')}
    </button>
  </>
}

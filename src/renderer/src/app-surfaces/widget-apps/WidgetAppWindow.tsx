import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WidgetApp } from '../../../../../kun/src/contracts/widget-app'
import { GenUiSurface } from '../gen-ui/GenUiSurface'

export function WidgetAppWindow({ id }: { id: string }) {
  const { t } = useTranslation('common')
  const [app, setApp] = useState<WidgetApp | null>(null)
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  useEffect(() => {
    let cancelled = false
    let loading = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      if (loading || cancelled) return
      loading = true
      clearTimeout(timer)
      let interval = 5000
      try {
        const next = await window.kunGui.widgetApps.info(id)
        if (cancelled) return
        if (!next?.enabled) { setApp(null); setError(t('widgetAppUnavailable')); return }
        document.title = next.title
        setApp(old => old?.version === next.version ? old : next)
        setError('')
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
        interval = 1500
      } finally {
        loading = false
        if (!cancelled && !document.hidden) timer = setTimeout(() => void refresh(), interval)
      }
    }
    const visible = () => { if (!document.hidden) void refresh() }
    void refresh()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [id, attempt, t])
  return <main className="flex h-screen flex-col bg-ds-main text-ds-ink" data-installed-widget-app={id}>
    {app ? <GenUiSurface key={app.version} appId={id} threadId={app.threadId} widgetId={app.widgetId} title={app.title} fill />
      : <div className="m-auto flex flex-col items-center gap-3 p-6 text-sm text-ds-muted">
        <p role="status">{error || t('widgetAppOpening')}</p>
        {error && <button type="button" onClick={() => retry(n => n + 1)}>{t('appSurfaceRetry')}</button>}
      </div>}
  </main>
}

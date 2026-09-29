import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, PlugZap, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GOOGLE_WORKSPACE_MCP_SERVERS } from '../plugin-marketplace-config'
import { addRoomApp, authorizeRoomApp, listRoomApps, type RoomAppInventory } from './room-apps-client'

const recommended = [
  { id: 'google_gmail', name: 'Gmail', url: GOOGLE_WORKSPACE_MCP_SERVERS.google_gmail },
  { id: 'google_drive', name: 'Google Drive', url: GOOGLE_WORKSPACE_MCP_SERVERS.google_drive },
  { id: 'google_calendar', name: 'Google Calendar', url: GOOGLE_WORKSPACE_MCP_SERVERS.google_calendar }
] as const

const googleGuide = 'https://developers.google.com/workspace/guides/configure-mcp-servers'

export function RoomAppsPanel({ onClose, onOpenPlugins }: { onClose: () => void; onOpenPlugins: () => void }) {
  const { t } = useTranslation('common')
  const panel = useRef<HTMLElement>(null)
  const [inventory, setInventory] = useState<RoomAppInventory | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [id, setId] = useState('')
  const [url, setUrl] = useState('')

  const refresh = async () => {
    setError('')
    try { setInventory(await listRoomApps()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const act = async (key: string, action: () => Promise<void>) => {
    if (busy) return
    setBusy(key); setError('')
    try { await action(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }
  const installed = new Set(inventory?.servers.map((server) => server.id))
  return <div className="absolute inset-0 z-[60] flex justify-end bg-black/25" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <aside ref={panel} role="dialog" aria-modal="true" aria-label={t('roomsAppsTitle')}
      className="flex h-full w-[min(440px,100%)] flex-col border-l border-ds-border bg-ds-main shadow-xl"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
        if (event.key !== 'Tab') return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]'))
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <header className="flex items-center gap-3 border-b border-ds-border p-4">
        <PlugZap size={19} className="text-ds-muted" />
        <h2 className="min-w-0 flex-1 text-base font-semibold text-ds-ink">{t('roomsAppsTitle')}</h2>
        <button className="rooms-icon-button" aria-label={t('roomsRefresh')} disabled={!!busy} onClick={() => void refresh()}><RefreshCw size={17} /></button>
        <button className="rooms-icon-button" aria-label={t('roomsClose')} onClick={onClose}><X size={19} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <p className="text-ds-muted">{t('roomsAppsIntro')}</p>
        <section className="space-y-2">
          <h3 className="font-semibold text-ds-ink">{t('roomsAppsConfigured')}</h3>
          {!inventory && !error ? <p className="text-ds-muted">{t('roomsLoading')}</p> : null}
          {inventory && !inventory.servers.length ? <p className="text-ds-muted">{t('roomsAppsEmpty')}</p> : null}
          {inventory?.servers.map((server) => {
            const status = inventory.statuses[server.id] ?? (server.enabled ? 'not_connected' : 'disabled')
            const authorized = inventory.oauth[server.id] === 'authorized'
            const connected = status === 'connected'
            return <article key={server.id} className="space-y-2 rounded-xl border border-ds-border p-3">
              <div className="flex items-center gap-2">
                <strong className="min-w-0 flex-1 truncate text-ds-ink">{recommended.find((item) => item.id === server.id)?.name ?? server.id}</strong>
                <span className={`text-xs ${connected ? 'text-green-600' : 'text-ds-muted'}`}>{connected ? <><Check size={12} className="inline" /> {t('pluginMcpRuntimeConnected')}</> : status === 'authorization_required' ? t('roomsAppsAuthRequired') : status === 'disabled' ? t('pluginMcpRuntimeDisabled') : status === 'reconnecting' ? t('roomsLoading') : status === 'not_connected' ? t('roomsAppsNotConnected') : t('pluginMcpRuntimeError')}</span>
              </div>
              <p className="break-all text-xs text-ds-muted">{server.target}</p>
              <div className="flex gap-2">
                {server.enabled && server.oauth && !connected ? <button className="rounded-lg bg-ds-hover px-3 py-1.5 text-xs text-ds-ink" disabled={!!busy}
                  onClick={() => void act(server.id, () => authorizeRoomApp(server.id))}>{busy === server.id ? t('roomsLoading') : t(authorized ? 'roomsAppsReconnect' : 'roomsAppsAuthorize')}</button> : null}
              </div>
            </article>
          })}
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold text-ds-ink">{t('roomsAppsRecommended')}</h3>
          <p className="text-xs text-ds-muted">{t('roomsAppsGooglePrerequisite')}</p>
          {recommended.filter((item) => !installed.has(item.id)).map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl border border-ds-border p-3">
            <span>{item.name}</span>
            <button className="rounded-lg bg-ds-hover px-3 py-1.5 text-xs text-ds-ink" disabled={!!busy || !inventory}
              onClick={() => void act(item.id, () => addRoomApp(item.id, item.url))}>{t('pluginOAuthInstall')}</button>
          </div>)}
          <button className="inline-flex items-center gap-1 text-xs text-ds-muted underline" onClick={() => void window.kunGui.openExternal(googleGuide)}>{t('roomsAppsGoogleGuide')} <ExternalLink size={12} /></button>
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold text-ds-ink">{t('roomsAppsCustom')}</h3>
          <input className="w-full rounded-lg border border-ds-border bg-ds-main p-2 text-ds-ink" aria-label={t('roomsAppsId')} placeholder={t('roomsAppsId')} value={id} onChange={(event) => setId(event.target.value)} />
          <input className="w-full rounded-lg border border-ds-border bg-ds-main p-2 text-ds-ink" aria-label={t('roomsAppsUrl')} placeholder="https://example.com/mcp" value={url} onChange={(event) => setUrl(event.target.value)} />
          <button className="rounded-lg bg-ds-hover px-3 py-2 text-xs text-ds-ink" disabled={!!busy || !inventory || !id.trim() || !url.trim()}
            onClick={() => {
              if (installed.has(id.trim())) { setError(t('roomsAppsIdExists')); return }
              void act(id, async () => { await addRoomApp(id.trim(), url.trim()); setId(''); setUrl('') })
            }}>{t('pluginOAuthInstall')}</button>
        </section>
        <button className="text-xs text-ds-muted underline" onClick={onOpenPlugins}>{t('roomsAppsOpenPlugins')}</button>
        {error ? <p role="alert" className="break-words text-xs text-red-500">{error}</p> : null}
      </div>
    </aside>
  </div>
}

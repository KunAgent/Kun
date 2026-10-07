import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { Copy, Radar } from 'lucide-react'
import type { ModelProviderSettingsV1 } from '@shared/app-settings'
import { settingsButtonClass } from './settings-button'
import { Toggle } from './settings-controls'

type DiscoveryStatus = { allowed: boolean; advertised: boolean; path?: string; owner?: 'self' | 'other' | 'none'; other?: { baseUrl?: string; pid?: number } }

function shortPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~')
}

/** The discovery file other agents read to find the gateway, with its on/off setting. */
export function GatewayDiscoveryRow({ settings, onChange, active, t }: {
  settings: ModelProviderSettingsV1
  onChange: (next: ModelProviderSettingsV1) => void
  active: boolean
  t: TFunction
}): ReactElement {
  const wanted = settings.localGateway.advertiseDiscovery !== false
  const [status, setStatus] = useState<DiscoveryStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const result = await window.kunGui.runtimeRequest('/v1/model-gateway/discovery', 'GET')
      if (result.ok) setStatus(JSON.parse(result.body) as DiscoveryStatus)
    } catch { /* informational */ }
  }, [])
  useEffect(() => { if (active) void refresh() }, [active, refresh])
  // The runtime follows the setting within a few seconds; read the result back once it has.
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => void refresh(), 6_000)
    return () => clearTimeout(timer)
  }, [active, wanted, refresh])
  const toggle = (on: boolean): void => {
    const { advertiseDiscovery: _omit, ...rest } = settings.localGateway
    onChange({ ...settings, localGateway: on ? rest : { ...rest, advertiseDiscovery: false } })
  }
  const path = status?.path
  const copy = async (): Promise<void> => {
    if (!path) return
    try { await navigator.clipboard.writeText(path); setCopied(true); setTimeout(() => setCopied(false), 1_500) } catch { /* clipboard unavailable */ }
  }
  return <section className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-ds-border bg-ds-card px-4 py-3" data-gateway-discovery>
    <Radar className="h-4 w-4 shrink-0 text-accent" />
    <div className="min-w-0 flex-1">
      <div className="text-[12.5px] font-semibold text-ds-ink">{t('gatewayDiscovery.title')}</div>
      <p className="text-[11.5px] leading-5 text-ds-muted">
        {!wanted ? t('gatewayDiscovery.off')
          : status?.owner === 'other' ? t('gatewayDiscovery.other', { address: status.other?.baseUrl ?? '?' })
            : t('gatewayDiscovery.on', { path: path ? shortPath(path) : '~/.kun/gateway.json' })}
      </p>
    </div>
    {path && wanted ? <button type="button" className={settingsButtonClass({ size: 'compact' })} onClick={() => void copy()}>
      <Copy className="h-3.5 w-3.5" />{copied ? t('gatewayDiscovery.copied') : t('gatewayDiscovery.copyPath')}</button> : null}
    <Toggle checked={wanted} onChange={toggle} ariaLabel={t('gatewayDiscovery.toggle')} />
  </section>
}

import { GatewayClientUsage } from './gateway-client-usage'
import { GatewayClientPolicyEditor } from './gateway-client-policy-editor'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { GatewayClientCredential, GatewayClientUsage as Usage } from '@shared/gateway-clients'
import { settingsButtonClass } from './settings-button'

/** Keys are copied by Electron Main once; this component only receives redacted metadata. */
export function GatewayClientCredentials({ clientName, active, modelId }: { clientName: string; active: boolean; modelId?: string }): ReactElement {
  const { t } = useTranslation('settings')
  const [name, setName] = useState(clientName)
  const [clients, setClients] = useState<GatewayClientCredential[]>([])
  const [pending, setPending] = useState(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const available = typeof window !== 'undefined' && typeof window.kunGui?.gatewayClients === 'function'
  const refresh = useCallback(async (): Promise<void> => {
    if (!available) return
    try {
      const result = await window.kunGui.gatewayClients({ action: 'list' })
      if (!result.ok) throw new Error(result.error ?? `HTTP ${result.status}`)
      setClients(result.clients ?? [])
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [available])
  useEffect(() => { setName(clientName); setCopied(false) }, [clientName])
  useEffect(() => { if (active) void refresh() }, [active, refresh])
  const create = async (): Promise<void> => {
    if (!available || pending || !name.trim() || !modelId) return
    setPending(true); setError(''); setCopied(false)
    try {
      const result = await window.kunGui.gatewayClients({ action: 'create', name: name.trim(), modelId })
      if (!result.ok) throw new Error(result.error ?? `HTTP ${result.status}`)
      setCopied(result.copied === true)
      if (result.error) setError(result.error)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  const revoke = async (client: GatewayClientCredential, cancelActive = false): Promise<void> => {
    if (!available || pending || !globalThis.confirm(t('gatewayConnection.confirmRevoke', { name: client.name }))) return
    setPending(true); setError(''); setCopied(false)
    try {
      const result = await window.kunGui.gatewayClients({ action: 'revoke', clientId: client.clientId, ...(cancelActive ? { cancelActive } : {}) })
      if (!result.ok || result.revoked !== true) throw new Error(result.error ?? t('gatewayConnection.revokeFailed'))
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  const rotate = async (client: GatewayClientCredential): Promise<void> => {
    if (!available || pending) return
    setPending(true); setError(''); setCopied(false)
    try {
      const result = await window.kunGui.gatewayClients({ action: 'rotate', clientId: client.clientId })
      if (!result.ok) throw new Error(result.error ?? `HTTP ${result.status}`)
      setCopied(result.copied === true)
      if (result.error) setError(result.error)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  const readUsage = async (clientId: string): Promise<void> => {
    if (!available || pending) return
    setPending(true); setError('')
    try {
      const result = await window.kunGui.gatewayClients({ action: 'usage', clientId })
      if (!result.ok || !result.usage) throw new Error(result.error ?? `HTTP ${result.status}`)
      setUsage(result.usage)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  return <section className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-ds-border p-3" data-gateway-client-credentials>
    <h4 className="text-[12px] font-semibold text-ds-ink">{t('gatewayConnection.clientKeys')}</h4>
    <p className="text-[11px] leading-5 text-ds-muted">{t('gatewayConnection.clientKeysHint')}</p>
    <p className="break-words text-[11px] text-ds-muted">{t('providerConfiguration.keyModel', { model: modelId ?? '—' })}</p>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input aria-label={t('gatewayConnection.clientName')} value={name} maxLength={80} onChange={(event) => setName(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12px] text-ds-ink" />
      <button type="button" className={settingsButtonClass()} disabled={!available || pending || !name.trim() || !modelId} onClick={() => void create()}>
        {t('gatewayConnection.createCopy')}
      </button>
    </div>
    {!available ? <p className="text-[11px] text-ds-muted">{t('gatewayConnection.desktopKeys')}</p> : null}
    {copied ? <p role="status" className="text-[11px] text-emerald-700">{t('gatewayConnection.keyCopied')}</p> : null}
    {error ? <p role="alert" className="text-[11px] text-red-600">{error}</p> : null}
    {clients.map((client) => <div key={client.clientId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-ds-border-muted pt-2 text-[11px] text-ds-muted">
      <span className="min-w-0 max-w-full break-all">{client.name}{client.revokedAt ? ` (${t('gatewayConnection.revoked')})` : ''} <span className="font-mono text-ds-faint">{client.clientId}</span></span>
      <button type="button" className={settingsButtonClass()} disabled={pending} onClick={() => void readUsage(client.clientId)}>{t('gatewayConnection.readUsage')}</button>
      <button type="button" className={settingsButtonClass()} disabled={pending || Boolean(client.revokedAt)} onClick={() => void rotate(client)}>{t('providerConfiguration.rotateKey')}</button>
      <button type="button" className={settingsButtonClass({ variant: 'danger' })} disabled={pending || Boolean(client.revokedAt)} onClick={() => void revoke(client)}>{t('gatewayConnection.revoke')}</button>
      <button type="button" className={settingsButtonClass({ variant: 'danger-ghost' })} disabled={pending || Boolean(client.revokedAt)} onClick={() => void revoke(client, true)}>{t('providerConfiguration.revokeAndCancel')}</button>
      {!client.revokedAt ? <GatewayClientPolicyEditor client={client} /> : null}
    </div>)}
    {usage ? <GatewayClientUsage usage={usage} clientName={clients.find((client) => client.clientId === usage.clientId)?.name ?? usage.clientId} /> : null}
  </section>
}

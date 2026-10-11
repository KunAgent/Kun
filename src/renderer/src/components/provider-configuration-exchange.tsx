import { useState } from 'react'
import type { ProviderConfigurationSnapshot } from '@shared/provider-configuration'
import { exportProviderConfiguration } from '../lib/provider-configuration-client'
import { commitProviderExchange, createProviderEncryptedBackup, exportProviderRecovery, previewProviderExchange,
  previewProviderRecovery, type ImportPreview, type SecretBinding } from '../lib/provider-config-recovery-client'
import { textInputClass } from './settings-section-providers-controls'
import { settingsButtonClass } from './settings-button'
type T = (key: string, options?: Record<string, unknown>) => string
export function ProviderConfigurationExchange({ snapshot, onApplied, t }: {
  snapshot: ProviderConfigurationSnapshot; onApplied: (next: ProviderConfigurationSnapshot) => void; t: T
}) {
  const [document, setDocument] = useState(''), [password, setPassword] = useState('')
  const [sources, setSources] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ImportPreview>(), [values, setValues] = useState<Record<string, string>>({})
  const [recovery, setRecovery] = useState<Awaited<ReturnType<typeof previewProviderRecovery>>>()
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const inspect = async () => {
    const input = JSON.parse(document) as Record<string, unknown>
    setPreview(await previewProviderExchange(snapshot.revision, input, password)); setValues({}); setSources({})
  }
  const apply = async () => {
    if (!preview) return
    const bindings: SecretBinding[] = preview.secretSlots.flatMap<SecretBinding>((slot) => {
      const value = values[slot.id]?.trim()
      if (slot.kind === 'credential' && sources[slot.id]) return [{ slotId: slot.id, kind: 'credential' as const, sourceConnectionId: sources[slot.id] }]
      if (!value) return []
      return slot.kind === 'credential' ? [{ slotId: slot.id, kind: 'credential' as const, credential: value }]
        : [{ slotId: slot.id, kind: 'headers' as const, headers: JSON.parse(value) as Record<string, string> }]
    })
    const result = await commitProviderExchange(preview, bindings)
    onApplied(result.snapshot); setPreview(undefined); setValues({}); setSources({}); setPassword('')
    setNotice(t(result.applied ? 'providerConfiguration.applied' : 'providerConfiguration.pendingActivation'))
  }
  return <section aria-label={t('providerExchange.title')} className="space-y-3 rounded-lg border border-ds-border-muted p-3">
    <h3 className="font-medium">{t('providerExchange.title')}</h3>
    <p className="text-[12px] text-ds-muted">{t('providerExchange.description')}</p>
    <label className="block space-y-1"><span>{t('providerExchange.document')}</span>
      <textarea className={`${textInputClass} min-h-36 font-mono text-[12px]`} value={document} disabled={busy}
        onChange={(event) => { setDocument(event.target.value); setPreview(undefined); setValues({}); setRecovery(undefined) }} />
    </label>
    <label className="block space-y-1"><span>{t('providerExchange.password')}</span>
      <input className={textInputClass} type="password" autoComplete="new-password" value={password} disabled={busy}
        onChange={(event) => setPassword(event.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button className={settingsButtonClass()} disabled={busy} onClick={() => void run(async () => {
        setDocument(JSON.stringify(await exportProviderConfiguration(), null, 2)); setPreview(undefined)
      })}>{t('providerExchange.export')}</button>
      <button className={settingsButtonClass()} disabled={busy || password.length < 12} onClick={() => void run(async () => {
        const result = await createProviderEncryptedBackup(password); setDocument(JSON.stringify(result.backup, null, 2)); setPassword(''); setPreview(undefined)
        setNotice(t('providerExchange.backupReady', { count: result.missingSlots.length }))
      })}>{t('providerExchange.backup')}</button>
      <button className={settingsButtonClass()} disabled={busy || !document.trim()} onClick={() => void run(inspect)}>{t('providerExchange.preview')}</button>
      <button className={settingsButtonClass()} disabled={busy} onClick={() => void run(async () => setRecovery(await previewProviderRecovery()))}>{t('providerExchange.recovery')}</button>
    </div>
    {preview ? <div className="space-y-3">
      <p>{t('providerExchange.remapExplanation')}</p>
      <pre className="max-h-32 overflow-auto text-[11px]">{JSON.stringify(preview.remaps, null, 2)}</pre>
      {preview.secretSlots.map((slot) => <label key={slot.id} className="block space-y-1">
        <span>{slot.connectionId} · {slot.kind} · {slot.bound ? t('providerExchange.bound') : t('providerExchange.unbound')}</span>
        {slot.kind === 'credential' ? <select className={textInputClass} aria-label={t('providerExchange.existingAccount')} disabled={busy} value={sources[slot.id] ?? ''} onChange={(event) => setSources((current) => ({ ...current, [slot.id]: event.target.value }))}><option value="">{t('providerExchange.newCredential')}</option>{snapshot.connections.filter((connection) => connection.configured && connection.authType !== 'none').map((connection) => <option key={connection.id} value={connection.id}>{connection.name} · {connection.id}</option>)}</select> : null}
        {slot.names?.length ? <span className="block text-[11px] text-ds-muted">{slot.names.join(', ')}</span> : null}
        <input className={textInputClass} type="password" autoComplete="off" disabled={busy || Boolean(sources[slot.id])} value={values[slot.id] ?? ''}
          placeholder={t(slot.kind === 'headers' ? 'providerExchange.headerJson' : 'providerExchange.key')}
          onChange={(event) => setValues((current) => ({ ...current, [slot.id]: event.target.value }))} />
      </label>)}
      <p className="text-[12px] text-ds-muted">{t('providerExchange.drafts')}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(preview.operations, null, 2)}</pre>
      <button className={settingsButtonClass({ variant: 'primary' })} disabled={busy || preview.expectedRevision !== snapshot.revision}
        onClick={() => void run(apply)}>{t('providerExchange.apply')}</button>
    </div> : null}
    {recovery ? <div className="space-y-2">
      <p>{t(recovery.canDowngrade ? 'providerExchange.recoveryAllowed' : 'providerExchange.recoveryBlocked')}</p>
      {recovery.blockingReasons.map((reason) => <p key={reason.path} className="text-[12px]">{reason.path}: {reason.reason}</p>)}
      <p className="text-[12px] text-ds-muted">{t('providerExchange.recoveryInstructions')}</p>
      <button className={settingsButtonClass()} disabled={busy || !recovery.canDowngrade || recovery.revision !== snapshot.revision}
        onClick={() => void run(async () => setDocument(JSON.stringify(await exportProviderRecovery(recovery.revision), null, 2)))}>{t('providerExchange.recoveryExport')}</button>
    </div> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {busy ? <p role="status">{t('providerConfiguration.working')}</p> : null}
    {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
  </section>
}

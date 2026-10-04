import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { GatewayClientSetupPreview } from '@shared/gateway-client-setup'
import type { GatewayLaunchProfilePreview } from '@shared/gateway-launch-profile'
import { settingsButtonClass } from './settings-button'

export function GatewayLaunchProfile({ setup }: { setup: GatewayClientSetupPreview }): ReactElement {
  const { t } = useTranslation('settings')
  const [preview, setPreview] = useState<GatewayLaunchProfilePreview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [restored, setRestored] = useState(false)
  useEffect(() => { setPreview(null); setError(''); setRestored(false) }, [setup.clientId, setup.baseUrl, setup.modelId])
  const available = typeof window !== 'undefined' && typeof window.kunGui?.gatewayLaunchProfile === 'function'
  const act = async (action: 'preview' | 'apply' | 'restore'): Promise<void> => {
    if (!available || pending) return
    setPending(true); setError(''); setRestored(false)
    try {
      const result = await window.kunGui.gatewayLaunchProfile(action === 'preview'
        ? { action, clientId: setup.clientId, baseUrl: setup.baseUrl, modelId: setup.modelId }
        : { action, planId: preview!.planId })
      if (!result.ok) throw new Error(result.error ?? 'Launch profile failed')
      if (result.preview) setPreview(result.preview)
      if (result.restored) { setPreview(null); setRestored(true) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  if (!setup.content) return <p className="text-[11px] text-ds-muted">{t('gatewayConnection.claudeCompatibility')}</p>
  return <section className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-ds-border p-3" data-gateway-launch-profile>
    <h4 className="text-[12px] font-semibold text-ds-ink">{t('gatewayConnection.profileTitle')}</h4>
    <p className="text-[11px] leading-5 text-ds-muted">{t('gatewayConnection.profileHint')}</p>
    <button type="button" className={settingsButtonClass()} disabled={!available || pending} onClick={() => void act('preview')}>{t('gatewayConnection.chooseFolder')}</button>
    {preview ? <>
      <p className="break-all font-mono text-[11px] text-ds-muted">{preview.path}</p>
      <details open className="min-w-0 max-w-full rounded-lg border border-ds-border p-2"><summary className="cursor-pointer text-[11px] font-medium text-ds-ink">{t('gatewayConnection.reviewFile')}</summary>
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="min-w-0"><p className="text-[11px] text-ds-muted">{t('gatewayConnection.before')}</p><pre className="min-w-0 max-w-full overflow-x-auto bg-ds-main p-2 text-[11px]">{preview.before || t('gatewayConnection.newFile')}</pre></div>
          <div className="min-w-0"><p className="text-[11px] text-ds-muted">{t('gatewayConnection.after')}</p><pre className="min-w-0 max-w-full overflow-x-auto bg-ds-main p-2 text-[11px]">{preview.after}</pre></div>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={pending || preview.applied} onClick={() => void act('apply')}>{t('gatewayConnection.applyProfile')}</button>
        <button type="button" className={settingsButtonClass()} disabled={pending || !preview.canRestore} onClick={() => void act('restore')}>{t('gatewayConnection.restoreProfile')}</button>
      </div>
      {preview.applied ? <p role="status" className="text-[11px] text-emerald-700">{t('gatewayConnection.profileApplied')}</p> : null}
      <pre className="min-w-0 max-w-full overflow-x-auto rounded-lg bg-ds-main p-2 text-[11px]">{preview.launch}</pre>
    </> : null}
    {restored ? <p role="status" className="text-[11px] text-emerald-700">{t('gatewayConnection.profileRestored')}</p> : null}
    {error ? <p role="alert" className="text-[11px] text-red-600">{error}</p> : null}
  </section>
}

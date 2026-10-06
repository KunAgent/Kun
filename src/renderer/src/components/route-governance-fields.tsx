import type { ModelRoutePoolV1 } from '@shared/app-settings'
import { useTranslation } from 'react-i18next'

export function RouteGovernanceFields({ pool, update, inputClass, translation }: { pool: ModelRoutePoolV1;
  update(patch: Partial<ModelRoutePoolV1>): void; inputClass: string; translation?: import('i18next').TFunction }) {
  const { t: localT } = useTranslation('settings')
  const t = translation ?? localT
  return <>
    <label className="space-y-1 text-[12px] text-ds-muted">{t('providerConfiguration.capabilityMode')}
      <select value={pool.capabilityMode ?? 'request-filter'} className={inputClass}
        onChange={(event) => update({ capabilityMode: event.target.value as 'guaranteed' | 'request-filter' })}>
        <option value="guaranteed">{t('providerConfiguration.capabilityGuaranteed')}</option>
        <option value="request-filter">{t('providerConfiguration.capabilityFilter')}</option>
      </select>
    </label>
    <label className="space-y-1 text-[12px] text-ds-muted">{t('providerConfiguration.affinity')}
      <select value={pool.affinity?.mode ?? 'off'} className={inputClass}
        onChange={(event) => update({ affinity: { mode: event.target.value as 'off' | 'turn' | 'session', ttlMs: pool.affinity?.ttlMs ?? 1_800_000 } })}>
        {(['off', 'turn', 'session'] as const).map((mode) => <option key={mode} value={mode}>{t(`providerConfiguration.affinity${mode}`)}</option>)}
      </select>
    </label>
    {pool.affinity?.mode && pool.affinity.mode !== 'off' ? <label className="space-y-1 text-[12px] text-ds-muted">
      {t('providerConfiguration.affinityMinutes')}<input type="number" min={1} max={1440} value={Math.floor(pool.affinity.ttlMs / 60_000)} className={inputClass}
        onChange={(event) => update({ affinity: { mode: pool.affinity!.mode, ttlMs: Math.max(60_000, Math.min(86_400_000, Number(event.target.value) * 60_000)) } })} />
    </label> : null}
  </>
}

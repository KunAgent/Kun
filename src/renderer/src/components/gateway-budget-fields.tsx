import { useTranslation } from 'react-i18next'
import type { GatewayClientPolicy } from '@shared/provider-configuration'
import { textInputClass, providerSelectControlClass } from './settings-section-providers-controls'

export function GatewayBudgetFields({ policy, edit, disabled }: { policy: GatewayClientPolicy;
  edit(patch: Partial<GatewayClientPolicy>): void; disabled: boolean }) {
  const { t } = useTranslation('settings')
  const budget = policy.tokenBudget
  const updateBudget = (next: GatewayClientPolicy['tokenBudget']) => edit({ tokenBudget: next,
    ...(next && policy.costAlert ? { costAlert: { ...policy.costAlert, period: next.period, timeZone: next.timeZone } } : {}) })
  return <fieldset disabled={disabled} className="space-y-2 rounded-lg border border-ds-border-muted p-3">
    <legend>{t('providerConfiguration.budget')}</legend>
    <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(budget)} onChange={(event) => edit({
      tokenBudget: event.target.checked ? { mode: 'soft', period: policy.costAlert?.period ?? 'month', timeZone: policy.costAlert?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        tokens: 1_000_000 } : undefined })} />{t('providerConfiguration.budgetEnabled')}</label>
    {budget ? <>
      <p className="text-ds-muted">{t('providerConfiguration.budgetHint')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>{t('providerConfiguration.budgetMode')}<select className={providerSelectControlClass} value={budget.mode}
          onChange={(event) => updateBudget({ ...budget, mode: event.target.value as 'hard' | 'soft' })}>
          <option value="soft">{t('providerConfiguration.budgetSoft')}</option><option value="hard">{t('providerConfiguration.budgetHard')}</option>
        </select></label>
        <label>{t('providerConfiguration.budgetPeriod')}<select className={providerSelectControlClass} value={budget.period}
          onChange={(event) => updateBudget({ ...budget, period: event.target.value as 'day' | 'week' | 'month' })}>
          {(['day', 'week', 'month'] as const).map((period) => <option key={period} value={period}>{t(`providerConfiguration.budget${period}`)}</option>)}
        </select></label>
        <label>{t('providerConfiguration.budgetTokens')}<input className={textInputClass} type="number" min={1} value={budget.tokens}
          onChange={(event) => updateBudget({ ...budget, tokens: Number(event.target.value) })} /></label>
        <label>{t('providerConfiguration.budgetZone')}<input className={textInputClass} value={budget.timeZone}
          onChange={(event) => updateBudget({ ...budget, timeZone: event.target.value })} /></label>
        <label>{t('providerConfiguration.maxOutput')}<input className={textInputClass} type="number" min={1} value={policy.maxOutputTokens ?? ''}
          onChange={(event) => edit({ maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })} /></label>
      </div>
    </> : null}
    <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(policy.costAlert)}
      onChange={(event) => edit({ costAlert: event.target.checked ? { usd: 10, period: budget?.period ?? 'month',
        timeZone: budget?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined })} />{t('providerConfiguration.costAlert')}</label>
    {policy.costAlert ? <>
      <p className="text-ds-muted">{t('providerConfiguration.costAlertHint')}</p>
      <label>{t('providerConfiguration.costAlertUsd')}<input type="number" min={0.01} step={0.01} className={textInputClass}
        value={policy.costAlert.usd} onChange={(event) => edit({ costAlert: { ...policy.costAlert!, usd: Number(event.target.value) } })} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={policy.costAlert.enforce === true}
        onChange={(event) => edit({ costAlert: { ...policy.costAlert!, enforce: event.target.checked || undefined } })} />{t('providerConfiguration.costLimitEnforce')}</label>
      {!budget ? <div className="grid gap-2 sm:grid-cols-2">
        <label>{t('providerConfiguration.budgetPeriod')}<select className={providerSelectControlClass} value={policy.costAlert.period}
          onChange={(event) => edit({ costAlert: { ...policy.costAlert!, period: event.target.value as 'day' | 'week' | 'month' } })}>
          {(['day', 'week', 'month'] as const).map((period) => <option key={period} value={period}>{t(`providerConfiguration.budget${period}`)}</option>)}
        </select></label>
        <label>{t('providerConfiguration.budgetZone')}<input className={textInputClass} value={policy.costAlert.timeZone}
          onChange={(event) => edit({ costAlert: { ...policy.costAlert!, timeZone: event.target.value } })} /></label>
      </div> : null}
    </> : null}
  </fieldset>
}

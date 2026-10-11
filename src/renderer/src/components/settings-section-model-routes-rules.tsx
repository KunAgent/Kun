import type { TFunction } from 'i18next'
import { GitBranch, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import {
  MODEL_ROUTE_RULE_EFFORTS,
  NESTED_ROUTE_PROVIDER_ID,
  type ModelProviderSettingsV1,
  type ModelRouteRuleEffort,
  type ModelRouteRuleV1,
  type ModelRoutePoolV1
} from '@shared/app-settings'
import { modelProviderIsOauthOrDelegated } from '@shared/app-settings-provider-failover'
import { settingsButtonClass } from './settings-button'
import { Toggle } from './settings-controls'
import { Field, compactInputClass } from './settings-section-model-routes-support'

function targetLabel(settings: ModelProviderSettingsV1, target: ModelRoutePoolV1['targets'][number]): string {
  if (target.providerId === NESTED_ROUTE_PROVIDER_ID) return `↳ ${target.modelId}`
  const provider = settings.providers.find((entry) => entry.id === target.providerId)
  return `${provider?.name ?? target.providerId} / ${target.modelId}`
}

const list = (value: string): string[] => value.split(',').map((entry) => entry.trim()).filter(Boolean)
const optionalNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function RuleRow({ rule, pool, settings, intents, t, onChange, onRemove }: {
  rule: ModelRouteRuleV1
  pool: ModelRoutePoolV1
  settings: ModelProviderSettingsV1
  intents: string[]
  t: TFunction
  onChange: (patch: Partial<ModelRouteRuleV1>) => void
  onRemove: () => void
}): ReactElement {
  const when = (patch: Partial<ModelRouteRuleV1['when']>): void => {
    const next = { ...rule.when, ...patch }
    for (const key of Object.keys(next) as (keyof ModelRouteRuleV1['when'])[]) if (next[key] === undefined) delete next[key]
    onChange({ when: next })
  }
  return <article className="grid gap-2.5 rounded-xl border border-ds-border bg-ds-card p-3" data-route-rule={rule.id}>
    <div className="flex flex-wrap items-center gap-2">
      <Toggle checked={rule.enabled} onChange={(enabled) => onChange({ enabled })} ariaLabel={t('routeRules.ruleEnabled')} />
      <span className="text-[12px] font-medium text-ds-ink">{t('routeRules.then')}</span>
      <select aria-label={t('routeRules.use')} value={rule.use} onChange={(event) => onChange({ use: event.target.value })} className={`${compactInputClass} min-w-0 flex-1`}>
        {pool.targets.map((target) => <option key={target.id} value={target.id}>{targetLabel(settings, target)}</option>)}
      </select>
      <select aria-label={t('routeRules.effort')} value={rule.effort ?? ''} onChange={(event) => onChange({ effort: (event.target.value || undefined) as ModelRouteRuleEffort | undefined })} className={`${compactInputClass} w-32`}>
        <option value="">{t('routeRules.effortAsAsked')}</option>
        {MODEL_ROUTE_RULE_EFFORTS.map((effort) => <option key={effort} value={effort}>{t(`routeRules.efforts.${effort}`)}</option>)}
      </select>
      <button type="button" onClick={onRemove} aria-label={t('routeRules.removeRule')} className={settingsButtonClass({ variant: 'danger-ghost', size: 'icon' })}><Trash2 className="h-4 w-4" /></button>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Field label={t('routeRules.agents')}><input value={(rule.when.agents ?? []).join(', ')} placeholder="claude-code, codex"
        onChange={(event) => when({ agents: list(event.target.value.toLowerCase()).length ? list(event.target.value.toLowerCase()) : undefined })} className={compactInputClass} /></Field>
      <Field label={t('routeRules.contains')}><input value={rule.when.contains ?? ''} placeholder={t('routeRules.containsPlaceholder')}
        onChange={(event) => when({ contains: event.target.value || undefined })} className={compactInputClass} /></Field>
      <Field label={t('routeRules.tokens')}><span className="flex gap-1.5">
        <input inputMode="numeric" aria-label={t('routeRules.minTokens')} placeholder={t('routeRules.min')} value={rule.when.minTokens ?? ''} onChange={(event) => when({ minTokens: optionalNumber(event.target.value) })} className={compactInputClass} />
        <input inputMode="numeric" aria-label={t('routeRules.maxTokens')} placeholder={t('routeRules.max')} value={rule.when.maxTokens ?? ''} onChange={(event) => when({ maxTokens: optionalNumber(event.target.value) })} className={compactInputClass} />
      </span></Field>
      <Field label={t('routeRules.images')}><select value={rule.when.images === undefined ? '' : String(rule.when.images)}
        onChange={(event) => when({ images: event.target.value === '' ? undefined : event.target.value === 'true' })} className={compactInputClass}>
        <option value="">{t('routeRules.any')}</option><option value="true">{t('routeRules.withImages')}</option><option value="false">{t('routeRules.withoutImages')}</option>
      </select></Field>
      <Field label={t('routeRules.hours')}><span className="flex items-center gap-1.5">
        <input type="number" min={0} max={23} aria-label={t('routeRules.hoursFrom')} value={rule.when.hours?.from ?? ''} placeholder="9"
          onChange={(event) => { const from = optionalNumber(event.target.value); when({ hours: from === undefined ? undefined : { from: Math.min(23, from), to: rule.when.hours?.to ?? 18 } }) }} className={compactInputClass} />
        <span className="text-ds-faint">–</span>
        <input type="number" min={0} max={24} aria-label={t('routeRules.hoursTo')} value={rule.when.hours?.to ?? ''} placeholder="18"
          onChange={(event) => { const to = optionalNumber(event.target.value); when({ hours: to === undefined ? undefined : { from: rule.when.hours?.from ?? 9, to: Math.min(24, to) } }) }} className={compactInputClass} />
      </span></Field>
      <Field label={t('routeRules.efforts.label')}><select value={(rule.when.efforts ?? [])[0] ?? ''}
        onChange={(event) => when({ efforts: event.target.value ? [event.target.value as ModelRouteRuleEffort] : undefined })} className={compactInputClass}>
        <option value="">{t('routeRules.any')}</option>
        {MODEL_ROUTE_RULE_EFFORTS.map((effort) => <option key={effort} value={effort}>{t(`routeRules.efforts.${effort}`)}</option>)}
      </select></Field>
      {intents.length ? <Field label={t('routeRules.intent')}><select value={rule.when.intent ?? ''} onChange={(event) => when({ intent: event.target.value || undefined })} className={compactInputClass}>
        <option value="">{t('routeRules.any')}</option>{intents.map((intent) => <option key={intent} value={intent}>{intent}</option>)}
      </select></Field> : null}
    </div>
  </article>
}

/** Turn-level decisions for a route: manual pick, rules, the intent classifier and overflow demotion. */
export function ModelRouteDecisions({ settings, pool, onUpdate, t }: {
  settings: ModelProviderSettingsV1
  pool: ModelRoutePoolV1
  onUpdate: (patch: Partial<ModelRoutePoolV1>) => void
  t: TFunction
}): ReactElement {
  const rules = pool.rules ?? []
  const updateRule = (id: string, patch: Partial<ModelRouteRuleV1>): void => onUpdate({ rules: rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) })
  const classifierModels = settings.providers.filter((provider) => provider.models.length && !modelProviderIsOauthOrDelegated(provider))
    .flatMap((provider) => provider.models.map((modelId) => ({ providerId: provider.id, modelId, label: `${provider.name} / ${modelId}` })))
  const classifier = pool.classifier
  return <section className="grid gap-3" data-route-decisions>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ds-ink"><GitBranch className="h-4 w-4 text-accent" />{t('routeRules.title')}</h3>
        <p className="mt-1 max-w-[44rem] text-[11px] leading-5 text-ds-faint">{t('routeRules.hint')}</p>
      </div>
      <button type="button" className={settingsButtonClass()} disabled={!pool.targets.length}
        onClick={() => onUpdate({ rules: [...rules, { id: `rule-${Date.now().toString(36)}`, enabled: true, use: pool.targets[0]!.id, when: {} }] })}>
        <Plus className="h-3.5 w-3.5" />{t('routeRules.addRule')}
      </button>
    </div>
    {pool.strategy === 'manual' ? <Field label={t('routeRules.pick')}>
      <select value={pool.pick ?? pool.targets[0]?.id ?? ''} onChange={(event) => onUpdate({ pick: event.target.value })} className={compactInputClass}>
        {pool.targets.map((target) => <option key={target.id} value={target.id}>{targetLabel(settings, target)}</option>)}
      </select>
    </Field> : null}
    {rules.length ? <div className="grid gap-2">{rules.map((rule) => <RuleRow key={rule.id} rule={rule} pool={pool} settings={settings}
      intents={classifier?.intents ?? []} t={t} onChange={(patch) => updateRule(rule.id, patch)}
      onRemove={() => onUpdate({ rules: rules.filter((entry) => entry.id !== rule.id) })} />)}</div>
      : <p className="rounded-lg bg-ds-main px-3 py-2 text-[11px] text-ds-muted">{t('routeRules.empty')}</p>}
    <div className="grid gap-2 rounded-xl border border-dashed border-ds-border p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ds-ink"><Sparkles className="h-3.5 w-3.5 text-accent" />{t('routeRules.classifier')}</div>
      <p className="text-[11px] leading-5 text-ds-faint">{t('routeRules.classifierHint')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('routeRules.classifierModel')}><select value={classifier ? JSON.stringify([classifier.providerId, classifier.modelId]) : ''}
          onChange={(event) => {
            if (!event.target.value) { onUpdate({ classifier: undefined }); return }
            const [providerId, modelId] = JSON.parse(event.target.value) as [string, string]
            onUpdate({ classifier: { providerId, modelId, intents: classifier?.intents.length ? classifier.intents : ['code', 'chat'] } })
          }} className={compactInputClass}>
          <option value="">{t('routeRules.classifierOff')}</option>
          {classifierModels.map((model) => <option key={`${model.providerId}/${model.modelId}`} value={JSON.stringify([model.providerId, model.modelId])}>{model.label}</option>)}
        </select></Field>
        <Field label={t('routeRules.intents')}><input disabled={!classifier} value={(classifier?.intents ?? []).join(', ')} placeholder="tests, refactor, chat"
          onChange={(event) => classifier && onUpdate({ classifier: { ...classifier, intents: list(event.target.value).slice(0, 12) } })} className={compactInputClass} /></Field>
      </div>
    </div>
    <label className="flex items-center justify-between gap-3 rounded-xl border border-ds-border px-3 py-2.5 text-[12px] text-ds-ink">
      <span><span className="font-medium">{t('routeRules.overflow')}</span><span className="mt-0.5 block text-[11px] text-ds-faint">{t('routeRules.overflowHint')}</span></span>
      <Toggle checked={pool.overflowMove !== false} onChange={(value) => onUpdate({ overflowMove: value })} ariaLabel={t('routeRules.overflow')} />
    </label>
  </section>
}

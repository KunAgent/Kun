import type { ModelProviderModelProfileV1 } from '@shared/app-settings'
import { MODEL_METADATA_FIELDS, type ModelMetadataField } from '../../../../kun/src/contracts/model-metadata-evidence.js'
import { resolveModelMetadata } from '../../../../kun/src/services/model-metadata-resolver.js'
import { settingsButtonClass } from './settings-button'
import type { Translate } from './settings-section-provider-models-support'

export function ProviderModelMetadataPanel({ profile, t, onRestore, onAdopt }: {
  profile: ModelProviderModelProfileV1
  t: Translate
  onRestore: (field: ModelMetadataField) => void
  onAdopt: (field: ModelMetadataField, value: unknown, observationId: string) => void
}) {
  const resolved = resolveModelMetadata(profile)
  const observations = profile.metadata?.observations ?? []
  const limits: ModelMetadataField[] = ['contextWindowTokens', 'maxInputTokens', 'maxOutputTokens']
  const fields = [...limits, ...MODEL_METADATA_FIELDS.filter((field) => !limits.includes(field))]
  const format = (value: unknown): string => value === undefined
    ? t('providerConfiguration.evidenceunknown')
    : typeof value === 'boolean'
      ? t(value ? 'providerConfiguration.valueSupported' : 'providerConfiguration.valueUnsupported')
      : typeof value === 'number' ? value.toLocaleString()
        : Array.isArray(value) ? value.map(format).join(', ')
          : typeof value === 'object' && value !== null && 'supportedEfforts' in value
            ? `${format(value.supportedEfforts)}${'defaultEffort' in value ? ` (${t('providerConfiguration.reasoningDefaultValue', { value: format(value.defaultEffort) })})` : ''}`
            : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return <details className="rounded-xl border border-ds-border px-3 py-2" open>
    <summary className="cursor-pointer text-[12px] font-semibold text-ds-muted">{t('providerConfiguration.modelMetadataTitle')}</summary>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead><tr>{['metadataField', 'automaticValue', 'configuredValue', 'effectiveValue'].map((key) =>
          <th key={key} className="px-2 py-1 font-medium">{t(`providerConfiguration.${key}`)}</th>)}</tr></thead>
        <tbody>{fields.filter((field) => resolved[field as keyof typeof resolved] !== undefined || profile.metadata?.overrides[field] !== undefined || observations.some((row) => row.values[field] !== undefined))
          .map((field) => {
            const resolution = resolved.metadataResolution?.[field]
            const own = profile.metadata?.overrides[field]
            const evidence = resolved.evidence?.[field]
            const suggestion = observations.find((observation) => observation.match && observation.match !== 'exact' && observation.values[field] !== undefined)
            return <tr key={field} className="border-t border-ds-border-muted align-top">
              <td className="max-w-36 break-words px-2 py-2">
                {t(`providerConfiguration.metadata${field}`, { defaultValue: field })}
                {evidence?.source ? <div className="text-ds-faint">{t(evidence.status === 'unknown' ? 'providerConfiguration.evidenceunknown' : `providerConfiguration.metadataSource${evidence.source}`)}</div> : null}
                <div className="max-w-48 break-all text-ds-faint">{[evidence?.sourceId, evidence?.fieldPath, evidence?.match].filter(Boolean).join(" · ")}</div>
                {evidence?.observedAt ? <div className="text-ds-faint">{new Date(evidence.observedAt).toLocaleString()}</div> : null}
                {evidence?.stale ? <span className="text-amber-600 dark:text-amber-300">{t('providerConfiguration.metadataStale')}</span> : null}
                {resolution?.reason ? <div className="text-amber-600 dark:text-amber-300">{t(`providerConfiguration.resolution${resolution.reason}`)}</div> : null}
              </td>
              <td className="max-w-48 break-all px-2 py-2">{format(resolution?.automaticValue)}
                {suggestion ? <div className="mt-1 grid gap-1 text-ds-faint">
                  <span>{t('providerConfiguration.suggestedValue', { value: format(suggestion.values[field]), source: suggestion.id, match: suggestion.match })}</span>
                  <button type="button" className={settingsButtonClass({ size: 'compact' })} onClick={() => onAdopt(field, suggestion.values[field], suggestion.id)}>{t('providerConfiguration.adoptSuggestion')}</button>
                </div> : null}
              </td>
              <td className="max-w-48 break-all px-2 py-2">{own === undefined ? '—' : format(own)}
                {own !== undefined ? <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact', className: 'mt-1' })} onClick={() => onRestore(field)}>{t('providerConfiguration.restoreAutomatic')}</button> : null}
              </td>
              <td className="max-w-48 break-all px-2 py-2">{format(evidence?.status === 'unknown' ? undefined : resolution?.effectiveValue ?? resolved[field as keyof typeof resolved])}</td>
            </tr>
          })}</tbody>
      </table>
    </div>
  </details>
}

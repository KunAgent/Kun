import { useTranslation } from 'react-i18next'
import type { ModelProviderModelProfileV1 } from '@shared/app-settings'
export function ProviderModelEvidenceSummary({ profile }: { profile: ModelProviderModelProfileV1 }) {
  const { t } = useTranslation('settings')
  return <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ds-muted">
    {(['supportsToolCalling', 'contextWindowTokens', 'pricing'] as const).map((field) => {
      const fact = profile.evidence?.[field]
      return <span key={field} title={fact?.observedAt ? new Date(fact.observedAt).toLocaleString() : undefined}>
        {t(`providerConfiguration.metadata${field}`)}: {t(fact ? fact.status === 'unknown'
          ? 'providerConfiguration.evidenceunknown' : `providerConfiguration.metadataSource${fact.source}`
          : profile[field] === undefined ? 'providerConfiguration.evidenceunknown' : 'providerConfiguration.metadataDeclared')}
      </span>
    })}
  </span>
}

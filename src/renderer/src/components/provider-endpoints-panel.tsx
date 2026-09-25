import type {
  ModelEndpointFormat,
  ModelProviderEndpointsV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import { normalizeModelProviderEndpoints } from '@shared/app-settings'
import type { ProviderProtocolDetectResult } from '@shared/kun-gui-api'
import { Loader2, Radar } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { DetailSection, textInputClass } from './settings-section-providers-controls'
import { MODEL_ENDPOINT_FORMAT_LABEL_KEYS } from './settings-section-providers-profile'

const ENDPOINT_FORMAT_FIELDS: {
  format: keyof ModelProviderEndpointsV1
  labelKey: string
}[] = [
  { format: 'chat_completions', labelKey: 'modelProviderEndpointChat' },
  { format: 'responses', labelKey: 'modelProviderEndpointResponses' },
  { format: 'messages', labelKey: 'modelProviderEndpointMessages' }
]

/**
 * Per-protocol base URL overrides (plan §6.13). A relay may serve Anthropic
 * messages on a different path than OpenAI chat completions; each row stores
 * an optional absolute URL and falls back to the profile `baseUrl` when empty.
 * The "detect" action asks Kun which wire protocols the base URL speaks and
 * can apply the recommended endpoint format.
 */
export function ProviderEndpointsPanel({
  provider,
  t,
  onChange
}: {
  provider: ModelProviderProfileV1
  t: (key: string, options?: Record<string, unknown>) => string
  onChange: (patch: Partial<ModelProviderProfileV1>) => void
}): ReactElement {
  const endpoints = provider.endpoints ?? {}
  const [detecting, setDetecting] = useState(false)
  const [detectResult, setDetectResult] = useState<ProviderProtocolDetectResult | null>(null)
  const [detectError, setDetectError] = useState('')

  const update = (format: keyof ModelProviderEndpointsV1, value: string): void => {
    const next = normalizeModelProviderEndpoints({
      ...endpoints,
      [format]: value
    })
    onChange(next ? { endpoints: next } : { endpoints: undefined })
  }
  const urlValid = (value: string | undefined): boolean =>
    !value || /^https?:\/\/\S+$/i.test(value)
  const baseUrlValid = /^https?:\/\/\S+$/i.test(provider.baseUrl.trim())

  const detect = async (): Promise<void> => {
    setDetecting(true)
    setDetectError('')
    try {
      const result = await window.kunGui.detectProviderProtocols({
        baseUrl: provider.baseUrl.trim(),
        ...(provider.apiKey.trim() ? { credential: provider.apiKey.trim() } : {}),
        ...(provider.models[0] ? { verifyModel: provider.models[0] } : {}),
        useProxy: provider.useProxy === true
      })
      setDetectResult(result)
    } catch (error) {
      setDetectResult(null)
      setDetectError(error instanceof Error ? error.message : String(error))
    } finally {
      setDetecting(false)
    }
  }

  return (
    <DetailSection
      title={t('modelProviderEndpointsSection')}
      action={
        <button
          type="button"
          disabled={detecting || !baseUrlValid}
          onClick={() => void detect()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
        >
          {detecting
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            : <Radar className="h-3.5 w-3.5" strokeWidth={1.9} />}
          {t('modelProviderDetectProtocol')}
        </button>
      }
    >
      <p className="text-[12px] leading-5 text-ds-faint">
        {t('modelProviderEndpointsHint')}
      </p>
      {detectError ? (
        <p role="alert" className="text-[12px] leading-5 text-red-600 dark:text-red-300">
          {detectError}
        </p>
      ) : null}
      {detectResult ? (
        <div className="grid gap-1.5 rounded-xl border border-ds-border-muted bg-ds-main/30 px-3 py-2.5">
          {detectResult.formats.map((entry) => {
            const isRecommended = entry.format === detectResult.recommended
            return (
              <div key={entry.format} className="flex items-center gap-2 text-[12px]">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    entry.ok
                      ? 'bg-emerald-500'
                      : 'bg-red-400'
                  }`}
                />
                <span className="font-medium text-ds-ink">
                  {t(MODEL_ENDPOINT_FORMAT_LABEL_KEYS[entry.format] ?? entry.format)}
                </span>
                <span className="text-ds-faint">
                  {entry.listed ? t('modelProviderDetectListed') : t('modelProviderDetectUnlisted')}
                  {entry.verified ? ` · ${t('modelProviderDetectVerified')}` : entry.ok ? '' : ` · ${entry.message ?? t('modelProviderDetectFailed')}`}
                  {entry.ok ? ` · ${entry.latencyMs}ms` : ''}
                </span>
                {isRecommended && detectResult.recommended !== provider.endpointFormat ? (
                  <button
                    type="button"
                    onClick={() => onChange({ endpointFormat: detectResult.recommended })}
                    className="ml-auto text-[12px] font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {t('modelProviderDetectApply')}
                  </button>
                ) : null}
              </div>
            )
          })}
          <p className="text-[11.5px] leading-4 text-ds-faint">
            {t('modelProviderDetectCostHint')}
          </p>
        </div>
      ) : null}
      <label className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
        {t('modelProviderCatalogSources')}
        <input
          className={textInputClass}
          value={(provider.catalogSources ?? []).join(', ')}
          placeholder="openrouter, models.dev"
          spellCheck={false}
          onChange={(event) => {
            const sources = event.target.value
              .split(/[,\n]/)
              .map((entry) => entry.trim())
              .filter(Boolean)
            onChange({ catalogSources: sources.length > 0 ? sources : undefined })
          }}
        />
        <span className="text-[11.5px] font-normal leading-4 text-ds-faint">
          {t('modelProviderCatalogSourcesHint')}
        </span>
      </label>
      <div className="grid gap-3">
        {ENDPOINT_FORMAT_FIELDS.map(({ format, labelKey }) => {
          const value = endpoints[format] ?? ''
          return (
            <label key={format} className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
              {t(labelKey)}
              <input
                className={textInputClass}
                value={value}
                placeholder={provider.baseUrl || 'https://…'}
                spellCheck={false}
                aria-invalid={!urlValid(value || undefined)}
                onChange={(event) => update(format, event.target.value)}
              />
              {value && !urlValid(value) ? (
                <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                  {t('modelProviderInvalidUrl')}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
    </DetailSection>
  )
}

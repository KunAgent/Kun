import { useEffect, useState, type ReactElement } from 'react'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import { BALANCE_UNIT_PATTERN, balanceEndpointUrl, providerHost, validBalanceKeyHeader } from '@shared/provider-balance-endpoint'
import { textInputClass } from './settings-section-providers-controls'

type Translate = (key: string, options?: Record<string, unknown>) => string
const CLEARED = { balanceUrl: undefined, balanceUnit: undefined, balanceKeyHeader: undefined, balanceHost: undefined }
const hintClass = 'text-[11.5px] font-normal leading-4 text-ds-faint'
const problemClass = 'text-[12px] font-normal text-amber-600 dark:text-amber-300'

/**
 * Optional balance endpoint read by the quota panel. The provider's key goes
 * to that URL, so another host than the base URL's must be confirmed by name.
 */
export function ProviderBalanceEndpointField({ provider, onChange, t }: {
  provider: ModelProviderProfileV1
  onChange: (patch: Partial<ModelProviderProfileV1>) => void
  t: Translate
}): ReactElement {
  const [draft, setDraft] = useState(provider.balanceUrl ?? '')
  const [unit, setUnit] = useState(provider.balanceUnit ?? '')
  const [header, setHeader] = useState(provider.balanceKeyHeader ?? '')
  useEffect(() => { setDraft(provider.balanceUrl ?? '') }, [provider.balanceUrl])
  useEffect(() => { setUnit(provider.balanceUnit ?? '') }, [provider.balanceUnit])
  useEffect(() => { setHeader(provider.balanceKeyHeader ?? '') }, [provider.balanceKeyHeader])
  const url = balanceEndpointUrl(draft)
  const baseHost = providerHost(provider.baseUrl)
  const otherHost = url && url.host !== baseHost ? url.host : undefined
  const confirmed = otherHost !== undefined && provider.balanceHost === otherHost && provider.balanceUrl === url?.toString()
  const commitUrl = (): void => {
    if (!draft.trim()) { if (provider.balanceUrl) onChange(CLEARED); return }
    // Another host waits for the confirmation below before anything is saved.
    if (url && !otherHost && url.toString() !== provider.balanceUrl) onChange({ balanceUrl: url.toString(), balanceHost: undefined })
  }
  const unitValid = !unit.trim() || BALANCE_UNIT_PATTERN.test(unit.trim())
  const headerValid = !header.trim() || validBalanceKeyHeader(header.trim())
  return <div className="grid gap-3" data-provider-balance-endpoint>
    <label className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
      {t('modelProviderBalanceUrl')}
      <input
        className={textInputClass}
        value={draft}
        placeholder={`${provider.baseUrl.replace(/\/v1\/?$/u, '') || 'https://…'}/api/balance#/data/balance`}
        spellCheck={false}
        aria-invalid={Boolean(draft.trim()) && !url}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitUrl}
      />
      {draft.trim() && !url ? <span className={problemClass}>{t('modelProviderBalanceUrlInvalid')}</span>
        : <span className={hintClass}>{t('modelProviderBalanceUrlHint')}</span>}
    </label>
    {otherHost ? <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] text-ds-ink">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={confirmed}
        onChange={(event) => onChange(event.target.checked && url ? { balanceUrl: url.toString(), balanceHost: otherHost } : CLEARED)}
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{t('modelProviderBalanceOtherHost', { host: otherHost })}</span>
        <span className={hintClass}>{t(confirmed ? 'modelProviderBalanceOtherHostConfirmed' : 'modelProviderBalanceOtherHostHint', { host: otherHost, base: baseHost ?? '' })}</span>
      </span>
    </label> : null}
    {/* Unit and header belong to a saved endpoint; an unconfirmed host saves nothing yet. */}
    {provider.balanceUrl && url?.toString() === provider.balanceUrl ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
        {t('modelProviderBalanceUnit')}
        <input className={textInputClass} value={unit} placeholder="USD" spellCheck={false} aria-invalid={!unitValid}
          onChange={(event) => setUnit(event.target.value)}
          onBlur={() => { if (unitValid && provider.balanceUrl) onChange({ balanceUnit: unit.trim() || undefined }) }} />
        <span className={unitValid ? hintClass : problemClass}>{t(unitValid ? 'modelProviderBalanceUnitHint' : 'modelProviderBalanceUnitInvalid')}</span>
      </label>
      <label className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
        {t('modelProviderBalanceKeyHeader')}
        <input className={textInputClass} value={header} placeholder="Authorization: Bearer" spellCheck={false} aria-invalid={!headerValid}
          onChange={(event) => setHeader(event.target.value)}
          onBlur={() => { if (headerValid && provider.balanceUrl) onChange({ balanceKeyHeader: header.trim() || undefined }) }} />
        <span className={headerValid ? hintClass : problemClass}>{t(headerValid ? 'modelProviderBalanceKeyHeaderHint' : 'modelProviderBalanceKeyHeaderInvalid')}</span>
      </label>
    </div> : null}
  </div>
}

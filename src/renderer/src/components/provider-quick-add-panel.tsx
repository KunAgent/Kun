import type { ModelProviderPresetMode, ModelProviderProfileV1 } from '@shared/app-settings'
import type { ModelProviderPreset } from '@shared/model-provider-presets'
import {
  modelProviderPresetAccountProfile
} from '@shared/model-provider-presets'
import { ChevronDown, ExternalLink, KeyRound, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ProviderIcon } from './provider-icon'
import { Toggle } from './settings-controls'
import { textInputClass } from './settings-section-providers-controls'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Compact quick-add sheet for preset providers (plan §6.5): icon, name, note,
 * website/Get-Key links, autofocused key input (Enter submits), an optional
 * region selector, and collapsed "more settings" for base-URL/proxy
 * overrides. Submitting hands a fully-built profile to the caller which
 * persists it, syncs credentials, and kicks off catalog/probe work.
 */
export function ProviderQuickAddPanel({
  preset,
  mode,
  providers,
  t,
  onClose,
  onSubmit
}: {
  preset: ModelProviderPreset
  mode: ModelProviderPresetMode
  providers: readonly ModelProviderProfileV1[]
  t: (key: string, options?: Record<string, unknown>) => string
  onClose: () => void
  onSubmit: (profile: ModelProviderProfileV1) => Promise<void>
}): ReactElement {
  const [apiKey, setApiKey] = useState('')
  const [regionId, setRegionId] = useState(preset.regions?.[0]?.id ?? '')
  const [baseUrl, setBaseUrl] = useState('')
  const [useProxy, setUseProxy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const keyRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    keyRef.current?.focus()
  }, [])

  const region = preset.regions?.find((entry) => entry.id === regionId)
  const keyOptional = preset.keyOptional === true
  const keyMissing = !keyOptional && !apiKey.trim()

  const submit = async (): Promise<void> => {
    if (busy || keyMissing) return
    setBusy(true)
    setError('')
    try {
      const profile = modelProviderPresetAccountProfile(preset, mode, providers)
      if (!profile) throw new Error('preset produced no profile')
      await onSubmit({
        ...profile,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || region?.baseUrl || profile.baseUrl,
        useProxy,
        ...(preset.catalogSources?.length ? { catalogSources: [...preset.catalogSources] } : {})
      })
      onClose()
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError))
      setBusy(false)
    }
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[55] grid place-items-center overscroll-none bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-quick-add-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="w-full max-w-md overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel">
        <header className="flex items-start justify-between gap-3 border-b border-ds-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ds-border-muted bg-ds-main/45 text-ds-muted">
              <ProviderIcon presetId={preset.id} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="provider-quick-add-title" className="truncate text-[15px] font-semibold text-ds-ink">
                {preset.name}
              </h2>
              <p className="mt-0.5 truncate text-[12px] text-ds-faint">
                {preset.note ?? hostOf(region?.baseUrl ?? preset.baseUrl)}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('modelProviderAddDialogCancel')}
            onClick={onClose}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>
        <div className="grid gap-4 px-5 py-4">
          <label className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
            <span className="flex items-center justify-between gap-2">
              <span>
                {t('modelProviderApiKey')}
                {keyOptional ? (
                  <span className="ml-1.5 font-normal text-ds-faint">
                    {t('modelProviderKeyOptional')}
                  </span>
                ) : null}
              </span>
              {preset.apiKeyUrl ? (
                <button
                  type="button"
                  onClick={() => void window.kunGui.openExternal(preset.apiKeyUrl)}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-accent underline-offset-2 hover:underline"
                >
                  {t('modelProviderGetKey')}
                  <ExternalLink className="h-3 w-3" strokeWidth={2} />
                </button>
              ) : null}
            </span>
            <input
              ref={keyRef}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                if (error) setError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
              className={textInputClass}
              placeholder={keyOptional ? t('modelProviderKeyOptionalHint') : 'sk-…'}
            />
          </label>
          {preset.regions && preset.regions.length > 1 ? (
            <label className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
              {t('modelProviderRegion')}
              <select
                value={regionId}
                onChange={(event) => setRegionId(event.target.value)}
                className={textInputClass}
              >
                {preset.regions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id} · {hostOf(entry.baseUrl)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className="inline-flex w-fit items-center gap-1.5 text-[12px] font-medium text-ds-muted transition hover:text-ds-ink"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition ${moreOpen ? 'rotate-180' : ''}`} strokeWidth={2} />
            {t('modelProviderMoreSettings')}
          </button>
          {moreOpen ? (
            <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-main/30 px-3.5 py-3">
              <label className="grid gap-1.5 text-[12.5px] font-medium text-ds-muted">
                {t('modelProviderBaseUrl')}
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={region?.baseUrl ?? preset.baseUrl}
                  spellCheck={false}
                  className={textInputClass}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-[12.5px] font-medium text-ds-ink">
                <span>{t('modelProviderUseAppProxy')}</span>
                <Toggle
                  ariaLabel={t('modelProviderUseAppProxy')}
                  checked={useProxy}
                  onChange={setUseProxy}
                />
              </label>
            </div>
          ) : null}
          {preset.docsUrl ? (
            <button
              type="button"
              onClick={() => void window.kunGui.openExternal(preset.docsUrl)}
              className="inline-flex w-fit items-center gap-1 text-[12px] text-ds-faint underline-offset-2 transition hover:text-ds-muted hover:underline"
            >
              {t('modelProviderDocsLink')}
              <ExternalLink className="h-3 w-3" strokeWidth={2} />
            </button>
          ) : null}
          {error ? (
            <p role="alert" className="text-[12px] leading-5 text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-ds-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('modelProviderAddDialogCancel')}
          </button>
          <button
            type="button"
            disabled={busy || keyMissing}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              : <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />}
            {t('modelProviderQuickAddSubmit')}
          </button>
        </footer>
      </section>
    </div>
  )
}

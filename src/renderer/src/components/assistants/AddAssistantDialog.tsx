import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Check, Loader2, Lock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ASSISTANT_NAME_MAX, type AssistantPromptLocale } from '@shared/assistant-mailbox'
import { AssistantLogo } from './AssistantLogo'
import { ASSISTANT_PRESETS, assistantPreset } from './assistant-catalog'
import { assistantMailbox, useAssistantMailboxStore } from './assistant-mailbox-store'
import { AssistantSteps } from './AssistantSteps'

const INPUT = 'h-9 rounded-[10px] border border-ds-border-muted bg-ds-card px-3 text-[13.5px] text-ds-ink outline-none focus:border-[var(--ds-border-strong)]'

/** Step 1 of connecting an assistant: which product, what to call it, and the prompt language. */
export function AddAssistantDialog({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (enrollmentId: string) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const { busy, error } = useAssistantMailboxStore()
  const [kind, setKind] = useState<string>('cue')
  const [product, setProduct] = useState('')
  const [website, setWebsite] = useState('')
  const [name, setName] = useState('')
  const [locale, setLocale] = useState<AssistantPromptLocale>((i18n.language ?? '').startsWith('zh') ? 'zh' : 'en')
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus(); assistantMailbox.clearError() }, [])
  const custom = kind === 'other'
  const label = custom ? product.trim() : assistantPreset(kind)?.name ?? ''
  const defaultName = label ? t('assistantMailboxDefaultName', { kind: label }) : t('assistantMailboxKindOther')
  const finalName = (name.trim() || defaultName).slice(0, ASSISTANT_NAME_MAX)
  const ready = !busy && (!custom || product.trim().length > 0)

  const submit = async (): Promise<void> => {
    if (!ready) return
    const created = await assistantMailbox.createEnrollment({
      name: finalName, kind, locale, ...(custom ? { product: product.trim(), ...(website.trim() ? { website: website.trim() } : {}) } : {})
    })
    if (created) onCreated(created.enrollmentId)
  }

  const card = (selected: boolean) => `relative flex w-full items-center gap-2.5 rounded-[14px] p-3 text-left transition ${
    selected ? 'border-[1.5px] border-accent bg-accent-tint/10' : 'border border-ds-border-muted bg-ds-card hover:bg-ds-hover'}`

  return <div className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4"
    onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
    <form role="dialog" aria-modal="true" aria-labelledby="add-assistant-title"
      onSubmit={(event) => { event.preventDefault(); void submit() }}
      className="flex max-h-full w-[580px] max-w-full flex-col gap-4 overflow-y-auto rounded-[22px] border border-ds-border bg-ds-card p-6 text-ds-ink shadow-[0_24px_64px_rgba(16,24,40,0.28)]">
      <div className="flex items-center gap-3">
        <h2 id="add-assistant-title" className="flex-1 text-[17px] font-semibold">{t('assistantMailboxDialogTitle')}</h2>
        <button type="button" onClick={onClose} aria-label={t('assistantMailboxClose')}
          className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"><X size={16} /></button>
      </div>
      <AssistantSteps current={1} />
      <p className="text-[13.5px] leading-[21px] text-ds-muted">{t('assistantMailboxDialogHint')}</p>
      <fieldset className="grid grid-cols-2 gap-2.5">
        <legend className="sr-only">{t('assistantMailboxKind')}</legend>
        {ASSISTANT_PRESETS.map((preset, index) => <button type="button" key={preset.kind} ref={index === 0 ? first : undefined}
          aria-pressed={kind === preset.kind} onClick={() => setKind(preset.kind)} className={card(kind === preset.kind)}>
          <AssistantLogo kind={preset.kind} name={preset.name} size={32} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-1.5"><strong className="text-[13.5px]">{preset.name}</strong>
              <span className="text-[11.5px] text-ds-muted">{preset.maker}</span></span>
            <span className="text-[12px] leading-[17px] text-ds-muted">{t(preset.noteKey)}</span>
          </span>
          {kind === preset.kind ? <Check size={16} className="shrink-0 text-accent" aria-hidden="true" /> : null}
        </button>)}
        <button type="button" aria-pressed={custom} onClick={() => setKind('other')} className={`${card(custom)} col-span-2 ${custom ? '' : 'border-dashed'}`}>
          <AssistantLogo kind="other" name={product.trim() || '?'} size={32} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong className="text-[13.5px]">{t('assistantMailboxKindOther')}</strong>
            <span className="text-[12px] leading-[17px] text-ds-muted">{t('assistantOtherNote')}</span>
          </span>
          {custom ? <Check size={16} className="shrink-0 text-accent" aria-hidden="true" /> : null}
        </button>
      </fieldset>
      {custom ? <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ds-muted">{t('assistantProductName')}
          <input className={INPUT} value={product} maxLength={60} required placeholder={t('assistantProductPlaceholder')} onChange={(event) => setProduct(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ds-muted">{t('assistantWebsite')}
          <input className={INPUT} value={website} maxLength={200} inputMode="url" placeholder="example.com" onChange={(event) => setWebsite(event.target.value)} />
          <span className="text-[11.5px] font-normal">{t('assistantWebsiteHint')}</span>
        </label>
      </div> : null}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ds-muted">{t('assistantMailboxName')}
          <input className={INPUT} value={name} maxLength={ASSISTANT_NAME_MAX} placeholder={defaultName} onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[12.5px] font-medium text-ds-muted">{t('assistantMailboxPromptLanguage')}</legend>
          <span className="inline-flex w-fit gap-0.5 rounded-[10px] bg-ds-subtle p-[3px]">
            {(['zh', 'en'] as const).map((value) => <button type="button" key={value} aria-pressed={locale === value} onClick={() => setLocale(value)}
              className={`h-[30px] rounded-lg px-3.5 text-[13px] ${locale === value ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted'}`}>
              {value === 'zh' ? '中文' : 'English'}</button>)}
          </span>
        </fieldset>
      </div>
      {error ? <p role="alert" className="text-[12px] text-ds-danger">{t('assistantMailboxError', { message: error })}</p> : null}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-ds-border-muted pt-3">
        <span className="flex min-w-[200px] flex-1 items-center gap-1.5 text-[12px] text-ds-muted"><Lock size={13} aria-hidden="true" />{t('assistantNoSecretHint')}</span>
        <button type="button" onClick={onClose} className="h-9 rounded-[10px] border border-ds-border-muted bg-ds-card px-4 text-[13px]">{t('assistantMailboxCancel')}</button>
        <button type="submit" disabled={!ready} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}{t('assistantCreateNext')}
        </button>
      </div>
    </form>
  </div>
}

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Check, Info, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ASSISTANT_NAME_MAX, type AssistantPromptLocale } from '@shared/assistant-mailbox'
import { RoomModal } from '../rooms/RoomModal'
import { AssistantLogo } from './AssistantLogo'
import { ASSISTANT_PRESETS, assistantPreset } from './assistant-catalog'
import { assistantMailbox, startAssistantMailbox, useAssistantMailboxStore } from './assistant-mailbox-store'
import { AssistantSteps } from './AssistantSteps'

const INPUT = 'h-9 w-full rounded-[10px] border border-ds-border-muted bg-ds-card px-3 text-[13px] text-ds-ink outline-none transition focus:border-ds-border-strong'
const LABEL = 'flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted'

type Props = { onClose: () => void; onCreated: (enrollmentId: string) => void }

/** The connect dialog, in the same window-level modal as the new-conversation picker. */
export function AddAssistantDialog(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const busy = useAssistantMailboxStore((state) => state.busy)
  return <RoomModal title={t('assistantMailboxDialogTitle')} busy={busy} onClose={props.onClose}>
    <AddAssistantForm {...props} />
  </RoomModal>
}

function SelectedMark(): ReactElement {
  return <span aria-hidden="true" className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-accent text-white">
    <Check size={11} strokeWidth={3} />
  </span>
}

/** Step 1 of connecting an assistant: which product, what to call it, and the prompt language. */
export function AddAssistantForm({ onClose, onCreated }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const { busy, error, status } = useAssistantMailboxStore()
  const [checking, setChecking] = useState(true)
  const [verified, setVerified] = useState(false)
  const [kind, setKind] = useState<string>('cue')
  const [product, setProduct] = useState('')
  const [website, setWebsite] = useState('')
  const [name, setName] = useState('')
  const [locale, setLocale] = useState<AssistantPromptLocale>((i18n.language ?? '').startsWith('zh') ? 'zh' : 'en')
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let current = true
    assistantMailbox.clearError()
    startAssistantMailbox()
    void assistantMailbox.refresh().then(result => { if (current) setVerified(result?.availability === 'available') })
      .finally(() => { if (current) setChecking(false) })
    // The modal opens after this effect, and opening it moves focus to its first control.
    const frame = requestAnimationFrame(() => first.current?.focus())
    return () => { current = false; cancelAnimationFrame(frame) }
  }, [])
  const custom = kind === 'other'
  const preset = assistantPreset(kind)
  const label = custom ? product.trim() : preset?.name ?? ''
  const defaultName = label ? t('assistantMailboxDefaultName', { kind: label }) : t('assistantMailboxKindOther')
  const finalName = (name.trim() || defaultName).slice(0, ASSISTANT_NAME_MAX)
  const allowed = verified && !checking && status?.availability === 'available'
  const ready = allowed && !busy && (!custom || product.trim().length > 0)

  const submit = async (): Promise<void> => {
    if (!ready) return
    const created = await assistantMailbox.createEnrollment({
      name: finalName, kind, locale, ...(custom ? { product: product.trim(), ...(website.trim() ? { website: website.trim() } : {}) } : {})
    })
    if (created) onCreated(created.enrollmentId)
  }

  const tile = (selected: boolean) => `relative flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60 ${
    selected ? 'border-accent bg-accent-tint/10' : 'border-ds-border-muted bg-ds-card hover:border-ds-border hover:bg-ds-hover'}`

  return <form aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit() }} className="flex flex-col gap-3.5 text-ds-ink">
    <AssistantSteps current={1} />
    <p className="text-[13px] leading-[20px] text-ds-muted">{t('assistantMailboxDialogHint')}</p>
    <p className="text-[12px] font-medium text-ds-muted">{t('assistantVipFeature')}</p>
    {!allowed ? <p role="status" className="text-[13px] text-ds-muted">{t(checking ? 'assistantLoading' : status?.availability === 'upgrade_required' ? 'assistantVipRequired' : 'assistantVipUnavailable')}
      {!checking ? <button type="button" disabled={busy} className="ml-2 text-accent" onClick={() => {
        setVerified(false); setChecking(true)
        void assistantMailbox.refresh().then(result => setVerified(result?.availability === 'available')).finally(() => setChecking(false))
      }}>{t('assistantMailboxRefresh')}</button> : null}
    </p> : null}
    <fieldset className="flex flex-col gap-2" disabled={busy}>
      <legend className="sr-only">{t('assistantMailboxKind')}</legend>
      <div className="grid grid-cols-3 gap-2">
        {ASSISTANT_PRESETS.map((item, index) => <button type="button" key={item.kind} ref={index === 0 ? first : undefined}
          aria-pressed={kind === item.kind} onClick={() => setKind(item.kind)} className={tile(kind === item.kind)}>
          <AssistantLogo kind={item.kind} name={item.name} size={30} />
          <span className="flex min-w-0 flex-col">
            <strong className="truncate text-[13px] font-semibold">{item.name}</strong>
            <span className="truncate text-[11.5px] text-ds-muted">{item.maker}</span>
          </span>
          {kind === item.kind ? <SelectedMark /> : null}
        </button>)}
      </div>
      <button type="button" aria-pressed={custom} onClick={() => setKind('other')}
        className={`${tile(custom)} ${custom ? '' : 'border-dashed'}`}>
        <AssistantLogo kind="other" name={product.trim() || '?'} size={30} />
        <span className="flex min-w-0 flex-col">
          <strong className="text-[13px] font-semibold">{t('assistantMailboxKindOther')}</strong>
          <span className="text-[11.5px] leading-[16px] text-ds-muted">{t('assistantOtherNote')}</span>
        </span>
        {custom ? <SelectedMark /> : null}
      </button>
    </fieldset>
    {custom ? <div className="grid grid-cols-2 gap-3">
      <label className={LABEL}>{t('assistantProductName')}
        <input className={INPUT} value={product} maxLength={60} required placeholder={t('assistantProductPlaceholder')} onChange={(event) => setProduct(event.target.value)} />
      </label>
      <label className={LABEL}>{t('assistantWebsite')}
        <input className={INPUT} value={website} maxLength={200} inputMode="url" placeholder="example.com" aria-describedby="add-assistant-website-hint"
          onChange={(event) => setWebsite(event.target.value)} />
        <span id="add-assistant-website-hint" className="text-[11.5px] font-normal">{t('assistantWebsiteHint')}</span>
      </label>
    </div> : preset ? <p aria-live="polite" className="flex items-start gap-2 rounded-[10px] bg-ds-subtle px-3 py-2 text-[12.5px] leading-[19px] text-ds-muted">
      <Info size={14} className="mt-[2.5px] shrink-0" aria-hidden="true" />
      <span><strong className="font-semibold text-ds-ink">{preset.name}</strong> · {t(preset.noteKey)}</span>
    </p> : null}
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <label className={LABEL}>{t('assistantMailboxName')}
        <input className={INPUT} value={name} maxLength={ASSISTANT_NAME_MAX} placeholder={defaultName} onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[12px] font-medium text-ds-muted">{t('assistantMailboxPromptLanguage')}</legend>
        <span className="inline-flex h-9 w-fit items-center gap-0.5 rounded-[10px] bg-ds-subtle p-[3px]">
          {(['zh', 'en'] as const).map((value) => <button type="button" key={value} aria-pressed={locale === value} onClick={() => setLocale(value)}
            className={`h-full rounded-lg px-3.5 text-[13px] transition ${locale === value ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`}>
            {value === 'zh' ? '中文' : 'English'}</button>)}
        </span>
      </fieldset>
    </div>
    {error ? <p role="alert" className="text-[12px] text-ds-danger">{t('assistantMailboxError', { message: error })}</p> : null}
    <div className="flex items-center justify-end gap-2.5 pt-1">
      <button type="button" onClick={onClose} disabled={busy}
        className="h-9 rounded-[10px] border border-ds-border-muted bg-ds-card px-4 text-[13px] transition hover:bg-ds-hover disabled:opacity-50">{t('assistantMailboxCancel')}</button>
      <button type="submit" disabled={!ready} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}{t('assistantCreateNext')}
      </button>
    </div>
  </form>
}

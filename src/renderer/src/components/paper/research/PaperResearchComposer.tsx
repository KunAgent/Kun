import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FloatingComposerModelPicker } from '../../chat/FloatingComposerModelPicker'
import type { WriteAssistantStageProps } from '../../write/WriteAssistantStageContext'

/**
 * The home search box: a plain text area, one scope pill, the model and a
 * send button — nothing else. (The conversation composer keeps attachments,
 * skills and the rest once a research session is open.)
 */
export function PaperResearchComposer({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder,
  scope,
  assistant,
  autoFocus = true
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  placeholder: string
  /** The scope pill (depth/sources/years). */
  scope: ReactNode
  assistant: Pick<
    WriteAssistantStageProps,
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'composerModelGroups'
    | 'composerReasoningEffort'
    | 'composerFastMode'
    | 'setComposerModel'
    | 'setComposerReasoningEffort'
    | 'setComposerFastMode'
    | 'onConfigureProviders'
    | 'runtimeConnection'
  >
  autoFocus?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const canSend = value.trim().length > 0 && !busy && assistant.runtimeConnection === 'ready'

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(Math.max(area.scrollHeight, 56), 200)}px`
  }, [value])
  useEffect(() => {
    if (autoFocus) areaRef.current?.focus()
  }, [autoFocus])

  return (
    <div className="rounded-[18px] border border-ds-border bg-ds-main px-4 pb-2.5 pt-3.5 shadow-[0_1px_2px_rgba(20,47,95,0.04),0_12px_32px_rgba(32,55,90,0.06)] transition focus-within:border-[var(--ds-accent)]/45">
      <textarea
        ref={areaRef}
        value={value}
        rows={2}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          if (canSend) onSubmit()
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="block max-h-[200px] min-h-[56px] w-full resize-none appearance-none border-0 bg-transparent p-0 text-[15px] leading-[26px] text-ds-ink shadow-none outline-none ring-0 placeholder:text-ds-faint focus:outline-none focus-visible:outline-none focus:ring-0"
      />
      <div className="mt-2.5 flex items-center gap-2">
        <div className="min-w-0 shrink">{scope}</div>
        <span className="flex-1" />
        <FloatingComposerModelPicker
          compact
          mode="combobox"
          composerModel={assistant.composerModel}
          composerProviderId={assistant.composerProviderId}
          composerPickList={assistant.composerPickList}
          composerModelGroups={assistant.composerModelGroups}
          composerReasoningEffort={assistant.composerReasoningEffort}
          composerFastMode={assistant.composerFastMode}
          showProviderInModelLabel
          canChangeModel={!busy}
          onComposerModelChange={assistant.setComposerModel}
          onComposerReasoningEffortChange={assistant.setComposerReasoningEffort}
          onComposerFastModeChange={assistant.setComposerFastMode}
          onConfigureProviders={assistant.onConfigureProviders}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          aria-label={t('paperResearchStart')}
          title={t('paperResearchStart')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ds-control)] text-[var(--ds-control-foreground)] transition hover:opacity-90 disabled:bg-ds-border-strong disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.2} />}
        </button>
      </div>
    </div>
  )
}

import type { ReactElement } from 'react'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  activeTitle?: string
  disabled?: boolean
}

/** Bottom-floating composer for the HTML design canvas (Stitch-style). */
export function DesignAgentPanel({
  value,
  onChange,
  onSubmit,
  activeTitle,
  disabled = false
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const busy = useChatStore((s) => s.busy)
  const runtimeReady = useChatStore((s) => s.runtimeConnection === 'ready')

  const blocked = busy || !runtimeReady
  const canSend = value.trim().length > 0 && !disabled && !blocked
  const submit = (): void => {
    if (canSend) onSubmit(value.trim())
  }
  const label = busy
    ? t('designAgentBusy')
    : activeTitle
      ? t('designComposerIterate', { title: activeTitle })
      : t('designComposerNew')

  return (
    <div
      className="ds-no-drag pointer-events-auto w-[min(640px,calc(100%-2rem))] rounded-2xl border border-[var(--ds-sidebar-row-ring)] bg-white p-2.5 shadow-[0_18px_40px_rgba(20,47,95,0.18)] dark:bg-[#1f242c]"
      role="form"
      aria-label={t('designAgentTitle')}
    >
      <div className="mb-1 px-1 text-[11px] text-[#8b95a3] dark:text-white/45">
        {label}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          data-design-composer-textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={t('designAgentComposerPlaceholder')}
          className="min-h-[44px] flex-1 resize-none rounded-lg bg-transparent px-2.5 py-1.5 text-[13.5px] leading-snug text-[#1f2733] outline-none placeholder:text-[#9aa4b2] dark:text-white/90 dark:placeholder:text-white/30"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label={t('designAgentSend')}
          title={t('designAgentSend')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3b82d8] text-white transition-colors hover:bg-[#3577c4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </div>
    </div>
  )
}

import type { ReactElement } from 'react'
import { Send, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DESIGN_SYSTEM_PRESETS, type DesignSystemPreset } from '@shared/app-settings'
import { useChatStore } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { DESIGN_SYSTEM_DISPLAY, DESIGN_TONE_OPTIONS } from '../../design/design-context'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onOpenSettings?: () => void
}

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#8b95a3] dark:text-white/45'
const fieldInput =
  'w-full rounded-md border border-[var(--ds-sidebar-row-ring)] bg-transparent px-2 py-1 text-[13px] text-[#1f2733] outline-none focus-visible:border-[#3b82d8] dark:text-white/85'

function chipClass(active: boolean): string {
  return `rounded-full px-2.5 py-1 text-[12px] transition-colors ${
    active
      ? 'bg-[#3b82d8] text-white'
      : 'bg-black/[0.05] text-[#646e7c] hover:text-[#1f2733] dark:bg-white/[0.06] dark:text-white/55 dark:hover:text-white/85'
  }`
}

/**
 * Design-agent composer: the design-context form (brand color / tone /
 * design-system preset) feeds buildDesignTurnPrompt; the textarea brief is
 * dispatched via onSubmit (wired to sendDesignTurn in Workbench).
 */
export function DesignAgentPanel({ value, onChange, onSubmit, onOpenSettings }: Props): ReactElement {
  const { t } = useTranslation('common')
  const busy = useChatStore((s) => s.busy)
  const runtimeReady = useChatStore((s) => s.runtimeConnection === 'ready')
  const designContext = useDesignWorkspaceStore((s) => s.designContext)
  const updateDesignContext = useDesignWorkspaceStore((s) => s.updateDesignContext)

  const canSend = value.trim().length > 0 && !busy && runtimeReady
  const submit = (): void => {
    if (canSend) onSubmit(value.trim())
  }
  const toggleTone = (tone: string): void => {
    const current = designContext.tone ?? []
    updateDesignContext({
      tone: current.includes(tone) ? current.filter((item) => item !== tone) : [...current, tone]
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-sidebar">
      <div className="flex shrink-0 items-center justify-between px-3 py-2.5 shadow-[inset_0_-1px_0_var(--ds-sidebar-row-ring)]">
        <span className="text-[13px] font-medium text-[#1f2733] dark:text-white">{t('designAgentTitle')}</span>
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="ds-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8b95a3] transition-colors hover:text-[#1f2733] dark:text-white/45 dark:hover:text-white/85"
            aria-label={t('settings')}
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.9} />
          </button>
        ) : null}
      </div>

      <div className="shrink-0 space-y-3 px-3 py-3">
        <label className="block">
          <span className={fieldLabel}>{t('designAgentBrandColor')}</span>
          <input
            type="text"
            value={designContext.brandColor ?? ''}
            onChange={(e) => updateDesignContext({ brandColor: e.target.value })}
            placeholder="#3b82d8"
            className={fieldInput}
          />
        </label>
        <div>
          <span className={fieldLabel}>{t('designAgentTone')}</span>
          <div className="flex flex-wrap gap-1">
            {DESIGN_TONE_OPTIONS.map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => toggleTone(tone)}
                className={chipClass((designContext.tone ?? []).includes(tone))}
              >
                {tone}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={fieldLabel}>{t('designAgentSystem')}</span>
          <select
            value={designContext.designSystemPreset ?? 'none'}
            onChange={(e) => updateDesignContext({ designSystemPreset: e.target.value as DesignSystemPreset })}
            className={fieldInput}
          >
            {DESIGN_SYSTEM_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset === 'none' ? t('designSystem_none') : DESIGN_SYSTEM_DISPLAY[preset]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-auto shrink-0 px-3 pb-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={4}
          placeholder={t('designAgentComposerPlaceholder')}
          className="w-full resize-none rounded-lg border border-[var(--ds-sidebar-row-ring)] bg-transparent px-3 py-2 text-[13px] text-[#1f2733] outline-none focus-visible:border-[#3b82d8] dark:text-white/85"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#3b82d8] px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#3577c4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" strokeWidth={1.9} />
          {t('designAgentSend')}
        </button>
      </div>
    </div>
  )
}

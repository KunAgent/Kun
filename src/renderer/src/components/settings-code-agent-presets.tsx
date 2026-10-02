import { settingsButtonClass } from './settings-button'
import { useState, type ReactElement } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  CODE_AGENT_PERSONA_MAX_CHARS,
  CODE_AGENT_PRESET_FALLBACK_ICON,
  CODE_AGENT_PRESET_MAX_COUNT,
  CODE_AGENT_PRESET_NAME_MAX_CHARS,
  type CodeAgentPresetV1
} from '@shared/app-settings'
import { resolveCodeAgentPreset } from './chat/code-agent-presets'
import { LucideIconByName } from './lucide-icon-by-name'
import { LucideIconPicker } from './LucideIconPicker'

type Props = {
  presets: CodeAgentPresetV1[]
  onChange: (next: CodeAgentPresetV1[]) => void
}

/**
 * Persona catalog editor: one collapsed row per persona (icon, name, preview),
 * expanding in place to edit. Only one row is open at a time, so the section
 * stays a compact list no matter how many personas exist.
 */
export function CodeAgentPresetsEditor({ presets, onChange }: Props): ReactElement {
  const { t } = useTranslation('settings')
  const [openId, setOpenId] = useState<string | null>(null)

  const patch = (index: number, partial: Partial<CodeAgentPresetV1>): void => {
    const next = [...presets]
    next[index] = { ...next[index], ...partial }
    onChange(next)
  }

  const addPersona = (): void => {
    const id = `custom-${Date.now().toString(36)}`
    onChange([...presets, { id, name: '', icon: CODE_AGENT_PRESET_FALLBACK_ICON, persona: '' }])
    setOpenId(id)
  }

  return (
    <div className="w-full divide-y divide-ds-border-muted overflow-hidden rounded-2xl border border-ds-border-muted bg-ds-card/60">
      {presets.map((preset, index) => {
        const resolved = resolveCodeAgentPreset(preset)
        const open = openId === preset.id
        return (
          <div key={preset.id}>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : preset.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpenId(open ? null : preset.id)
                }
              }}
              className="group flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-ds-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent/35"
            >
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ds-hover/70 text-ds-ink">
                <LucideIconByName name={resolved.icon} className="h-3.5 w-3.5" strokeWidth={1.8} />
              </span>
              <span className="shrink-0 text-[13px] font-medium text-ds-ink">{resolved.name}</span>
              {!open ? (
                <span className="min-w-0 flex-1 truncate text-[12px] text-ds-faint">
                  {resolved.persona}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <button
                type="button"
                title={t('codeAgentPresetRemove')}
                aria-label={t('codeAgentPresetRemove')}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(presets.filter((item) => item.id !== preset.id))
                }}
                  className={settingsButtonClass({ variant: 'danger-ghost', size: 'icon', className: 'shrink-0' })}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform ${open ? 'rotate-180' : ''}`}
                strokeWidth={1.9}
              />
            </div>
            {open ? (
              <div className="space-y-2 px-3.5 pb-3.5 pt-0.5">
                <div className="flex items-center gap-2">
                  <LucideIconPicker
                    settingsSurface
                    value={preset.icon}
                    ariaLabel={resolved.name}
                    onChange={(iconName) => patch(index, { icon: iconName })}
                  />
                  <input
                    className="min-w-0 max-w-[240px] flex-1 rounded-lg border border-ds-border bg-ds-main/60 px-3 py-2 text-[13px] text-ds-ink outline-none transition-colors focus:border-accent/40"
                    value={preset.name || (resolved.builtin ? resolved.name : '')}
                    maxLength={CODE_AGENT_PRESET_NAME_MAX_CHARS}
                    placeholder={t('codeAgentPresetNamePlaceholder')}
                    spellCheck={false}
                    onChange={(e) => patch(index, { name: e.target.value })}
                  />
                </div>
                <textarea
                  className="min-h-[88px] w-full resize-y rounded-lg border border-ds-border bg-ds-main/60 px-3 py-2 text-[13px] leading-5 text-ds-ink outline-none transition-colors focus:border-accent/40"
                  value={preset.persona || (resolved.builtin ? resolved.persona : '')}
                  maxLength={CODE_AGENT_PERSONA_MAX_CHARS}
                  placeholder={t('codeAgentPersonaPlaceholder')}
                  spellCheck={false}
                  onChange={(e) => patch(index, { persona: e.target.value })}
                />
              </div>
            ) : null}
          </div>
        )
      })}
      <button
        type="button"
        disabled={presets.length >= CODE_AGENT_PRESET_MAX_COUNT}
        onClick={addPersona}
        className={settingsButtonClass({ className: 'w-full' })}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        {t('codeAgentPresetAdd')}
      </button>
    </div>
  )
}

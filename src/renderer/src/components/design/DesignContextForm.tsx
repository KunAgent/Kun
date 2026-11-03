import { useState, type ReactElement } from 'react'
import { Check, ChevronDown, FileInput, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DESIGN_SYSTEM_PRESETS, type DesignSystemPreset } from '@shared/app-settings'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import {
  DESIGN_SYSTEM_DISPLAY,
  DESIGN_TONE_OPTIONS,
  type DesignContext
} from '../../design/design-context'
import { importStitchDesignMarkdown, STITCH_DESIGN_MD_PATH } from '../../design/design-md-compat'
import { LEGACY_PROJECT_DESIGN_SYSTEM_PATH } from '../../design/design-md/design-md-paths'
import { acceptLegacyDesignSystemMigration, createLegacyDesignSystemMigrationDraft } from '../../design/design-md/design-md-legacy-migration'
import { useDesignSystemStore } from '../../design/canvas/design-system-store'
import { DesignTargetToggle } from './DesignTargetToggle'
import {
  TWEAKS_FIELD,
  TWEAKS_ICON_BUTTON,
  TweaksRow,
  TweaksSection
} from './canvas/tweaks/tweaks-controls'

type Props = {
  onOpenSettings?: () => void
  designTargetDisabled?: boolean
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function swatchValue(color?: string): string {
  return color && HEX_RE.test(color) ? color : '#3b82d8'
}

function toneChipClass(active: boolean): string {
  return `inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] transition ${
    active
      ? 'border-accent-tint/40 bg-accent-tint/15 font-medium text-accent'
      : 'border-ds-border bg-ds-main text-ds-muted hover:bg-ds-hover hover:text-ds-ink dark:border-white/10'
  }`
}

export function designContextPatchForTargetLock(
  patch: Partial<DesignContext>,
  designTargetLocked: boolean
): Partial<DesignContext> {
  if (!designTargetLocked || !patch.designTarget) return patch
  const nextPatch = { ...patch }
  delete nextPatch.designTarget
  return nextPatch
}

/** Design context the agent draws with (target / brand color / tone / system), as Tweaks rows. */
export function DesignContextForm({
  onOpenSettings,
  designTargetDisabled = false
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const designContext = useDesignWorkspaceStore((s) => s.designContext)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const setDesignTarget = useDesignWorkspaceStore((s) => s.setDesignTarget)
  const updateDesignContext = useDesignWorkspaceStore((s) => s.updateDesignContext)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const [importing, setImporting] = useState(false)

  const toggleTone = (tone: string): void => {
    const current = designContext.tone ?? []
    updateDesignContext({
      tone: current.includes(tone) ? current.filter((item) => item !== tone) : [...current, tone]
    })
  }

  const importDesignMd = (): void => {
    if (importing) return
    if (!workspaceRoot || typeof window.kunGui?.readWorkspaceFile !== 'function') {
      setFileError(t('designImportDesignMdUnavailable'))
      return
    }
    setImporting(true)
    setFileError(null)
    void window.kunGui
      .readWorkspaceFile({ path: STITCH_DESIGN_MD_PATH, workspaceRoot })
      .then((res) => {
        if (!res.ok) {
          return window.kunGui.readWorkspaceFile({ path: LEGACY_PROJECT_DESIGN_SYSTEM_PATH, workspaceRoot }).then(async (legacy) => {
            const migration = legacy.ok ? createLegacyDesignSystemMigrationDraft(legacy.content) : null
            if (!legacy.ok || !migration) {
              setFileError(res.message || t('designImportDesignMdFailed'))
              return
            }
            if (!window.confirm(t('designMigrateLegacyConfirm', { count: migration.tokenCount }))) return
            const accepted = await acceptLegacyDesignSystemMigration(workspaceRoot, legacy.content)
            if (!accepted) {
              setFileError(t('designMigrateLegacyFailed'))
              return
            }
            setFileError(null)
          })
        }
        const imported = importStitchDesignMarkdown(res.content)
        if (!imported) {
          setFileError(t('designImportDesignMdFailed'))
          return
        }
        updateDesignContext(designContextPatchForTargetLock(imported.contextPatch, designTargetDisabled))
        for (const token of imported.tokens) {
          useDesignSystemStore.getState().setToken(token)
        }
        setFileError(null)
      })
      .catch((error: unknown) => {
        setFileError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setImporting(false))
  }

  const brandColor = designContext.brandColor ?? ''
  const tones = designContext.tone ?? []
  return (
    <TweaksSection
      title={t('designContextLabel')}
      actions={(
        <>
          <button
            type="button"
            onClick={importDesignMd}
            disabled={importing}
            title={t('designImportDesignMd')}
            aria-label={t('designImportDesignMd')}
            className={TWEAKS_ICON_BUTTON}
          >
            <FileInput className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          {onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              title={t('settings')}
              aria-label={t('settings')}
              className={TWEAKS_ICON_BUTTON}
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          ) : null}
        </>
      )}
    >
      <TweaksRow label={t('designTarget')}>
        <DesignTargetToggle
          variant="segmented"
          designTarget={designTarget}
          disabled={designTargetDisabled}
          disabledReason={designTargetDisabled ? t('designTargetLockedHint') : undefined}
          onChange={setDesignTarget}
        />
      </TweaksRow>
      <TweaksRow label={t('designAgentBrandColor')}>
        <div className={`${TWEAKS_FIELD} flex items-center gap-2 pl-1.5 pr-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-tint/25`}>
          <label
            className="relative h-5 w-5 shrink-0 cursor-pointer overflow-hidden rounded-[6px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)]"
            style={{ backgroundColor: swatchValue(brandColor) }}
          >
            <input
              type="color"
              value={swatchValue(brandColor)}
              onChange={(e) => updateDesignContext({ brandColor: e.target.value })}
              aria-label={t('designAgentBrandColor')}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <input
            type="text"
            value={brandColor}
            onChange={(e) => updateDesignContext({ brandColor: e.target.value })}
            placeholder="#3b82d8"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] uppercase text-ds-ink outline-none placeholder:normal-case placeholder:text-ds-faint"
          />
        </div>
      </TweaksRow>
      <TweaksRow label={t('designAgentTone')} alignTop>
        <div className="flex flex-wrap gap-1.5">
          {DESIGN_TONE_OPTIONS.map((tone) => {
            const active = tones.includes(tone)
            return (
              <button
                key={tone}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTone(tone)}
                className={toneChipClass(active)}
              >
                {active ? <Check className="h-3 w-3" strokeWidth={2.4} /> : null}
                {tone}
              </button>
            )
          })}
        </div>
      </TweaksRow>
      <TweaksRow label={t('designAgentSystem')}>
        <div className="relative">
          <select
            value={designContext.designSystemPreset ?? 'none'}
            onChange={(e) =>
              updateDesignContext({ designSystemPreset: e.target.value as DesignSystemPreset })
            }
            aria-label={t('designAgentSystem')}
            className={`${TWEAKS_FIELD} cursor-pointer appearance-none pl-2.5 pr-8`}
          >
            {DESIGN_SYSTEM_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset === 'none' ? t('designSystem_none') : DESIGN_SYSTEM_DISPLAY[preset]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-muted"
            strokeWidth={1.9}
          />
        </div>
      </TweaksRow>
    </TweaksSection>
  )
}

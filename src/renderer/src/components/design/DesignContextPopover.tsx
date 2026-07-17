import { useEffect, useRef, useState, type ReactElement } from 'react'
import { FileInput, Settings2, X } from 'lucide-react'
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
import { DesignContextPanel } from './DesignContextPanel'

type Props = {
  open: boolean
  onClose: () => void
  onOpenSettings?: () => void
  titleKey?: string
  designTargetDisabled?: boolean
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function swatchValue(color?: string): string {
  return color && HEX_RE.test(color) ? color : '#3b82d8'
}

function chipClass(active: boolean): string {
  return `rounded-full px-2.5 py-1 text-[12px] transition-colors ${
    active
      ? 'bg-[#3b82d8] text-white'
      : 'bg-black/[0.05] text-[#646e7c] hover:text-[#1f2733] dark:bg-white/[0.06] dark:text-white/55 dark:hover:text-white/85'
  }`
}

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#8b95a3] dark:text-white/45'
const fieldInput =
  'w-full rounded-md border border-[var(--ds-sidebar-row-ring)] bg-transparent px-2 py-1 text-[13px] text-[#1f2733] outline-none focus-visible:border-[#3b82d8] dark:text-white/85'

export function designContextPatchForTargetLock(
  patch: Partial<DesignContext>,
  designTargetLocked: boolean
): Partial<DesignContext> {
  if (!designTargetLocked || !patch.designTarget) return patch
  const nextPatch = { ...patch }
  delete nextPatch.designTarget
  return nextPatch
}

/**
 * Popover surface for the design-context form (brand color / tone / system).
 * Replaces the permanent right-column form so the canvas can claim the full
 * width — opened from a gear icon in the canvas toolbar.
 */
export function DesignContextPopover({
  open,
  onClose,
  onOpenSettings,
  titleKey = 'designContextLabel',
  designTargetDisabled = false
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const designContext = useDesignWorkspaceStore((s) => s.designContext)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const setDesignTarget = useDesignWorkspaceStore((s) => s.setDesignTarget)
  const updateDesignContext = useDesignWorkspaceStore((s) => s.updateDesignContext)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [importing, setImporting] = useState(false)
  const [section, setSection] = useState<'context' | 'system'>('context')

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

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
            onClose()
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
        onClose()
      })
      .catch((error: unknown) => {
        setFileError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setImporting(false))
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t(titleKey)}
      className={`ds-no-drag rounded-2xl border border-[var(--ds-sidebar-row-ring)] bg-white p-3.5 text-[#1f2733] shadow-[0_14px_34px_rgba(20,47,95,0.16)] dark:bg-[#1f242c] dark:text-white ${section === 'system' ? 'w-[min(560px,calc(100vw-32px))]' : 'w-[300px]'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="tablist" aria-label={t(titleKey)}>
          <button type="button" role="tab" aria-selected={section === 'context'} onClick={() => setSection('context')} className={`rounded-md px-2 py-1 text-[12px] ${section === 'context' ? 'bg-black/[0.05] font-medium dark:bg-white/[0.07]' : 'text-[#8b95a3]'}`}>设计上下文</button>
          <button type="button" role="tab" aria-selected={section === 'system'} onClick={() => setSection('system')} className={`rounded-md px-2 py-1 text-[12px] ${section === 'system' ? 'bg-black/[0.05] font-medium dark:bg-white/[0.07]' : 'text-[#8b95a3]'}`}>设计系统</button>
        </div>
        <div className="flex items-center gap-0.5">
          {section === 'context' ? <button
            type="button"
            onClick={importDesignMd}
            disabled={importing}
            title={t('designImportDesignMd')}
            aria-label={t('designImportDesignMd')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#8b95a3] transition-colors hover:text-[#1f2733] disabled:cursor-not-allowed disabled:opacity-45 dark:text-white/45 dark:hover:text-white/85"
          >
            <FileInput className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button> : null}
          {section === 'context' && onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              title={t('settings')}
              aria-label={t('settings')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#8b95a3] transition-colors hover:text-[#1f2733] dark:text-white/45 dark:hover:text-white/85"
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            title={t('close')}
            aria-label={t('close')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#8b95a3] transition-colors hover:text-[#1f2733] dark:text-white/45 dark:hover:text-white/85"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {section === 'system' ? <DesignContextPanel workspaceRoot={workspaceRoot} /> : <div className="space-y-3">
        <div>
          <span className={fieldLabel}>{t('designTargetHint')}</span>
          <DesignTargetToggle
            designTarget={designTarget}
            disabled={designTargetDisabled}
            disabledReason={designTargetDisabled ? t('designTargetLockedHint') : undefined}
            onChange={setDesignTarget}
          />
        </div>
        <label className="block">
          <span className={fieldLabel}>{t('designAgentBrandColor')}</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={swatchValue(designContext.brandColor)}
              onChange={(e) => updateDesignContext({ brandColor: e.target.value })}
              aria-label={t('designAgentBrandColor')}
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-[var(--ds-sidebar-row-ring)] bg-transparent p-0.5"
            />
            <input
              type="text"
              value={designContext.brandColor ?? ''}
              onChange={(e) => updateDesignContext({ brandColor: e.target.value })}
              placeholder="#3b82d8"
              className={fieldInput}
            />
          </div>
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
            onChange={(e) =>
              updateDesignContext({ designSystemPreset: e.target.value as DesignSystemPreset })
            }
            className={fieldInput}
          >
            {DESIGN_SYSTEM_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset === 'none' ? t('designSystem_none') : DESIGN_SYSTEM_DISPLAY[preset]}
              </option>
            ))}
          </select>
        </label>
      </div>}
    </div>
  )
}

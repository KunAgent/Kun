import type { ReactElement } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { defaultWritePaperReadingSettings, type WritePaperReadingSettingsV1 } from '@shared/app-settings'
import { defaultWritePaperModeSettings } from '@shared/app-settings-paper-mode'
import type {
  WritePaperModeSettingsPatchV1,
  WritePaperModeSettingsV1
} from '@shared/app-settings-types-paper-mode'
import { DEFAULT_PAPER_INTERPRET_TEMPLATE } from '@shared/paper/paper-interpret-template'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'

const textInputClass =
  'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent-tint/40 focus:outline-none focus:ring-1 focus:ring-accent-tint/30'
const selectControlClass =
  'rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent-tint/40 focus:outline-none focus:ring-1 focus:ring-accent-tint/30'
const ghostButtonClass =
  'inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover'

/**
 * Write settings → paper reading tab (§6.7): papers directory, interpretation
 * template + language, auto-preprocess, Cool notes toggle.
 */
export function WritePaperReadingSettingsPanel({
  form,
  update
}: {
  form: {
    write: {
      paperReading?: Partial<WritePaperReadingSettingsV1>
      paperMode?: Partial<WritePaperModeSettingsV1>
    }
  }
  update: (patch: {
    write: {
      paperReading?: Partial<WritePaperReadingSettingsV1>
      paperMode?: WritePaperModeSettingsPatchV1
    }
  }) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const defaults = defaultWritePaperReadingSettings()
  const paper = { ...defaults, ...(form.write.paperReading ?? {}) }
  const modeDefaults = defaultWritePaperModeSettings()
  const mode = {
    ...modeDefaults,
    ...(form.write.paperMode ?? {}),
    translate: { ...modeDefaults.translate, ...(form.write.paperMode?.translate ?? {}) },
    discover: { ...modeDefaults.discover, ...(form.write.paperMode?.discover ?? {}) },
    scholar: { ...modeDefaults.scholar, ...(form.write.paperMode?.scholar ?? {}) }
  }
  const updateMode = (paperMode: WritePaperModeSettingsPatchV1): void =>
    update({ write: { paperMode } })

  return (
    <>
    <SettingsCard title={t('writePaperModeSettingsTitle')}>
      <SettingRow
        title={t('writePaperAutoMarkReading')}
        description={t('writePaperAutoMarkReadingDesc')}
        control={
          <Toggle
            checked={mode.autoMarkReading !== false}
            onChange={(autoMarkReading) => updateMode({ autoMarkReading })}
          />
        }
      />
      <SettingRow
        title={t('writePaperTranslateTarget')}
        description={t('writePaperTranslateTargetDesc')}
        control={
          <select
            className={selectControlClass}
            value={mode.translate.targetLanguage}
            onChange={(e) =>
              updateMode({
                translate: {
                  targetLanguage: e.target.value as WritePaperModeSettingsV1['translate']['targetLanguage']
                }
              })
            }
          >
            <option value="zh">{t('writePaperLanguageZh')}</option>
            <option value="en">{t('writePaperLanguageEn')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('writePaperTranslateInherit')}
        description={t('writePaperTranslateInheritDesc')}
        control={
          <Toggle
            checked={mode.translate.inheritModel !== false}
            onChange={(inheritModel) => updateMode({ translate: { inheritModel } })}
          />
        }
      />
      <SettingRow
        title={t('writePaperAutoTranslateSelection')}
        description={t('writePaperAutoTranslateSelectionDesc')}
        control={
          <Toggle
            checked={mode.translate.autoTranslateSelection === true}
            onChange={(autoTranslateSelection) => {
              updateMode({ translate: { autoTranslateSelection } })
              // Mirror into the live workspace store like paperTone does so
              // the reader picks it up without a settings reload.
              useWriteWorkspaceStore.setState((s) => ({
                paperMode: {
                  ...s.paperMode,
                  translate: { ...s.paperMode.translate, autoTranslateSelection }
                }
              }))
            }}
          />
        }
      />
      {!mode.translate.inheritModel ? (
        <SettingRow
          title={t('writePaperTranslateModel')}
          description={t('writePaperTranslateModelDesc')}
          control={
            <div className="flex gap-2">
              <input
                className={`${textInputClass} w-36`}
                value={mode.translate.providerId}
                placeholder="provider"
                spellCheck={false}
                onChange={(e) => updateMode({ translate: { providerId: e.target.value } })}
              />
              <input
                className={`${textInputClass} w-44`}
                value={mode.translate.model}
                placeholder="model"
                spellCheck={false}
                onChange={(e) => updateMode({ translate: { model: e.target.value } })}
              />
            </div>
          }
        />
      ) : null}
      <SettingRow
        title={t('writePaperArxivCategories')}
        description={t('writePaperArxivCategoriesDesc')}
        control={
          <input
            className={`${textInputClass} w-56`}
            value={mode.discover.arxivCategories.join(', ')}
            placeholder="cs.AI, cs.CL"
            spellCheck={false}
            onChange={(e) =>
              updateMode({
                discover: {
                  arxivCategories: e.target.value
                    .split(/[,\s]+/)
                    .map((item) => item.trim())
                    .filter(Boolean)
                }
              })
            }
          />
        }
      />
      <SettingRow
        title={t('writePaperOnlineRefs')}
        description={t('writePaperOnlineRefsDesc')}
        control={
          <Toggle
            checked={mode.scholar.onlineReferences !== false}
            onChange={(onlineReferences) => updateMode({ scholar: { onlineReferences } })}
          />
        }
      />
      <SettingRow
        title={t('writePaperScholarKey')}
        description={t('writePaperScholarKeyDesc')}
        control={
          <input
            className={`${textInputClass} w-56`}
            value={mode.scholar.semanticScholarApiKey}
            placeholder={t('writePaperOptional')}
            spellCheck={false}
            onChange={(e) => updateMode({ scholar: { semanticScholarApiKey: e.target.value } })}
          />
        }
      />
      <SettingRow
        title={t('writePaperCrossrefMailto')}
        description={t('writePaperCrossrefMailtoDesc')}
        control={
          <input
            className={`${textInputClass} w-56`}
            value={mode.scholar.crossrefMailto}
            placeholder={t('writePaperOptional')}
            spellCheck={false}
            onChange={(e) => updateMode({ scholar: { crossrefMailto: e.target.value } })}
          />
        }
      />
    </SettingsCard>
    <SettingsCard title={t('writePaperSettingsTitle')}>
      <SettingRow
        title={t('writePaperDirLabel')}
        description={t('writePaperDirDesc')}
        control={
          <input
            className={`${textInputClass} w-48`}
            value={paper.papersDir}
            placeholder={defaults.papersDir}
            spellCheck={false}
            onChange={(e) => update({ write: { paperReading: { papersDir: e.target.value } } })}
          />
        }
      />
      <SettingRow
        title={t('writePaperLanguageLabel')}
        description={t('writePaperLanguageDesc')}
        control={
          <select
            className={selectControlClass}
            value={paper.outputLanguage}
            onChange={(e) =>
              update({
                write: {
                  paperReading: {
                    outputLanguage: e.target.value as WritePaperReadingSettingsV1['outputLanguage']
                  }
                }
              })
            }
          >
            <option value="zh">{t('writePaperLanguageZh')}</option>
            <option value="en">{t('writePaperLanguageEn')}</option>
            <option value="auto">{t('writePaperLanguageAuto')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('writePaperAutoPreprocess')}
        description={t('writePaperAutoPreprocessDesc')}
        control={
          <Toggle
            checked={paper.autoPreprocess !== false}
            onChange={(autoPreprocess) => update({ write: { paperReading: { autoPreprocess } } })}
          />
        }
      />
      <SettingRow
        title={t('writePaperCoolEnabled')}
        description={t('writePaperCoolEnabledDesc')}
        control={
          <Toggle
            checked={paper.coolNotesEnabled !== false}
            onChange={(coolNotesEnabled) => update({ write: { paperReading: { coolNotesEnabled } } })}
          />
        }
      />
      <div className="pt-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-ds-ink">
            {t('writePaperTemplateLabel')}
          </div>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => update({ write: { paperReading: { interpretTemplate: '' } } })}
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
            {t('writePaperTemplateReset')}
          </button>
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
          {t('writePaperTemplateDesc')}
        </p>
        <textarea
          className={`${textInputClass} mt-2 min-h-[160px] resize-y font-mono text-[12.5px] leading-5`}
          value={paper.interpretTemplate}
          placeholder={DEFAULT_PAPER_INTERPRET_TEMPLATE}
          spellCheck={false}
          onChange={(e) => update({ write: { paperReading: { interpretTemplate: e.target.value } } })}
        />
      </div>
    </SettingsCard>
    </>
  )
}

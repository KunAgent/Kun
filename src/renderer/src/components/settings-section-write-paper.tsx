import type { ReactElement } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { defaultWritePaperReadingSettings, type WritePaperReadingSettingsV1 } from '@shared/app-settings'
import { DEFAULT_PAPER_INTERPRET_TEMPLATE } from '@shared/paper/paper-interpret-template'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'

const textInputClass =
  'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const selectControlClass =
  'rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
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
  form: { write: { paperReading?: Partial<WritePaperReadingSettingsV1> } }
  update: (patch: { write: { paperReading: Partial<WritePaperReadingSettingsV1> } }) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const defaults = defaultWritePaperReadingSettings()
  const paper = { ...defaults, ...(form.write.paperReading ?? {}) }

  return (
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
  )
}

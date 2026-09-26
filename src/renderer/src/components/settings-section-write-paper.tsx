import { useState, type ReactElement } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { defaultWritePaperReadingSettings, type WritePaperReadingSettingsV1 } from '@shared/app-settings'
import { defaultWritePaperModeSettings } from '@shared/app-settings-paper-mode'
import type {
  WritePaperModeSearchSettingsV1,
  WritePaperModeSettingsPatchV1,
  WritePaperModeSettingsV1
} from '@shared/app-settings-types-paper-mode'
import { DEFAULT_PAPER_INTERPRET_TEMPLATE } from '@shared/paper/paper-interpret-template'
import {
  PAPER_SEARCH_KEY_GATED_SOURCES,
  PAPER_SEARCH_SOURCES,
  type PaperSearchSource
} from '@shared/paper/paper-search'
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
    scholar: { ...modeDefaults.scholar, ...(form.write.paperMode?.scholar ?? {}) },
    search: { ...modeDefaults.search, ...(form.write.paperMode?.search ?? {}) }
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
    <PaperSearchSettingsCard mode={mode.search} update={updateMode} />
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

/**
 * Paper search card (plan P2.2): per-source toggles, optional credentials and
 * a "test connection" probe. Keys are write-only in the renderer projection —
 * `*Configured` flags drive the masked placeholder instead of the secret.
 */
function PaperSearchSettingsCard({
  mode,
  update
}: {
  mode: WritePaperModeSearchSettingsV1
  update: (patch: WritePaperModeSettingsPatchV1) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [testSource, setTestSource] = useState<PaperSearchSource>('arxiv')
  const [testState, setTestState] = useState<{ running: boolean; text?: string; failed?: boolean }>({
    running: false
  })

  const updateSearch = (search: Partial<WritePaperModeSearchSettingsV1>): void =>
    update({ search })

  const toggleSource = (source: PaperSearchSource): void => {
    const next = mode.enabledSources.includes(source)
      ? mode.enabledSources.filter((value) => value !== source)
      : PAPER_SEARCH_SOURCES.filter(
          (value) => value === source || mode.enabledSources.includes(value)
        )
    // An empty list normalizes back to defaults — keep at least one on.
    if (!next.length) return
    updateSearch({ enabledSources: next })
  }

  const runTest = (): void => {
    if (testState.running || typeof window.kunGui?.paperTestSource !== 'function') return
    setTestState({ running: true })
    void window.kunGui
      .paperTestSource({ source: testSource })
      .then((result) =>
        setTestState({
          running: false,
          failed: !result.ok,
          text: result.ok
            ? t('writePaperSearchTestOk', { count: result.count, ms: result.ms })
            : t('writePaperSearchTestFail', { error: result.error })
        })
      )
      .catch((error: unknown) =>
        setTestState({
          running: false,
          failed: true,
          text: error instanceof Error ? error.message : String(error)
        })
      )
  }

  const coreMissingKey =
    PAPER_SEARCH_KEY_GATED_SOURCES.length > 0 &&
    !mode.coreApiKey.trim() &&
    !mode.coreApiKeyConfigured

  return (
    <SettingsCard title={t('writePaperSearchSettingsTitle')}>
      <SettingRow
        title={t('writePaperSearchSettingsSources')}
        description={t('writePaperSearchSettingsSourcesDesc')}
        wideControl
        control={
          <div className="flex flex-wrap gap-1.5">
            {PAPER_SEARCH_SOURCES.map((source) => {
              const active = mode.enabledSources.includes(source)
              const gated =
                PAPER_SEARCH_KEY_GATED_SOURCES.includes(source) && coreMissingKey
              return (
                <button
                  key={source}
                  type="button"
                  aria-pressed={active}
                  title={gated ? t('writePaperSearchKeyGated') : undefined}
                  onClick={() => toggleSource(source)}
                  className={`h-7 rounded-md border px-2.5 text-[12px] transition ${
                    active
                      ? 'border-transparent bg-[var(--ds-sidebar-row-active)] font-medium text-ds-ink'
                      : 'border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  {t(`writePaperSearchSource_${source}`)}
                  {gated ? ' *' : ''}
                </button>
              )
            })}
          </div>
        }
      />
      <SettingRow
        title={t('writePaperSearchSettingsScholarKey')}
        description={t('writePaperSearchSettingsScholarKeyDesc')}
        control={
          <input
            className={`${textInputClass} w-56`}
            type="password"
            autoComplete="off"
            value={mode.semanticScholarApiKey}
            placeholder={
              mode.semanticScholarApiKeyConfigured ? '••••••••••••' : t('writePaperOptional')
            }
            spellCheck={false}
            onChange={(e) => updateSearch({ semanticScholarApiKey: e.target.value })}
          />
        }
      />
      <SettingRow
        title={t('writePaperSearchSettingsCoreKey')}
        description={t('writePaperSearchSettingsCoreKeyDesc')}
        control={
          <input
            className={`${textInputClass} w-56`}
            type="password"
            autoComplete="off"
            value={mode.coreApiKey}
            placeholder={mode.coreApiKeyConfigured ? '••••••••••••' : t('writePaperOptional')}
            spellCheck={false}
            onChange={(e) => updateSearch({ coreApiKey: e.target.value })}
          />
        }
      />
      <SettingRow
        title={t('writePaperSearchSettingsOpenAlexMailto')}
        description={t('writePaperSearchSettingsOpenAlexMailtoDesc')}
        control={
          <input
            className={`${textInputClass} w-56`}
            value={mode.openAlexMailto}
            placeholder="you@example.com"
            spellCheck={false}
            onChange={(e) => updateSearch({ openAlexMailto: e.target.value })}
          />
        }
      />
      <SettingRow
        title={t('writePaperSearchSettingsUnpaywall')}
        description={t('writePaperSearchSettingsUnpaywallDesc')}
        control={
          <input
            className={`${textInputClass} w-56`}
            value={mode.unpaywallEmail}
            placeholder="you@example.com"
            spellCheck={false}
            onChange={(e) => updateSearch({ unpaywallEmail: e.target.value })}
          />
        }
      />
      <SettingRow
        title={t('writePaperSearchTest')}
        description={t('writePaperSearchTestDesc')}
        control={
          <div className="flex items-center gap-2">
            <select
              className={selectControlClass}
              value={testSource}
              onChange={(e) => setTestSource(e.target.value as PaperSearchSource)}
            >
              {PAPER_SEARCH_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {t(`writePaperSearchSource_${source}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={testState.running}
              onClick={runTest}
            >
              {testState.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('writePaperSearchTestRun')}
            </button>
            {testState.text ? (
              <span
                className={`text-[12px] ${testState.failed ? 'text-red-600 dark:text-red-300' : 'text-ds-faint'}`}
              >
                {testState.text}
              </span>
            ) : null}
          </div>
        }
      />
    </SettingsCard>
  )
}

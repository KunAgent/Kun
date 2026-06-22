import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_MODEL_PROVIDER_ID,
  WRITE_EDITOR_FONT_SIZE_MAX,
  WRITE_EDITOR_FONT_SIZE_MIN,
  WRITE_EDITOR_LINE_HEIGHT_MAX,
  WRITE_EDITOR_LINE_HEIGHT_MIN,
  WRITE_FONT_PRESETS,
  WRITE_AGENT_PRESET_MAX_COUNT,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  WRITE_QUICK_ACTION_MAX_COUNT,
  defaultModelProviderSettings,
  defaultWriteAgentPresets,
  defaultWriteSelectionAssistSettings,
  defaultWriteTypography,
  resolveWriteInlineCompletionProviderId,
  type WriteAgentPresetV1,
  type WriteFontPreset,
  type WriteQuickActionV1
} from '@shared/app-settings'
import { WRITE_DESIGN_DRAFT_DEFAULT_PROMPT, WRITE_INFOGRAPHIC_DEFAULT_PROMPT } from '@shared/write-infographic'
import { WRITE_PROTOTYPE_DEFAULT_PROMPT } from '@shared/write-prototype'
import { PencilLine, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { builtinWriteQuickActionDefaults } from '../write/quick-actions'
import {
  AdvancedSettingsDisclosure,
  ModelSelect,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'

const textInputClass =
  'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const ghostButtonClass =
  'inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover'

const WRITE_FONT_PRESET_LABEL_KEYS: Record<WriteFontPreset, string> = {
  system: 'writeFontSystem',
  sourceHanSans: 'writeFontSourceHanSans',
  yahei: 'writeFontYahei',
  pingfang: 'writeFontPingfang',
  simhei: 'writeFontSimhei',
  simsun: 'writeFontSimsun',
  kaiti: 'writeFontKaiti',
  custom: 'writeFontCustom'
}

export function writeInlineCompletionModelOptions(providerModels: readonly string[]): string[] {
  const scopedModels = providerModels
    .map((model) => model.trim())
    .filter(Boolean)
  return scopedModels.length > 0
    ? [...new Set(scopedModels)]
    : [...WRITE_INLINE_COMPLETION_MODEL_IDS]
}

export function WriteSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    provider,
    kun,
    update,
    selectControlClass,
    compactHomePath,
    expandHomePath,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineModelInherited,
    setWriteDebugModalOpen,
    loadWriteDebugEntries
  } = ctx
  const { t: tCommon } = useTranslation('common')
  const providerSettings = provider ?? defaultModelProviderSettings()
  const selectionAssist = form.write.selectionAssist ?? defaultWriteSelectionAssistSettings()
  const typography = form.write.typography ?? defaultWriteTypography()
  const agentPresets: WriteAgentPresetV1[] = form.write.agentPresets ?? defaultWriteAgentPresets()
  const updateAgentPresets = (next: WriteAgentPresetV1[]): void => {
    update({ write: { agentPresets: next } })
  }
  const updateQuickActions = (quickActions: WriteQuickActionV1[]): void => {
    update({ write: { selectionAssist: { quickActions } } })
  }
  const effectiveWriteProviderId = resolveWriteInlineCompletionProviderId(form)
  const effectiveWriteProvider =
    providerSettings.providers.find((item: { id: string }) => item.id === effectiveWriteProviderId) ??
    providerSettings.providers.find((item: { id: string }) => item.id === DEFAULT_MODEL_PROVIDER_ID) ??
    providerSettings.providers[0]
  const writeInlineProviderInherited = form.write.inlineCompletion.inheritProvider !== false
  const writeInlineProviderModels = effectiveWriteProvider?.models ?? []
  const writeInlineModelOptions = writeInlineCompletionModelOptions(writeInlineProviderModels)
  // 「默认」选项要展示继承链真正会选中的模型,而不是当前覆盖值:
  // 显式指定供应商时取其首个模型,否则跟随 AI 助手当前模型。
  const writeInlineInheritDefault =
    (!writeInlineProviderInherited && form.write.inlineCompletion.providerId?.trim()
      ? writeInlineProviderModels[0]
      : undefined)
    || (kun?.model?.trim() || DEFAULT_WRITE_INLINE_COMPLETION_MODEL)

  return (
            <>
              <SettingsCard title={t('sectionWrite')}>
                <SettingRow
                  title={t('writeWorkspaceRoot')}
                  description={t('writeWorkspaceRootDesc')}
                  control={
                    <div className="w-full min-w-[200px] md:max-w-xl">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={compactHomePath(form.write.defaultWorkspaceRoot)}
                          onChange={(e) => {
                            const workspaceRoot = expandHomePath(e.target.value)
                            update({
                              write: {
                                defaultWorkspaceRoot: workspaceRoot,
                                activeWorkspaceRoot: workspaceRoot,
                                workspaces: [workspaceRoot, ...form.write.workspaces]
                              }
                            })
                          }}
                          placeholder={t('writeWorkspaceRootPlaceholder')}
                        />
                        <button
                          type="button"
                          onClick={resetWriteWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('restoreWorkspaceDefault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickWriteWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {writeWorkspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {writeWorkspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('writeTypography')} className="mt-5">
                <SettingRow
                  title={t('writeFontPreset')}
                  description={t('writeFontPresetDesc')}
                  control={
                    <div className="w-full min-w-0 md:max-w-md">
                      <select
                        className={selectControlClass}
                        value={typography.fontPreset}
                        onChange={(e) =>
                          update({ write: { typography: { fontPreset: e.target.value as WriteFontPreset } } })
                        }
                      >
                        {WRITE_FONT_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {t(WRITE_FONT_PRESET_LABEL_KEYS[preset])}
                          </option>
                        ))}
                      </select>
                      {typography.fontPreset === 'custom' ? (
                        <input
                          className={`${textInputClass} mt-2`}
                          value={typography.customFontFamily}
                          onChange={(e) =>
                            update({ write: { typography: { customFontFamily: e.target.value } } })
                          }
                          placeholder={t('writeFontCustomPlaceholder')}
                        />
                      ) : null}
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeFontSize')}
                  description={t('writeFontSizeDesc', {
                    min: WRITE_EDITOR_FONT_SIZE_MIN,
                    max: WRITE_EDITOR_FONT_SIZE_MAX
                  })}
                  control={
                    <div className="flex w-full min-w-[200px] items-center gap-3 md:max-w-xs">
                      <input
                        type="range"
                        min={WRITE_EDITOR_FONT_SIZE_MIN}
                        max={WRITE_EDITOR_FONT_SIZE_MAX}
                        step={1}
                        value={typography.fontSizePx}
                        onChange={(e) =>
                          update({ write: { typography: { fontSizePx: Number(e.target.value) } } })
                        }
                        className="flex-1 accent-accent"
                        aria-label={t('writeFontSize')}
                      />
                      <span className="w-12 shrink-0 text-right text-[13px] tabular-nums text-ds-ink">
                        {typography.fontSizePx}px
                      </span>
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeLineHeight')}
                  description={t('writeLineHeightDesc')}
                  control={
                    <div className="flex w-full min-w-[200px] items-center gap-3 md:max-w-xs">
                      <input
                        type="range"
                        min={WRITE_EDITOR_LINE_HEIGHT_MIN}
                        max={WRITE_EDITOR_LINE_HEIGHT_MAX}
                        step={0.05}
                        value={typography.lineHeight}
                        onChange={(e) =>
                          update({ write: { typography: { lineHeight: Number(e.target.value) } } })
                        }
                        className="flex-1 accent-accent"
                        aria-label={t('writeLineHeight')}
                      />
                      <span className="w-12 shrink-0 text-right text-[13px] tabular-nums text-ds-ink">
                        {typography.lineHeight.toFixed(2)}
                      </span>
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeTypographyReset')}
                  description={t('writeTypographyResetDesc')}
                  control={
                    <button
                      type="button"
                      onClick={() => update({ write: { typography: defaultWriteTypography() } })}
                      className={ghostButtonClass}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t('writeTypographyResetButton')}
                    </button>
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('writeInlineCompletion')} className="mt-5">
                <SettingRow
                  title={t('writeInlineCompletionEnabled')}
                  description={t('writeInlineCompletionEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.enabled}
                      onChange={(enabled) => update({ write: { inlineCompletion: { enabled } } })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionProvider')}
                  description={t('writeInlineCompletionProviderDesc')}
                  control={
                    <div className="w-full min-w-0 md:max-w-md">
                      <select
                        className={selectControlClass}
                        value={writeInlineProviderInherited ? '' : form.write.inlineCompletion.providerId}
                        onChange={(e) => {
                          const providerId = e.target.value
                          update({
                            write: {
                              inlineCompletion: {
                                inheritProvider: !providerId,
                                providerId
                              }
                            }
                          })
                        }}
                      >
                        <option value="">
                          {t('writeInlineCompletionProviderInherit', {
                            value: effectiveWriteProvider?.name ?? t('modelProviderDefault')
                          })}
                        </option>
                        {providerSettings.providers.map((item: { id: string; name: string }) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionModel')}
                  description={t('writeInlineCompletionModelDesc')}
                  control={
                    <div className="w-full min-w-0 md:max-w-md">
                      <ModelSelect
                        value={writeInlineModelInherited ? '' : form.write.inlineCompletion.model}
                        options={writeInlineModelOptions}
                        defaultLabel={t('modelSelectDefaultOption', { model: writeInlineInheritDefault })}
                        allowCustom
                        customLabel={t('modelSelectCustomOption')}
                        customPlaceholder={t('modelSelectCustomPlaceholder')}
                        selectClassName={selectControlClass}
                        onChange={(value) => {
                          const model = value.trim()
                          update({
                            write: {
                              inlineCompletion: {
                                inheritModel: !model,
                                model: model || DEFAULT_WRITE_INLINE_COMPLETION_MODEL
                              }
                            }
                          })
                        }}
                      />
                    </div>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionRetrieval')}
                  description={t('writeInlineCompletionRetrievalDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.retrievalEnabled}
                      onChange={(retrievalEnabled) => update({ write: { inlineCompletion: { retrievalEnabled } } })}
                    />
                  }
                />
                <div className="px-3 py-4">
                  <AdvancedSettingsDisclosure
                    title={t('writeInlineCompletionAdvanced')}
                    description={t('writeInlineCompletionAdvancedDesc')}
                  >
                    <div className="divide-y divide-ds-border-muted">
                <SettingRow
                  title={t('writeInlineCompletionDebounce')}
                  description={t('writeInlineCompletionDebounceDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.write.inlineCompletion.debounceMs}
                      onChange={(e) => update({
                        write: { inlineCompletion: { debounceMs: Number(e.target.value) } }
                      })}
                    >
                      <option value={300}>{t('writeInlineCompletionDelayFast')}</option>
                      <option value={650}>{t('writeInlineCompletionDelayBalanced')}</option>
                      <option value={1000}>{t('writeInlineCompletionDelayCalm')}</option>
                      <option value={1500}>{t('writeInlineCompletionDelaySlow')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionThreshold')}
                  description={t('writeInlineCompletionThresholdDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.write.inlineCompletion.minAcceptScore}
                      onChange={(e) => update({
                        write: { inlineCompletion: { minAcceptScore: Number(e.target.value) } }
                      })}
                    >
                      <option value={0.38}>{t('writeInlineCompletionThresholdCreative')}</option>
                      <option value={0.52}>{t('writeInlineCompletionThresholdBalanced')}</option>
                      <option value={0.68}>{t('writeInlineCompletionThresholdStrict')}</option>
                      <option value={0.82}>{t('writeInlineCompletionThresholdVeryStrict')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('writeInlineCompletionMaxTokens')}
                  description={t('writeInlineCompletionMaxTokensDesc')}
                  control={
                    <input
                      type="number"
                      min={16}
                      max={512}
                      step={8}
                      className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={form.write.inlineCompletion.maxTokens}
                      placeholder={String(DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS)}
                      onChange={(e) => update({
                        write: { inlineCompletion: { maxTokens: Number(e.target.value) } }
                      })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineLongCompletion')}
                  description={t('writeInlineLongCompletionDesc')}
                  control={
                    <Toggle
                      checked={form.write.inlineCompletion.longCompletionEnabled}
                      onChange={(longCompletionEnabled) => update({
                        write: { inlineCompletion: { longCompletionEnabled } }
                      })}
                    />
                  }
                />
                <SettingRow
                  title={t('writeInlineLongCompletionMaxTokens')}
                  description={t('writeInlineLongCompletionMaxTokensDesc')}
                  control={
                    <input
                      type="number"
                      min={64}
                      max={1024}
                      step={16}
                      className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={form.write.inlineCompletion.longMaxTokens}
                      placeholder={String(DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS)}
                      onChange={(e) => update({
                        write: { inlineCompletion: { longMaxTokens: Number(e.target.value) } }
                      })}
                    />
                  }
                />
                    </div>
                  </AdvancedSettingsDisclosure>
                </div>
              </SettingsCard>

              <SettingsCard title={t('writeSelectionAssistTitle')} className="mt-5">
                <div className="px-3 py-4">
                  <AdvancedSettingsDisclosure
                    title={t('writeSelectionAssistAdvanced')}
                    description={t('writeSelectionAssistAdvancedDesc')}
                  >
                    <div className="flex flex-col gap-5 px-4 py-4">
                      <div>
                        <div className="text-[13px] font-semibold text-ds-ink">
                          {t('writeInfographicPromptLabel')}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                          {t('writeInfographicPromptDesc')}
                        </p>
                        <textarea
                          className={`${textInputClass} mt-2 min-h-[72px] resize-y leading-5`}
                          value={selectionAssist.infographicPrompt}
                          placeholder={WRITE_INFOGRAPHIC_DEFAULT_PROMPT}
                          spellCheck={false}
                          onChange={(e) =>
                            update({ write: { selectionAssist: { infographicPrompt: e.target.value } } })
                          }
                        />
                      </div>

                      <div>
                        <div className="text-[13px] font-semibold text-ds-ink">
                          {t('writeDesignDraftPromptLabel')}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                          {t('writeDesignDraftPromptDesc')}
                        </p>
                        <textarea
                          className={`${textInputClass} mt-2 min-h-[72px] resize-y leading-5`}
                          value={selectionAssist.designDraftPrompt}
                          placeholder={WRITE_DESIGN_DRAFT_DEFAULT_PROMPT}
                          spellCheck={false}
                          onChange={(e) =>
                            update({ write: { selectionAssist: { designDraftPrompt: e.target.value } } })
                          }
                        />
                      </div>

                      <div>
                        <div className="text-[13px] font-semibold text-ds-ink">
                          {t('writePrototypePromptLabel')}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                          {t('writePrototypePromptDesc')}
                        </p>
                        <textarea
                          className={`${textInputClass} mt-2 min-h-[72px] resize-y leading-5`}
                          value={selectionAssist.prototypePrompt}
                          placeholder={WRITE_PROTOTYPE_DEFAULT_PROMPT}
                          spellCheck={false}
                          onChange={(e) =>
                            update({ write: { selectionAssist: { prototypePrompt: e.target.value } } })
                          }
                        />
                      </div>

                      <div>
                        <div className="text-[13px] font-semibold text-ds-ink">
                          {t('writeQuickActionsLabel')}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                          {t('writeQuickActionsDesc')}
                        </p>
                        <div className="mt-3 flex flex-col gap-3">
                          {selectionAssist.quickActions.map(
                            (action: WriteQuickActionV1, index: number) => {
                              const builtin = builtinWriteQuickActionDefaults(action.id, tCommon)
                              return (
                                <div
                                  key={action.id}
                                  className="rounded-xl border border-ds-border-muted bg-ds-card/70 p-3"
                                >
                                  <div className="flex items-center gap-2">
                                    <input
                                      className={`${textInputClass} max-w-[200px]`}
                                      value={action.label}
                                      placeholder={builtin?.label ?? t('writeQuickActionLabelPlaceholder')}
                                      spellCheck={false}
                                      onChange={(e) => {
                                        const next = [...selectionAssist.quickActions]
                                        next[index] = { ...action, label: e.target.value }
                                        updateQuickActions(next)
                                      }}
                                    />
                                    <select
                                      className={selectControlClass}
                                      value={action.mode}
                                      title={t('writeQuickActionModeLabel')}
                                      aria-label={t('writeQuickActionModeLabel')}
                                      onChange={(e) => {
                                        const next = [...selectionAssist.quickActions]
                                        next[index] = {
                                          ...action,
                                          mode: e.target.value === 'edit' ? 'edit' : 'chat'
                                        }
                                        updateQuickActions(next)
                                      }}
                                    >
                                      <option value="edit">{t('writeQuickActionModeEdit')}</option>
                                      <option value="chat">{t('writeQuickActionModeChat')}</option>
                                    </select>
                                    <button
                                      type="button"
                                      className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ds-faint transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
                                      title={t('writeQuickActionRemove')}
                                      aria-label={t('writeQuickActionRemove')}
                                      onClick={() =>
                                        updateQuickActions(
                                          selectionAssist.quickActions.filter(
                                            (item: WriteQuickActionV1) => item.id !== action.id
                                          )
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                                    </button>
                                  </div>
                                  <textarea
                                    className={`${textInputClass} mt-2 min-h-[60px] resize-y leading-5`}
                                    value={action.prompt}
                                    placeholder={builtin?.prompt ?? t('writeQuickActionPromptPlaceholder')}
                                    spellCheck={false}
                                    onChange={(e) => {
                                      const next = [...selectionAssist.quickActions]
                                      next[index] = { ...action, prompt: e.target.value }
                                      updateQuickActions(next)
                                    }}
                                  />
                                </div>
                              )
                            }
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={ghostButtonClass}
                            disabled={selectionAssist.quickActions.length >= WRITE_QUICK_ACTION_MAX_COUNT}
                            onClick={() =>
                              updateQuickActions([
                                ...selectionAssist.quickActions,
                                { id: `custom-${Date.now().toString(36)}`, label: '', prompt: '', mode: 'chat' }
                              ])
                            }
                          >
                            <Plus className="h-4 w-4" strokeWidth={2} />
                            {t('writeQuickActionAdd')}
                          </button>
                          <button
                            type="button"
                            className={ghostButtonClass}
                            onClick={() =>
                              update({ write: { selectionAssist: defaultWriteSelectionAssistSettings() } })
                            }
                          >
                            <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
                            {t('writeQuickActionsReset')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </AdvancedSettingsDisclosure>
                </div>
              </SettingsCard>

              <SettingsCard title={t('writeAgentPresets')} className="mt-5">
                <div className="px-3 py-4">
                  <p className="text-[12.5px] leading-5 text-ds-faint">
                    {t('writeAgentPresetsDesc')}
                  </p>
                  {agentPresets.length > 0 ? (
                    <div className="mt-3 flex flex-col gap-3">
                      {agentPresets.map((preset: WriteAgentPresetV1, index: number) => {
                        return (
                          <div
                            key={preset.id}
                            className="rounded-xl border border-ds-border-muted bg-ds-card/70 p-3"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                className={`${textInputClass} max-w-[56px] text-center`}
                                value={preset.emoji}
                                placeholder="🤖"
                                spellCheck={false}
                                onChange={(e) => {
                                  const next = [...agentPresets]
                                  next[index] = { ...preset, emoji: e.target.value }
                                  updateAgentPresets(next)
                                }}
                              />
                              <input
                                className={`${textInputClass} max-w-[220px]`}
                                value={preset.name}
                                placeholder={t('writeAgentPresetNamePlaceholder')}
                                spellCheck={false}
                                onChange={(e) => {
                                  const next = [...agentPresets]
                                  next[index] = { ...preset, name: e.target.value }
                                  updateAgentPresets(next)
                                }}
                              />
                              <button
                                type="button"
                                className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ds-faint transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
                                title={t('writeAgentPresetRemove')}
                                aria-label={t('writeAgentPresetRemove')}
                                onClick={() =>
                                  updateAgentPresets(
                                    agentPresets.filter((item: WriteAgentPresetV1) => item.id !== preset.id)
                                  )
                                }
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                              </button>
                            </div>
                            <textarea
                              className={`${textInputClass} mt-2 min-h-[84px] resize-y leading-5`}
                              value={preset.persona}
                              placeholder={t('writeAgentPersonaPlaceholder')}
                              spellCheck={false}
                              onChange={(e) => {
                                const next = [...agentPresets]
                                next[index] = { ...preset, persona: e.target.value }
                                updateAgentPresets(next)
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={ghostButtonClass}
                      disabled={agentPresets.length >= WRITE_AGENT_PRESET_MAX_COUNT}
                      onClick={() =>
                        updateAgentPresets([
                          ...agentPresets,
                          { id: `custom-${Date.now().toString(36)}`, name: '', emoji: '🤖', persona: '' }
                        ])
                      }
                    >
                      <Plus className="h-4 w-4" strokeWidth={2} />
                      {t('writeAgentPresetAdd')}
                    </button>
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard title={t('writeDebugLogTitle')} className="mt-5">
                <SettingRow
                  title={t('writeDebugLogOpen')}
                  description={t('writeDebugLogDesc')}
                  control={
                    <button
                      type="button"
                      onClick={() => {
                        setWriteDebugModalOpen(true)
                        void loadWriteDebugEntries()
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    >
                      <PencilLine className="h-4 w-4" strokeWidth={1.75} />
                      {t('writeDebugLogOpenButton')}
                    </button>
                  }
                />
              </SettingsCard>
            </>
  )
}

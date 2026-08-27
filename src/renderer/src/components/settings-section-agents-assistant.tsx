import type {
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  MIN_KUN_LOCAL_PORT
} from '@shared/app-settings'
import { persistComposerModel } from '../store/chat-store-helpers'
import { isKunRuntimeInsecure } from '@shared/app-settings-kun-migration'
import { type ReactElement } from 'react'
import { formatCompactNumber } from '../hooks/use-thread-usage'
import { FastContextSettingsPanel } from './settings-section-assistant-fast-context'
import {
  AdvancedSettingsDisclosure,
  ModelSelect,
  SecretInput,
  SettingRow,
  SettingsCard,
  Toggle
} from './settings-controls'

export function AgentsAssistantSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { t, openStorageSettings, form, kun, update, updateKun, showRuntimeToken, setShowRuntimeToken, portError, selectControlClass, compactHomePath, expandHomePath, agentsSectionRef, runtimeInfo, toolDiagnostics, productionManagedDataDir, windowsStorageManagement, tokenEconomy, tokenEconomySavingsState, activePanel, tokenEconomySavings, updateTokenEconomy, modelProviders, instructions, updateInstructions, activeProvider, activeProviderModels, promptOptimization, promptOptimizationModels, promptOptimizationDefaultModel, updatePromptOptimization, selectKunProvider, fastContext, updateFastContext } = view
  return (
    <>
              <div
                id="agents-settings-panel-assistant"
                ref={agentsSectionRef}
                role="tabpanel"
                aria-labelledby="agents-settings-tab-assistant"
                className={activePanel === 'assistant' ? '' : 'hidden'}
              >
                <SettingsCard title={t('agents')}>
                  <SettingRow
                    title={t('autoStart')}
                    description={t('autoStartDesc')}
                    control={
                      <Toggle
                        checked={kun.autoStart}
                        onChange={(v) => updateKun({ autoStart: v })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunProvider')}
                    description={t('kunProviderSelectDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={activeProvider?.id ?? DEFAULT_MODEL_PROVIDER_ID}
                        onChange={(e) => selectKunProvider(e.target.value)}
                      >
                        {modelProviders.map((item: ModelProviderProfileV1) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('kunModel')}
                    description={t('kunModelDesc')}
                    control={
                      <ModelSelect
                        value={kun.model}
                        options={activeProviderModels}
                        optionLabel={(model) =>
                          model === activeProviderModels[0]
                            ? t('modelSelectDefaultSuffix', { model })
                            : model}
                        allowCustom
                        customLabel={t('modelSelectCustomOption')}
                        customPlaceholder={t('modelSelectCustomPlaceholder')}
                        selectClassName={selectControlClass}
                        onChange={(model) => {
                          const next = model.trim()
                          updateKun({ model: next || (activeProviderModels[0] ?? kun.model) })
                        }}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunResetDefaultModel')}
                    description={t('kunResetDefaultModelDesc', { model: DEFAULT_KUN_MODEL })}
                    control={
                      <button
                        type="button"
                        className="rounded-xl border border-ds-border bg-ds-main/60 px-3 py-2 text-[13px] font-medium text-ds-ink transition hover:border-accent/40 hover:bg-ds-main"
                        onClick={() => {
                          updateKun({ model: DEFAULT_KUN_MODEL })
                          persistComposerModel(DEFAULT_KUN_MODEL)
                        }}
                      >
                        {t('kunResetDefaultModelAction', { model: DEFAULT_KUN_MODEL })}
                      </button>
                    }
                  />
                  <SettingRow
                    title={t('codePromptPrefix')}
                    description={t('codePromptPrefixDesc')}
                    wideControl
                    control={
                      <textarea
                        value={form?.codePromptPrefix ?? ''}
                        onChange={(e) => update({ codePromptPrefix: e.target.value })}
                        placeholder={t('codePromptPrefixPlaceholder')}
                        className="min-h-[110px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[14px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunPromptOptimization')}
                    description={t('kunPromptOptimizationDesc')}
                    control={
                      <Toggle
                        checked={promptOptimization.enabled}
                        onChange={(enabled) => updatePromptOptimization({ enabled })}
                      />
                    }
                  />
                  {promptOptimization.enabled ? (
                    <SettingRow
                      title={t('kunPromptOptimizationConfig')}
                      description={t('kunPromptOptimizationConfigDesc')}
                      wideControl
                      control={
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(120px,160px)]">
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                            {t('kunPromptOptimizationProvider')}
                            <select
                              className={selectControlClass}
                              value={promptOptimization.providerId?.trim() || ''}
                              onChange={(e) => {
                                const providerId = e.target.value
                                const nextProvider = modelProviders.find((item: ModelProviderProfileV1) => item.id === providerId) ?? activeProvider
                                const keepModel = nextProvider?.models.includes(promptOptimization.model) === true
                                updatePromptOptimization({
                                  providerId,
                                  model: keepModel ? promptOptimization.model : ''
                                })
                              }}
                            >
                              <option value="">{t('modelSelectDefaultSuffix', {
                                model: activeProvider?.name ?? DEFAULT_MODEL_PROVIDER_ID
                              })}</option>
                              {modelProviders.map((item: ModelProviderProfileV1) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                            {t('kunPromptOptimizationModel')}
                            <ModelSelect
                              value={promptOptimization.model}
                              options={promptOptimizationModels}
                              defaultLabel={t('kunPromptOptimizationModelDefault', {
                                model: promptOptimizationDefaultModel
                              })}
                              optionLabel={(model) => model}
                              allowCustom
                              customLabel={t('modelSelectCustomOption')}
                              customPlaceholder={t('modelSelectCustomPlaceholder')}
                              selectClassName={selectControlClass}
                              onChange={(model) => updatePromptOptimization({ model: model.trim() })}
                            />
                          </label>
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                            {t('kunPromptOptimizationTimeout')}
                            <input
                              type="number"
                              min={1000}
                              max={600000}
                              step={1000}
                              className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                              value={promptOptimization.timeoutMs}
                              onChange={(e) => updatePromptOptimization({ timeoutMs: Number(e.target.value) })}
                            />
                          </label>
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted lg:col-span-3">
                            {t('kunPromptOptimizationPrompt')}
                            <textarea
                              value={promptOptimization.prompt}
                              onChange={(e) => updatePromptOptimization({ prompt: e.target.value })}
                              placeholder={DEFAULT_PROMPT_OPTIMIZATION_PROMPT}
                              className="min-h-[140px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[13px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                            />
                          </label>
                        </div>
                      }
                    />
                  ) : null}
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunAssistantAdvanced')}
                      description={t('kunAssistantAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('port')}
                    description={t('portDesc')}
                    control={
                      <div>
                        <input
                          type="number"
                          min={MIN_KUN_LOCAL_PORT}
                          max={65535}
                          className={`w-28 rounded-xl border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:outline-none focus:ring-1 ${
                            portError
                              ? 'border-red-400 focus:ring-red-300'
                              : 'border-ds-border focus:border-accent/40 focus:ring-accent/30'
                          }`}
                          value={kun.port}
                          onChange={(e) => updateKun({ port: Number(e.target.value) })}
                        />
                        {portError ? (
                          <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{portError}</p>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunBinary')}
                    description={t('kunBinaryDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={t('kunBinaryPlaceholder')}
                        value={compactHomePath(kun.binaryPath)}
                        onChange={(e) => updateKun({ binaryPath: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunDataDir')}
                    description={t('kunDataDirDesc')}
                    control={
                      <div className="flex w-full min-w-0 gap-2 md:max-w-md">
                        <input
                          readOnly={productionManagedDataDir}
                          className="min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm read-only:cursor-default read-only:text-ds-muted focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          placeholder={DEFAULT_KUN_DATA_DIR}
                          value={compactHomePath(kun.dataDir)}
                          onChange={(e) => {
                            if (!productionManagedDataDir) {
                              updateKun({ dataDir: expandHomePath(e.target.value) })
                            }
                          }}
                        />
                        {windowsStorageManagement ? (
                          <button type="button" className="secondary-button shrink-0" onClick={openStorageSettings}>{t('storageRelocation')}</button>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('runtimeToken')}
                    description={t('runtimeTokenDesc')}
                    control={
                      <SecretInput
                        value={kun.runtimeToken}
                        onChange={(value) => updateKun({ runtimeToken: value })}
                        visible={showRuntimeToken}
                        onToggleVisibility={() => setShowRuntimeToken((value: boolean) => !value)}
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                        className="md:max-w-md"
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunInsecure')}
                    description={t('kunInsecureDesc')}
                    control={
                      <Toggle
                        checked={isKunRuntimeInsecure(kun)}
                        onChange={(v) => updateKun({ insecure: v })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                  <SettingRow
                    title={t('kunTokenEconomy')}
                    description={t('kunTokenEconomyDesc')}
                    control={
                      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                        <Toggle
                          checked={tokenEconomy.enabled}
                          onChange={(enabled) => updateTokenEconomy({ enabled })}
                        />
                        {tokenEconomy.enabled ? (
                          <div className="max-w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] font-medium leading-5 text-emerald-700 dark:text-emerald-200">
                            {tokenEconomySavings ? (
                              <span>
                                {t('kunTokenEconomySavings', {
                                  tokens: formatCompactNumber(tokenEconomySavings.tokens)
                                })}
                              </span>
                            ) : tokenEconomySavingsState.loading ? (
                              <span>{t('kunTokenEconomySavingsLoading')}</span>
                            ) : (
                              <span>{t('kunTokenEconomySavingsEmpty')}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunInstructions')}
                    description={t('kunInstructionsDesc')}
                    control={
                      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                        <Toggle
                          checked={instructions.enabled}
                          onChange={(enabled) => updateInstructions({ enabled })}
                        />
                        <div className="max-w-full rounded-lg border border-ds-border-muted bg-ds-main/40 px-2.5 py-1.5 text-[12px] leading-5 text-ds-muted">
                          {t('kunInstructionsDiagnostics', {
                            count: toolDiagnostics?.instructions?.lastInjection?.sources?.length ?? runtimeInfo?.capabilities?.instructions?.lastSourceCount ?? 0
                          })}
                        </div>
                      </div>
                    }
                  />
                  <FastContextSettingsPanel
                    t={t}
                    value={fastContext}
                    modelProviders={modelProviders}
                    leadProviderId={kun.providerId}
                    leadModel={kun.model}
                    selectControlClass={selectControlClass}
                    onChange={updateFastContext}
                  />
                </SettingsCard>
              </div>
    </>
  )
}

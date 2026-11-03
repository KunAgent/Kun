import type { ReactElement } from 'react'
import type {
  KunGraphSettingsV1,
  KunGraphSettingsPatchV1,
  ModelReasoningEffort,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  MODEL_REASONING_EFFORTS
} from '@shared/app-settings'
import { modelProviderModelProfile } from '@shared/app-settings-provider-core'
import { Workflow } from 'lucide-react'
import {
  ModelSelect,
  SettingRow,
  Toggle
} from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'

type Translate = (key: string) => string

const REASONING_EFFORT_LABEL_KEYS: Record<ModelReasoningEffort, string> = {
  auto: 'graphSettingsReasoningAuto',
  off: 'graphSettingsReasoningOff',
  low: 'graphSettingsReasoningLow',
  medium: 'graphSettingsReasoningMedium',
  high: 'graphSettingsReasoningHigh',
  xhigh: 'graphSettingsReasoningXhigh',
  max: 'graphSettingsReasoningMax'
}

function reasoningEffortsForWorkerModel(
  provider: ModelProviderProfileV1 | undefined,
  model: string
): ModelReasoningEffort[] {
  if (!provider) return [...MODEL_REASONING_EFFORTS]
  const supported = modelProviderModelProfile(provider, model)?.reasoning?.supportedEfforts
  return supported && supported.length > 0
    ? supported
    : [...MODEL_REASONING_EFFORTS]
}

function compatibleReasoningEffort(
  provider: ModelProviderProfileV1 | undefined,
  model: string,
  current: ModelReasoningEffort | undefined
): ModelReasoningEffort | undefined {
  if (!current || !provider) return current
  const reasoning = modelProviderModelProfile(provider, model)?.reasoning
  if (!reasoning || reasoning.supportedEfforts.includes(current)) return current
  return reasoning.defaultEffort
}

export function GraphModeSettingsPanel({
  t,
  value,
  modelProviders,
  leadProviderId,
  leadModel,
  selectControlClass,
  onChange
}: {
  t: Translate
  value: KunGraphSettingsV1
  modelProviders: ModelProviderProfileV1[]
  leadProviderId: string
  leadModel: string
  selectControlClass: string
  onChange: (patch: KunGraphSettingsPatchV1) => void
}): ReactElement {
  const numberInputClass =
    'w-28 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
  const workerProviderId = value.workerModel.mode === 'fixed'
    ? value.workerModel.providerId
    : leadProviderId
  const workerProvider = modelProviders.find((provider) =>
    provider.id === workerProviderId
  ) ?? modelProviders[0]
  const workerModels = workerProvider?.models ?? []
  const workerModel = value.workerModel.mode === 'fixed'
    ? value.workerModel.model
    : leadModel
  const workerReasoningEfforts = reasoningEffortsForWorkerModel(workerProvider, workerModel)
  const workerReasoningEffort = value.workerModel.mode === 'fixed'
    ? value.workerModel.reasoningEffort
    : undefined
  return (
    <SettingsFeatureCard
      icon={Workflow}
      tone="green"
      title={t('graphSettingsTitle')}
      description={t('graphSettingsDescription')}
      enabled={value.enabled}
      onEnabledChange={(enabled) => onChange({
        enabled,
        defaultStrategy: 'direct'
      })}
      toggleLabel={t('graphSettingsEnable')}
      enabledLabel={t('settingsIaFeatureOn')}
    >
      <div className="px-3 py-3">
        <div className="rounded-lg border border-indigo-400/25 bg-indigo-500/8 px-3 py-2 text-[12px] leading-5 text-indigo-700 dark:text-indigo-200">
          {t('graphSettingsSafety')}
        </div>
      </div>
      <SettingRow
        title={t('graphSettingsWorkerModelMode')}
        description={t('graphSettingsWorkerModelModeDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.workerModel.mode}
            onChange={(event) => {
              if (event.target.value === 'inherit') {
                onChange({ workerModel: { mode: 'inherit' } })
                return
              }
              const providerId = workerProvider?.id || leadProviderId
              const model = workerModels.includes(leadModel)
                ? leadModel
                : workerModels[0] ?? leadModel
              onChange({
                workerModel: {
                  mode: 'fixed',
                  providerId,
                  model
                }
              })
            }}
          >
            <option value="inherit">{t('graphSettingsWorkerModelInherit')}</option>
            <option value="fixed">{t('graphSettingsWorkerModelFixed')}</option>
          </select>
        }
      />
      {value.workerModel.mode === 'fixed' ? (
        <SettingRow
          title={t('graphSettingsWorkerModel')}
          description={t('graphSettingsWorkerModelDesc')}
          wideControl
          control={
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                aria-label={t('graphSettingsWorkerProvider')}
                className={selectControlClass}
                value={workerProvider?.id ?? workerProviderId}
                onChange={(event) => {
                  const providerId = event.target.value
                  const provider = modelProviders.find((item) => item.id === providerId)
                  onChange({
                    workerModel: {
                      mode: 'fixed',
                      providerId,
                      model: provider?.models.includes(workerModel)
                        ? workerModel
                        : provider?.models[0] ?? workerModel,
                      reasoningEffort: compatibleReasoningEffort(
                        provider,
                        provider?.models.includes(workerModel)
                          ? workerModel
                          : provider?.models[0] ?? workerModel,
                        workerReasoningEffort
                      )
                    }
                  })
                }}
              >
                {modelProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
              <ModelSelect
                value={workerModel}
                options={workerModels}
                allowCustom
                customLabel={t('modelSelectCustomOption')}
                customPlaceholder={t('modelSelectCustomPlaceholder')}
                selectClassName={selectControlClass}
                onChange={(model) => {
                  const nextModel = model.trim()
                  onChange({
                    workerModel: {
                      mode: 'fixed',
                      providerId: workerProvider?.id ?? workerProviderId,
                      model: nextModel || workerModel,
                      reasoningEffort: compatibleReasoningEffort(
                        workerProvider,
                        nextModel || workerModel,
                        workerReasoningEffort
                      )
                    }
                  })
                }}
              />
            </div>
          }
        />
      ) : null}
      {value.workerModel.mode === 'fixed' ? (
        <SettingRow
          title={t('graphSettingsWorkerReasoning')}
          description={t('graphSettingsWorkerReasoningDesc')}
          control={
            <select
              aria-label={t('graphSettingsWorkerReasoning')}
              className={selectControlClass}
              value={workerReasoningEffort ?? ''}
              onChange={(event) => onChange({
                workerModel: {
                  mode: 'fixed',
                  providerId: workerProvider?.id ?? workerProviderId,
                  model: workerModel,
                  reasoningEffort: event.target.value
                    ? event.target.value as ModelReasoningEffort
                    : undefined
                }
              })}
            >
              <option value="">{t('graphSettingsReasoningInherit')}</option>
              {workerReasoningEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {t(REASONING_EFFORT_LABEL_KEYS[effort])}
                </option>
              ))}
            </select>
          }
        />
      ) : null}
      <SettingRow
        title={t('graphSettingsGlobalConcurrency')}
        description={t('graphSettingsGlobalConcurrencyDesc')}
        control={
          <input
            type="number"
            min={1}
            max={256}
            className={numberInputClass}
            value={value.scheduler.maxConcurrentNodes}
            onChange={(event) => onChange({
              scheduler: {
                maxConcurrentNodes: Math.max(1, Math.min(256, Number(event.target.value)))
              }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsConcurrency')}
        description={t('graphSettingsConcurrencyDesc')}
        control={
          <input
            type="number"
            min={1}
            max={64}
            className={numberInputClass}
            value={value.scheduler.maxConcurrentNodesPerRun}
            onChange={(event) => onChange({
              scheduler: {
                maxConcurrentNodesPerRun: Math.max(
                  1,
                  Math.min(value.scheduler.maxConcurrentNodes, Number(event.target.value))
                )
              }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsMaxNodes')}
        description={t('graphSettingsMaxNodesDesc')}
        control={
          <input
            type="number"
            min={1}
            max={10000}
            className={numberInputClass}
            value={value.scheduler.maxNodes}
            onChange={(event) => onChange({
              scheduler: {
                maxNodes: Math.max(1, Math.min(10000, Number(event.target.value)))
              }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsAttempts')}
        description={t('graphSettingsAttemptsDesc')}
        control={
          <input
            type="number"
            min={1}
            max={20}
            className={numberInputClass}
            value={value.scheduler.maxAttemptsPerNode}
            onChange={(event) => onChange({
              scheduler: {
                maxAttemptsPerNode: Math.max(1, Math.min(20, Number(event.target.value)))
              }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsLoops')}
        description={t('graphSettingsLoopsDesc')}
        control={
          <input
            type="number"
            min={0}
            max={1000}
            className={numberInputClass}
            value={value.scheduler.maxLoopIterations}
            onChange={(event) => onChange({
              scheduler: {
                maxLoopIterations: Math.max(0, Math.min(1000, Number(event.target.value)))
              }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsRunHours')}
        description={t('graphSettingsRunHoursDesc')}
        control={
          <input
            type="number"
            min={1}
            max={720}
            className={numberInputClass}
            value={Math.round(value.scheduler.maxRunWallTimeMs / 3_600_000)}
            onChange={(event) => onChange({
              scheduler: {
                maxRunWallTimeMs: Math.max(
                  1,
                  Math.min(720, Number(event.target.value))
                ) * 3_600_000
              }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsWriteIsolation')}
        description={t('graphSettingsWriteIsolationDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.writeIsolation.mode}
            onChange={(event) => {
              const mode = event.target.value as 'serialize' | 'lease' | 'worktree'
              onChange({
                writeIsolation: {
                  mode,
                  allowWorktrees: mode === 'worktree'
                }
              })
            }}
          >
            <option value="serialize">{t('graphSettingsWriteSerialize')}</option>
            <option value="lease">{t('graphSettingsWriteLease')}</option>
            <option value="worktree">{t('graphSettingsWriteWorktree')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('graphSettingsSupervision')}
        description={t('graphSettingsSupervisionDesc')}
        control={
          <Toggle
            checked={value.supervision.enabled}
            onChange={(enabled) => onChange({ supervision: { enabled } })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsFinalReview')}
        description={t('graphSettingsFinalReviewDesc')}
        control={
          <Toggle
            checked={value.supervision.requireFinalReview}
            onChange={(requireFinalReview) => onChange({
              supervision: { requireFinalReview }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsCriticalHuman')}
        description={t('graphSettingsCriticalHumanDesc')}
        control={
          <Toggle
            checked={value.supervision.requireHumanForCriticalRisk}
            onChange={(requireHumanForCriticalRisk) => onChange({
              supervision: { requireHumanForCriticalRisk }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsLearning')}
        description={t('graphSettingsLearningDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.learning.mode}
            onChange={(event) => onChange({
              learning: {
                mode: event.target.value as 'off' | 'suggest' | 'auto_candidate'
              }
            })}
          >
            <option value="off">{t('graphSettingsLearningOff')}</option>
            <option value="suggest">{t('graphSettingsLearningSuggest')}</option>
            <option value="auto_candidate">{t('graphSettingsLearningAuto')}</option>
          </select>
        }
      />
      {value.learning.mode !== 'off' ? (
        <>
          <SettingRow
            title={t('graphSettingsLearningSessions')}
            description={t('graphSettingsLearningSessionsDesc')}
            control={
              <input
                type="number"
                min={2}
                max={100}
                className={numberInputClass}
                value={value.learning.minimumDistinctSessions}
                onChange={(event) => onChange({
                  learning: {
                    minimumDistinctSessions: Math.max(2, Math.min(100, Number(event.target.value)))
                  }
                })}
              />
            }
          />
          <SettingRow
            title={t('graphSettingsVerifiedEpisodes')}
            description={t('graphSettingsVerifiedEpisodesDesc')}
            control={
              <input
                type="number"
                min={2}
                max={1000}
                className={numberInputClass}
                value={value.learning.minimumVerifiedEpisodes}
                onChange={(event) => onChange({
                  learning: {
                    minimumVerifiedEpisodes: Math.max(
                      2,
                      Math.min(1000, Number(event.target.value))
                    )
                  }
                })}
              />
            }
          />
          <SettingRow
            title={t('graphSettingsProbationRuns')}
            description={t('graphSettingsProbationRunsDesc')}
            control={
              <input
                type="number"
                min={1}
                max={1000}
                className={numberInputClass}
                value={value.learning.probationMinimumRuns}
                onChange={(event) => onChange({
                  learning: {
                    probationMinimumRuns: Math.max(
                      1,
                      Math.min(1000, Number(event.target.value))
                    )
                  }
                })}
              />
            }
          />
          <SettingRow
            title={t('graphSettingsReadOnlyExplore')}
            description={t('graphSettingsReadOnlyExploreDesc')}
            control={
              <Toggle
                checked={value.learning.allowReadOnlyExploration}
                onChange={(allowReadOnlyExploration) => onChange({
                  learning: { allowReadOnlyExploration }
                })}
              />
            }
          />
          <SettingRow
            title={t('graphSettingsDormancy')}
            description={t('graphSettingsDormancyDesc')}
            control={
              <input
                type="number"
                min={1}
                max={10000}
                className={numberInputClass}
                value={value.routing.dormantMissedOpportunityThreshold}
                onChange={(event) => onChange({
                  routing: {
                    dormantMissedOpportunityThreshold: Math.max(
                      1,
                      Math.min(10000, Number(event.target.value))
                    )
                  }
                })}
              />
            }
          />
        </>
      ) : null}
      <SettingRow
        title={t('graphSettingsGraphRetention')}
        description={t('graphSettingsGraphRetentionDesc')}
        control={
          <input
            type="number"
            min={1}
            max={3650}
            className={numberInputClass}
            value={value.retention.graphDays}
            onChange={(event) => onChange({
              retention: {
                graphDays: Math.max(1, Math.min(3650, Number(event.target.value)))
              }
            })}
          />
        }
      />
      <SettingRow
        title={t('graphSettingsEpisodeRetention')}
        description={t('graphSettingsEpisodeRetentionDesc')}
        control={
          <input
            type="number"
            min={1}
            max={3650}
            className={numberInputClass}
            value={value.retention.episodeDays}
            onChange={(event) => onChange({
              retention: {
                episodeDays: Math.max(1, Math.min(3650, Number(event.target.value)))
              }
            })}
          />
        }
      />
    </SettingsFeatureCard>
  )
}

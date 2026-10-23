import { settingsButtonClass } from './settings-button'
import type {
  KunBrowserUseSettingsV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  defaultKunContextCompactionSettings,
  defaultKunGraphSettings
} from '@shared/app-settings'
import { defaultKunBrowserUseSettings } from '@shared/app-settings-kun-defaults'
import { defaultKunLabSettings } from '@shared/app-settings-kun-merge'
import { defaultModelProviderSettings } from '@shared/app-settings-provider-core'
import type {
  ComputerUsePermissionKind,
  ComputerUsePermissions,
  ComputerUsePermissionState
} from '@shared/kun-gui-api'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { SettingRow } from './settings-controls'
import {
  BrowserUseSettingsPanel,
  ComputerUseSettingsPanel
} from './settings-section-agent-panels'
import { GraphModeSettingsPanel } from './settings-section-graph-panel'
import { ConversationVisualizationSettingsPanel } from './settings-section-lab-conversation-visualization'
import { AppSurfacesSettingsPanels } from './settings-section-lab-app-surfaces'
import { AssistantMailboxSettingsPanel } from './settings-section-lab-assistant-mailbox'
import { ContextWindowSettingsPanel } from './settings-section-lab-context-window'
import { AutoPlanBuildSettingsPanel } from './settings-section-lab-auto-plan-build'
import { CodexReferenceBranchesSettingsPanel } from './settings-section-lab-codex-reference'
import { ProjectBoardSettingsPanel } from './settings-section-lab-project-board'

/** One labelled group of feature cards on the Labs page. */
function LabFeatureGroup({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <section className="ds-settings-feature-group" aria-label={label}>
      <h2 className="ds-settings-feature-group-label">{label}</h2>
      <div className="ds-settings-feature-list">{children}</div>
    </section>
  )
}

export function LaboratorySettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, kun, updateKun, selectControlClass, runtimeInfo } = ctx
  const provider = form.provider ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const activeProviderId = kun.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const computerUse = kun.computerUse ?? {
    enabled: false,
    mode: 'auto' as const,
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
  const browserUse = kun.browserUse ?? defaultKunBrowserUseSettings()
  const graph = kun.graph ?? defaultKunGraphSettings()
  const lab = kun.lab ?? defaultKunLabSettings()
  const contextCompaction = kun.contextCompaction ?? defaultKunContextCompactionSettings()

  const updateComputerUse = (patch: Record<string, unknown>): void => {
    updateKun({
      computerUse: {
        ...computerUse,
        ...patch
      }
    })
  }
  const updateBrowserUse = (patch: Partial<KunBrowserUseSettingsV1>): void => {
    updateKun({
      browserUse: {
        ...browserUse,
        ...patch
      }
    })
  }

  const enabledCount = [
    contextCompaction.modelInitiatedCompactionEnabled === true,
    lab.conversationVisualization.enabled,
    lab.genUi?.enabled === true,
    lab.mcpApps?.enabled === true,
    lab.codexReferenceBranches?.enabled === true || lab.claudeCodeReferenceBranches?.enabled === true
      || lab.opencodeReferenceBranches?.enabled === true,
    lab.autoPlanBuild.enabled,
    graph.enabled,
    lab.projectBoard.enabled,
    lab.assistantMailbox?.enabled === true,
    computerUse.enabled,
    browserUse.enabled
  ].filter(Boolean).length

  return (
    <>
      <p className="ds-settings-lab-summary" role="status">
        {t('settingsIaLabsEnabledCount', { count: enabledCount, total: 11 })}
      </p>
      <LabFeatureGroup label={t('settingsIaLabsGroupConversation')}>
        <ContextWindowSettingsPanel
          t={t}
          modelInitiatedCompactionEnabled={contextCompaction.modelInitiatedCompactionEnabled === true}
          windowModeEnabled={contextCompaction.windowModeEnabled === true}
          onModelInitiatedChange={(modelInitiatedCompactionEnabled) => updateKun({
            contextCompaction: {
              ...contextCompaction,
              modelInitiatedCompactionEnabled,
              windowModeEnabled: modelInitiatedCompactionEnabled
                ? contextCompaction.windowModeEnabled === true
                : false
            }
          })}
          onWindowModeChange={(windowModeEnabled) => updateKun({
            contextCompaction: {
              ...contextCompaction,
              windowModeEnabled
            }
          })}
        />
        <ConversationVisualizationSettingsPanel
          t={t}
          value={lab}
          onChange={(patch) => updateKun({ lab: patch })}
        />
        <AppSurfacesSettingsPanels t={t} value={lab} onChange={(patch) => updateKun({ lab: patch })} />
        <CodexReferenceBranchesSettingsPanel t={t} value={lab} onChange={(patch) => updateKun({ lab: patch })} />
      </LabFeatureGroup>

      <LabFeatureGroup label={t('settingsIaLabsGroupAutomation')}>
        <AutoPlanBuildSettingsPanel
          t={t}
          settings={form}
          value={lab}
          selectControlClass={selectControlClass}
          onChange={(patch) => updateKun({ lab: patch })}
        />
        <GraphModeSettingsPanel
          t={t}
          value={graph}
          modelProviders={modelProviders}
          leadProviderId={activeProviderId}
          leadModel={kun.model}
          selectControlClass={selectControlClass}
          onChange={(patch) => updateKun({ graph: patch })}
        />
        <ProjectBoardSettingsPanel
          t={t}
          value={lab}
          onChange={(patch) => updateKun({ lab: patch })}
        />
        <AssistantMailboxSettingsPanel t={t} value={lab} onChange={(patch) => updateKun({ lab: patch })} />
      </LabFeatureGroup>

      <LabFeatureGroup label={t('settingsIaLabsGroupControl')}>
        <ComputerUseSettingsPanel
          t={t}
          value={computerUse}
          selectControlClass={selectControlClass}
          permissionRow={computerUse.enabled ? <ComputerUsePermissionRow t={t} /> : null}
          onChange={updateComputerUse}
        />
        <BrowserUseSettingsPanel
          t={t}
          value={browserUse}
          capability={runtimeInfo?.capabilities?.browserUse}
          selectControlClass={selectControlClass}
          onChange={updateBrowserUse}
        />
      </LabFeatureGroup>
    </>
  )
}

function permissionBadgeClass(state: ComputerUsePermissionState): string {
  if (state === 'granted') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (state === 'denied') {
    return 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  }
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function ComputerUsePermissionRow({ t }: { t: (key: string) => string }): ReactElement | null {
  const [permissions, setPermissions] = useState<ComputerUsePermissions | null>(null)

  const refresh = (): void => {
    void window.kunGui?.getComputerUsePermissions?.().then(setPermissions).catch(() => undefined)
  }
  useEffect(() => {
    refresh()
  }, [])

  // Non-macOS hosts have no OS permission gate; nothing useful to show.
  if (permissions && !permissions.needsPermission) return null

  const request = (kind: ComputerUsePermissionKind): void => {
    void window.kunGui
      ?.requestComputerUsePermission?.(kind)
      .then(setPermissions)
      .catch(() => undefined)
  }

  const badge = (label: string, state: ComputerUsePermissionState): ReactNode => (
    <span className={`rounded-lg border px-2 py-0.5 text-[12px] font-medium ${permissionBadgeClass(state)}`}>
      {label}: {t(`computerUsePermission_${state}`)}
    </span>
  )

  return (
    <SettingRow
      title={t('computerUsePermissions')}
      description={t('computerUsePermissionsDesc')}
      control={
        <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {permissions?.accessibilityNeedsRestart ? (
              <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-200">
                {t('computerUseAccessibility')}: {t('computerUsePermissionNeedsRestart')}
              </span>
            ) : (
              badge(t('computerUseAccessibility'), permissions?.accessibility ?? 'unknown')
            )}
            {badge(t('computerUseScreenRecording'), permissions?.screenRecording ?? 'unknown')}
          </div>
          {permissions?.accessibilityNeedsRestart ? (
            <p className="max-w-full text-[12px] leading-5 text-amber-700 dark:text-amber-200">
              {t('computerUseRestartHint')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button className={settingsButtonClass()}
              type="button"
              onClick={() => request('accessibility')}
            >
              {t('computerUseGrantAccessibility')}
            </button>
            <button className={settingsButtonClass()}
              type="button"
              onClick={() => request('screenRecording')}
            >
              {t('computerUseGrantScreenRecording')}
            </button>
            <button className={settingsButtonClass()}
              type="button"
              onClick={refresh}
            >
              {t('computerUseRecheck')}
            </button>
          </div>
        </div>
      }
    />
  )
}

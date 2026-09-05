import type {
  KunBrowserUseSettingsV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
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
import {
  Columns3,
  Globe2,
  Monitor,
  Presentation,
  Sparkles,
  Waypoints,
  Workflow
} from 'lucide-react'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import {
  SettingRow,
  SettingsCard,
  SettingsTabPanel,
  SettingsTabs,
  Toggle
} from './settings-controls'
import {
  BrowserUseSettingsPanel,
  ComputerUseSettingsPanel
} from './settings-section-agent-panels'
import { GraphModeSettingsPanel } from './settings-section-graph-panel'
import { ConversationVisualizationSettingsPanel } from './settings-section-lab-conversation-visualization'
import { PptAgentSettingsPanel } from './settings-section-lab-ppt'
import { AutoPlanBuildSettingsPanel } from './settings-section-lab-auto-plan-build'
import { ProjectBoardSettingsPanel } from './settings-section-lab-project-board'

type LaboratorySettingsPanel =
  | 'visualization'
  | 'autoPlanBuild'
  | 'computer'
  | 'browser'
  | 'graph'
  | 'ppt'
  | 'projectBoard'

export function LaboratorySettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, kun, updateKun, selectControlClass, runtimeInfo } = ctx
  const [activePanel, setActivePanel] = useState<LaboratorySettingsPanel>('visualization')
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

  return (
    <>
      <SettingsTabs<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        ariaLabel={t('agentsQuickLaboratory')}
        contentSized
        items={[
          { id: 'visualization', label: t('labConversationVisualizationTitle'), icon: Waypoints },
          { id: 'autoPlanBuild', label: t('labAutoPlanBuildTitle'), icon: Sparkles },
          { id: 'computer', label: t('computerUseTitle'), icon: Monitor },
          { id: 'browser', label: t('browserUseSettingsTitle'), icon: Globe2 },
          { id: 'graph', label: t('graphSettingsTitle'), icon: Workflow },
          { id: 'ppt', label: t('labPptTitle'), icon: Presentation },
          { id: 'projectBoard', label: t('labProjectBoardTitle'), icon: Columns3 }
        ]}
        value={activePanel}
        onChange={setActivePanel}
      />

      <SettingsTabPanel<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        tabId="visualization"
        active={activePanel === 'visualization'}
        className="[&>div]:mt-0"
      >
        <ConversationVisualizationSettingsPanel
          t={t}
          value={lab}
          onChange={(patch) => updateKun({ lab: patch })}
        />
      </SettingsTabPanel>

      <SettingsTabPanel<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        tabId="autoPlanBuild"
        active={activePanel === 'autoPlanBuild'}
        className="[&>div]:mt-0"
      >
        <AutoPlanBuildSettingsPanel
          t={t}
          settings={form}
          value={lab}
          selectControlClass={selectControlClass}
          onChange={(patch) => updateKun({ lab: patch })}
        />
      </SettingsTabPanel>

      <SettingsTabPanel<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        tabId="computer"
        active={activePanel === 'computer'}
        className="[&>div]:mt-0"
      >
        <ComputerUseSettingsPanel
          t={t}
          value={computerUse}
          selectControlClass={selectControlClass}
          permissionRow={<ComputerUsePermissionRow t={t} />}
          onChange={updateComputerUse}
        />
      </SettingsTabPanel>

      <SettingsTabPanel<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        tabId="browser"
        active={activePanel === 'browser'}
        className="[&>div]:mt-0"
      >
        <BrowserUseSettingsPanel
          t={t}
          value={browserUse}
          capability={runtimeInfo?.capabilities?.browserUse}
          selectControlClass={selectControlClass}
          onChange={updateBrowserUse}
        />
      </SettingsTabPanel>

      <SettingsTabPanel<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        tabId="graph"
        active={activePanel === 'graph'}
        className="[&>div]:mt-0"
      >
        <GraphModeSettingsPanel
          t={t}
          value={graph}
          modelProviders={modelProviders}
          leadProviderId={activeProviderId}
          leadModel={kun.model}
          selectControlClass={selectControlClass}
          onChange={(patch) => updateKun({ graph: patch })}
        />
      </SettingsTabPanel>

      <SettingsTabPanel<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        tabId="ppt"
        active={activePanel === 'ppt'}
        className="[&>div]:mt-0"
      >
        <PptAgentSettingsPanel
          t={t}
          value={lab}
          modelProviders={modelProviders}
          leadProviderId={activeProviderId}
          leadModel={kun.model}
          imageGen={runtimeInfo?.capabilities?.imageGen
            ? {
                available: runtimeInfo.capabilities.imageGen.available === true,
                supportsReferenceEdit: runtimeInfo.capabilities.imageGen.supportsReferenceEdit === true,
                ...(runtimeInfo.capabilities.imageGen.reason ? { reason: runtimeInfo.capabilities.imageGen.reason } : {})
              }
            : undefined}
          selectControlClass={selectControlClass}
          onChange={(patch) => updateKun({ lab: patch })}
        />
      </SettingsTabPanel>
      <SettingsTabPanel<LaboratorySettingsPanel>
        baseId="laboratory-settings"
        tabId="projectBoard"
        active={activePanel === 'projectBoard'}
        className="[&>div]:mt-0"
      >
        <ProjectBoardSettingsPanel
          t={t}
          value={lab}
          onChange={(patch) => updateKun({ lab: patch })}
        />
      </SettingsTabPanel>
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
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('accessibility')}
            >
              {t('computerUseGrantAccessibility')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('screenRecording')}
            >
              {t('computerUseGrantScreenRecording')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
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

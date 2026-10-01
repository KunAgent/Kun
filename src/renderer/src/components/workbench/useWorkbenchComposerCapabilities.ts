import { useMemo } from 'react'
import type { ModelProviderModelProfileV1 } from '@shared/app-settings'
import { modelSupportsImageInput } from '@shared/app-settings-provider-core'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { CoreRuntimeInfoJson } from '../../agent/kun-contract'
import { resolveComposerContextWindowTokens } from '../../store/chat-store-helpers'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'

export type WorkbenchComposerCapabilitiesOptions = {
  route: string
  rightPanelMode: RightPanelMode | null
  activeClawModel?: string | null
  designAssistantModel: string
  resolvedDesignAssistantProviderId: string
  writeAssistantModel: string
  resolvedWriteAssistantProviderId: string
  composerModel: string
  composerProviderId?: string
  composerModelGroups: readonly ModelProviderModelGroup[]
  runtimeInfo: CoreRuntimeInfoJson | null
}

export type WorkbenchComposerCapabilities = {
  selectedComposerModel: string
  selectedComposerProviderId: string
  selectedModelSupportsImageInput: boolean
  selectedContextWindowTokens?: number
}

function normalizeModelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function modelProfileForGroup(
  group: ModelProviderModelGroup,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  const key = normalizeModelCapabilityKey(modelId)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[modelId.trim()]
  if (direct) return direct
  return Object.values(profiles).find((profile) =>
    profile.aliases?.some((alias) => normalizeModelCapabilityKey(alias) === key)
  )
}

export function modelProfileForComposerSelection(
  groups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId?: string
): ModelProviderModelProfileV1 | undefined {
  const selectedProviderId = providerId?.trim()
  if (selectedProviderId) {
    const selectedGroup = groups.find((group) => group.providerId === selectedProviderId)
    if (selectedGroup) {
      const profile = modelProfileForGroup(selectedGroup, modelId)
      if (profile) return profile
    }
  }
  for (const group of groups) {
    const profile = modelProfileForGroup(group, modelId)
    if (profile) return profile
  }
  return undefined
}

export function firstVisionCapableComposerModel(
  groups: readonly ModelProviderModelGroup[]
): { modelId: string; providerId?: string } | null {
  for (const group of groups) {
    for (const modelId of group.modelIds) {
      const profile = modelProfileForComposerSelection(groups, modelId, group.providerId)
      if (profile && modelSupportsImageInput(profile)) {
        const providerId = group.providerId.trim()
        return {
          modelId,
          ...(providerId ? { providerId } : {})
        }
      }
    }
  }
  return null
}

export function useWorkbenchComposerCapabilities({
  route,
  rightPanelMode,
  activeClawModel,
  designAssistantModel,
  resolvedDesignAssistantProviderId,
  writeAssistantModel,
  resolvedWriteAssistantProviderId,
  composerModel,
  composerProviderId = '',
  composerModelGroups,
  runtimeInfo
}: WorkbenchComposerCapabilitiesOptions): WorkbenchComposerCapabilities {
  const harnessId = useChatStore((state) => state.composerHarnessId ||
    state.threads.find((thread) => thread.id === state.activeThreadId)?.harnessId || 'kun')
  const credentialMode = useChatStore((state) => state.composerCredentialMode)
  const nativeModels = useHarnessStore((state) => state.models[harnessId]?.modelInfo)
  const selectedComposerModel =
    route === 'claw'
      ? activeClawModel ?? 'auto'
      : route === 'design'
        ? designAssistantModel
        : route === 'write' || rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi
          ? writeAssistantModel
          : composerModel
  const selectedComposerProviderId =
    route === 'design'
      ? resolvedDesignAssistantProviderId
      : route === 'write' || rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi
        ? resolvedWriteAssistantProviderId
        : route === 'chat'
          ? composerProviderId
          : ''
  const selectedModelSupportsImageInput = useMemo(() => {
    const selected = selectedComposerModel.trim()
    if ((route === 'chat' || route === 'ade') && harnessId !== 'kun' && credentialMode === 'native-login') {
      const model = !selected || selected === 'default' || selected === 'auto'
        ? nativeModels?.find((entry) => entry.isDefault) : nativeModels?.find((entry) => entry.id === selected)
      return model?.inputModalities?.includes('image') === true
    }
    const runtimeModel = runtimeInfo?.capabilities.model
    if (!selected || selected.toLowerCase() === 'auto') {
      return runtimeModel?.inputModalities.includes('image') === true
    }
    const profile = modelProfileForComposerSelection(
      composerModelGroups,
      selected,
      selectedComposerProviderId
    )
    if (profile) return modelSupportsImageInput(profile)
    if (runtimeModel && normalizeModelCapabilityKey(runtimeModel.id) === normalizeModelCapabilityKey(selected)) {
      return runtimeModel.inputModalities.includes('image')
    }
    return false
  }, [composerModelGroups, runtimeInfo, selectedComposerModel, selectedComposerProviderId, route, harnessId, credentialMode, nativeModels])
  const selectedContextWindowTokens = useMemo(() => {
    return resolveComposerContextWindowTokens(
      composerModelGroups,
      selectedComposerModel,
      selectedComposerProviderId
    )
  }, [composerModelGroups, selectedComposerModel, selectedComposerProviderId])

  return {
    selectedComposerModel,
    selectedComposerProviderId,
    selectedModelSupportsImageInput,
    selectedContextWindowTokens
  }
}

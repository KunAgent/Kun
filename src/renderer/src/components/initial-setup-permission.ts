import {
  KUN_TOOL_PERMISSION_MODES,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type KunToolPermissionMode
} from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { applyKunRuntimePatch } from '@shared/app-settings-kun-migration'
import type { InitialSetupSelection } from './initial-setup-save'
import { diffSettingsPatch } from './settings-utils'

/**
 * The guide saves in two writes. Main asks for consent before any change to
 * the execution permissions, and a declined prompt rejects the whole patch, so
 * the model, language and theme are saved first with the stored permissions
 * and only the permission change is sent through the prompt afterwards.
 */
export function withStoredExecutionSettings(form: AppSettingsV1, stored: AppSettingsV1): AppSettingsV1 {
  const { approvalPolicy, sandboxMode, approvalReviewer, approvalReview } = stored.agents.kun
  return {
    ...form,
    agents: { ...form.agents, kun: { ...form.agents.kun, approvalPolicy, sandboxMode, approvalReviewer, approvalReview } }
  }
}

export function initialSetupPermissionMode(settings: AppSettingsV1): KunToolPermissionMode {
  return kunToolPermissionModeFromSettings(getKunRuntimeSettings(settings))
}

/**
 * The second write, or null when nothing changes. An untouched selector that
 * already matches keeps a legacy approval/sandbox combination as it is.
 */
export function initialSetupPermissionPatch(
  saved: AppSettingsV1,
  selection: Pick<InitialSetupSelection, 'permissionMode' | 'permissionTouched'>
): AppSettingsPatch | null {
  const current = initialSetupPermissionMode(saved)
  const selected = KUN_TOOL_PERMISSION_MODES.includes(selection.permissionMode) ? selection.permissionMode : current
  if (selected === current && !selection.permissionTouched) return null
  const patch = diffSettingsPatch(saved, applyKunRuntimePatch(saved, kunToolPermissionModeSettings(selected)))
  return Object.keys(patch).length > 0 ? patch : null
}

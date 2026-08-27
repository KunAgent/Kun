import type { AppSettingsV1 } from '../shared/app-settings'
import type { DesktopStartupState } from './desktop-startup-state'
import type { resolveManagedRuntimeStartupTarget } from './runtime/managed-runtime-startup-attach'

type StartupGuiUpdaterModule = {
  showPostUpdateReleaseNotes: () => Promise<unknown>
}

export type PostWindowRuntimeStartupDeps = {
  startupState: DesktopStartupState
  reconcileBundledRuntimeAfterInstall: (settings: AppSettingsV1) => Promise<void>
  resolveManagedRuntimeStartupTarget: typeof resolveManagedRuntimeStartupTarget
  managedKunHostCanAutoStart: (settings: AppSettingsV1) => boolean
  ensureKunServeFreshOnStartup: (settings: AppSettingsV1) => Promise<AppSettingsV1>
  resolveRuntimeConnection: (settings: AppSettingsV1) => Promise<boolean>
  enqueueStartupSettingsApply: (settings: AppSettingsV1) => Promise<void>
  loadGuiUpdaterModule: () => Promise<StartupGuiUpdaterModule | null>
  showCliInstallPrompt: () => Promise<void>
  logWarn: (category: string, message: string, detail?: unknown) => void
}

export async function runPostWindowRuntimeStartup(
  initial: AppSettingsV1,
  deps: PostWindowRuntimeStartupDeps
): Promise<void> {
  deps.startupState.transition('runtime_handoff')
  await deps.reconcileBundledRuntimeAfterInstall(initial)

  deps.startupState.transition('runtime_starting')
  const current = await deps.resolveManagedRuntimeStartupTarget(
    initial,
    deps.managedKunHostCanAutoStart(initial),
    {
      ensure: deps.ensureKunServeFreshOnStartup,
      resolveExisting: deps.resolveRuntimeConnection
    }
  )
  if (current) await deps.enqueueStartupSettingsApply(current)

  deps.startupState.transition('ready')

  try {
    const updaterModule = await deps.loadGuiUpdaterModule()
    await updaterModule?.showPostUpdateReleaseNotes()
  } catch (error) {
    deps.logWarn('kun-gui updater', 'Failed to show post-update release notes.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }

  try {
    await deps.showCliInstallPrompt()
  } catch (error) {
    deps.logWarn('cli-install', 'CLI install prompt failed.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

export function createStartupSettingsApply(
  settings: AppSettingsV1,
  deps: {
    runtimeSupervisor: {
      enqueueSettingsApply: (
        operation: () => Promise<void>,
        onError: (error: unknown) => void,
        coalesceKey?: string
      ) => void
      waitForIdle: () => Promise<void>
    }
    settledRuntimeSettings: AppSettingsV1 | null
    applyManagedRuntimeSettingsHot: (
      settings: AppSettingsV1,
      source: string
    ) => Promise<'applied' | 'restart_required' | 'skipped' | 'superseded'>
    logWarn: (category: string, message: string, detail?: unknown) => void
  }
): Promise<void> {
  let settleApply!: () => void
  const applied = new Promise<void>((resolve) => {
    settleApply = resolve
  })
  deps.runtimeSupervisor.enqueueSettingsApply(async () => {
    try {
      const startupSettings = deps.settledRuntimeSettings ?? settings
      const result = await deps.applyManagedRuntimeSettingsHot(startupSettings, 'startup-settings')
      if (result === 'restart_required') {
        deps.logWarn(
          'startup-settings',
          'Kun attached successfully, but the configured default model could not be hot-applied.'
        )
      }
    } finally {
      settleApply()
    }
  }, (error) => {
    deps.logWarn('startup-settings', 'Kun startup settings apply failed', {
      message: error instanceof Error ? error.message : String(error)
    })
  }, 'startup-settings')
  return applied
}

import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { DesktopStartupState } from './desktop-startup-state'
import { runPostWindowRuntimeStartup } from './main-runtime-startup-flow'
import type { PostWindowRuntimeStartupDeps } from './main-runtime-startup-flow'

function settings(): AppSettingsV1 {
  return { agents: { kun: { autoStart: true } } } as AppSettingsV1
}

function createDeps(overrides: Partial<PostWindowRuntimeStartupDeps> = {}) {
  const events: string[] = []
  const startupState = new DesktopStartupState(() => null)
  const phases: string[] = []
  const track = startupState.transition.bind(startupState)
  startupState.transition = (next) => {
    track(next)
    phases.push(next)
  }
  return {
    events,
    phases,
    startupState,
    deps: {
      startupState,
      reconcileBundledRuntimeAfterInstall: vi.fn(async () => {
        events.push('handoff')
      }),
      resolveManagedRuntimeStartupTarget: vi.fn(async () => {
        events.push('attach')
        return settings()
      }) as PostWindowRuntimeStartupDeps['resolveManagedRuntimeStartupTarget'],
      managedKunHostCanAutoStart: () => true,
      ensureKunServeFreshOnStartup: vi.fn(async (value) => value),
      resolveRuntimeConnection: vi.fn(async () => true),
      enqueueStartupSettingsApply: vi.fn(async () => {
        events.push('settings')
      }),
      loadGuiUpdaterModule: vi.fn(async () => ({
        showPostUpdateReleaseNotes: vi.fn(async () => {
          events.push('release-notes')
        })
      })),
      showCliInstallPrompt: vi.fn(async () => {
        events.push('cli-prompt')
      }),
      logWarn: vi.fn(),
      ...overrides
    }
  }
}

describe('runPostWindowRuntimeStartup', () => {
  it('orders handoff, attach, initial settings apply, ready, and release notes', async () => {
    const { deps, events, phases, startupState } = createDeps()

    await runPostWindowRuntimeStartup(settings(), deps)

    expect(events).toEqual(['handoff', 'attach', 'settings', 'release-notes', 'cli-prompt'])
    expect(phases).toEqual(['runtime_handoff', 'runtime_starting', 'ready'])
    expect(startupState.phase).toBe('ready')
  })

  it('does not show release notes or reach ready when handoff fails', async () => {
    const error = new Error('handoff failed')
    const { deps, events, phases, startupState } = createDeps({
      reconcileBundledRuntimeAfterInstall: vi.fn(async () => {
        events.push('handoff')
        throw error
      })
    })

    await expect(runPostWindowRuntimeStartup(settings(), deps)).rejects.toBe(error)
    expect(events).toEqual(['handoff'])
    expect(phases).toEqual(['runtime_handoff'])
    expect(startupState.phase).toBe('runtime_handoff')
    expect(deps.resolveManagedRuntimeStartupTarget).not.toHaveBeenCalled()
  })

  it('reaches ready without a runtime target when auto-start is disabled and none exists', async () => {
    const { deps, events, startupState } = createDeps({
      managedKunHostCanAutoStart: () => false,
      resolveManagedRuntimeStartupTarget: vi.fn(async () => {
        events.push('attach')
        return null
      })
    })

    await runPostWindowRuntimeStartup(settings(), deps)

    expect(events).toEqual(['handoff', 'attach', 'release-notes', 'cli-prompt'])
    expect(deps.enqueueStartupSettingsApply).not.toHaveBeenCalled()
    expect(startupState.phase).toBe('ready')
  })

  it('keeps release-note and CLI prompt failures out of the ready transition', async () => {
    const { deps, startupState } = createDeps({
      loadGuiUpdaterModule: vi.fn(async () => {
        throw new Error('updater unavailable')
      }),
      showCliInstallPrompt: vi.fn(async () => {
        throw new Error('prompt unavailable')
      })
    })

    await runPostWindowRuntimeStartup(settings(), deps)

    expect(startupState.phase).toBe('ready')
    expect(deps.logWarn).toHaveBeenCalledTimes(2)
  })
})

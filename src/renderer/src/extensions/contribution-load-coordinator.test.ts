import { describe, expect, it } from 'vitest'
import {
  ExtensionContributionLoadCoordinator,
  sameExtensionContributionLoadContext
} from './contribution-load-coordinator'

describe('ExtensionContributionLoadCoordinator', () => {
  it('rejects a late workspace snapshot after the active workspace changes', () => {
    const coordinator = new ExtensionContributionLoadCoordinator()
    const workspaceA = { workspaceRoot: '/workspace/a', locale: 'zh-CN' }
    const workspaceB = { workspaceRoot: '/workspace/b', locale: 'zh-CN' }
    const requestA = coordinator.begin(workspaceA)

    coordinator.updateContext(workspaceB)

    expect(coordinator.isCurrent(requestA)).toBe(false)
    expect(coordinator.isCurrent(coordinator.begin(workspaceB))).toBe(true)
  })

  it('lets the newest same-context load win and invalidates snapshots after a locale change', () => {
    const coordinator = new ExtensionContributionLoadCoordinator()
    const english = { workspaceRoot: '/workspace', locale: 'en' }
    const first = coordinator.begin(english)
    const second = coordinator.begin(english)

    expect(coordinator.isCurrent(first)).toBe(false)
    expect(coordinator.isCurrent(second)).toBe(true)

    coordinator.updateContext({ ...english, locale: 'zh-CN' })
    expect(coordinator.isCurrent(second)).toBe(false)
  })

  it('does not let a stale manual load reactivate an earlier workspace', () => {
    const coordinator = new ExtensionContributionLoadCoordinator()
    const workspaceA = { workspaceRoot: '/workspace/a', locale: 'en' }
    const workspaceB = { workspaceRoot: '/workspace/b', locale: 'en' }
    coordinator.updateContext(workspaceA)
    coordinator.updateContext(workspaceB)

    const staleManualLoad = coordinator.begin(workspaceA)
    const currentLoad = coordinator.begin(workspaceB)

    expect(coordinator.isCurrent(staleManualLoad)).toBe(false)
    expect(coordinator.isCurrent(currentLoad)).toBe(true)
  })

  it('compares both workspace and locale for in-flight authorization guards', () => {
    expect(sameExtensionContributionLoadContext(
      { workspaceRoot: '/workspace', locale: 'en' },
      { workspaceRoot: '/workspace', locale: 'en' }
    )).toBe(true)
    expect(sameExtensionContributionLoadContext(
      { workspaceRoot: '/workspace', locale: 'en' },
      { workspaceRoot: '/workspace', locale: 'zh-CN' }
    )).toBe(false)
    expect(sameExtensionContributionLoadContext(
      { workspaceRoot: '/workspace/a', locale: 'en' },
      { workspaceRoot: '/workspace/b', locale: 'en' }
    )).toBe(false)
  })
})

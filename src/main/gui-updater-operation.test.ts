import { describe, expect, it } from 'vitest'
import { GuiUpdateOperationCoordinator } from './gui-updater-operation'

describe('GuiUpdateOperationCoordinator', () => {
  it('invalidates a stale download and refuses its install qualification', () => {
    const coordinator = new GuiUpdateOperationCoordinator()
    const stable = coordinator.begin('download', 'stable', 'https://updates.test/stable/')
    stable.targetVersion = '0.2.0'

    coordinator.invalidate()

    expect(coordinator.isCurrent(stable)).toBe(false)
    expect(coordinator.markDownloaded(stable, '0.2.0')).toBe(false)
    expect(coordinator.downloadedFor('frontier', 'https://updates.test/frontier/', '0.3.0')).toBe(false)
  })

  it('requires generation, channel, feed and version to match a download', () => {
    const coordinator = new GuiUpdateOperationCoordinator()
    const frontier = coordinator.begin('download', 'frontier', 'https://updates.test/frontier/')
    frontier.targetVersion = '0.3.0'

    expect(coordinator.markDownloaded(frontier, '0.3.0')).toBe(true)
    expect(coordinator.downloadedFor('frontier', 'https://updates.test/frontier/', '0.3.0')).toBe(true)
    expect(coordinator.downloadedFor('stable', 'https://updates.test/stable/', '0.3.0')).toBe(false)
    expect(coordinator.downloadedFor('frontier', 'https://updates.test/frontier/', '0.2.0')).toBe(false)
  })

  it('serializes updater work in FIFO order', async () => {
    const coordinator = new GuiUpdateOperationCoordinator()
    const steps: string[] = []
    let releaseFirst = (): void => undefined
    const first = coordinator.run(async () => {
      steps.push('first-start')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      steps.push('first-end')
    })
    const second = coordinator.run(async () => { steps.push('second') })

    await Promise.resolve()
    expect(steps).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(steps).toEqual(['first-start', 'first-end', 'second'])
  })
})

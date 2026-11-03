import { describe, expect, it, vi } from 'vitest'
import { createWorkflowCatalogRefresher } from './claw-schedule-workflow-catalog'

function createRefresher(overrides: Partial<Parameters<typeof createWorkflowCatalogRefresher>[0]> = {}) {
  const updateDescription = vi.fn()
  const logError = vi.fn()
  const readCatalog = vi.fn(async () => '')
  const refresher = createWorkflowCatalogRefresher({
    readCatalog,
    updateDescription,
    logError,
    intervalMs: 1_000,
    ...overrides
  })
  return { refresher, updateDescription, logError, readCatalog }
}

describe('createWorkflowCatalogRefresher', () => {
  it('retries a failed description update instead of remembering it as applied', async () => {
    const updateDescription = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('tools/list_changed failed')
      })
    const { refresher, logError } = createRefresher({
      readCatalog: async () => '\n\n- "daily report"',
      updateDescription
    })

    await refresher.refresh()
    expect(updateDescription).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledTimes(1)

    await refresher.refresh()
    expect(updateDescription).toHaveBeenCalledTimes(2)
  })

  it('stops overwriting the description once the catalog is unchanged', async () => {
    const { refresher, updateDescription } = createRefresher({
      readCatalog: async () => '\n\n- "daily report"'
    })

    await refresher.refresh()
    await refresher.refresh()

    expect(updateDescription).toHaveBeenCalledTimes(1)
  })

  it('logs a persistent bridge failure once and recovers silently', async () => {
    const readCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('bridge down'))
      .mockRejectedValueOnce(new Error('bridge down'))
      .mockResolvedValue('\n\n- "daily report"')
    const { refresher, logError, updateDescription } = createRefresher({ readCatalog })

    await refresher.refresh()
    await refresher.refresh()
    expect(logError).toHaveBeenCalledTimes(1)

    await refresher.refresh()
    expect(updateDescription).toHaveBeenCalledTimes(1)
  })

  it('never runs overlapping refreshes', async () => {
    let release: (() => void) | undefined
    const readCatalog = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('')
        })
    )
    const { refresher } = createRefresher({ readCatalog })

    const first = refresher.refresh()
    await refresher.refresh()
    expect(readCatalog).toHaveBeenCalledTimes(1)

    release?.()
    await first
  })

  it('never throws, so a failed refresh cannot crash the MCP server', async () => {
    const { refresher } = createRefresher({
      readCatalog: async () => {
        throw new Error('bridge down')
      }
    })

    await expect(refresher.refresh()).resolves.toBeUndefined()
  })
})

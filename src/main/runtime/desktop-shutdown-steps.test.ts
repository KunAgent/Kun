import { describe, expect, it } from 'vitest'
import { DesktopShutdownSteps } from './desktop-shutdown-steps'

describe('desktop shutdown steps', () => {
  it('continues independent cleanup after a consumer fails', async () => {
    const cleanup = new DesktopShutdownSteps()
    const observed: string[] = []
    await cleanup.group([
      { name: 'broken', run: async () => { throw new Error('consumer failed') } },
      { name: 'runtime', run: async () => { observed.push('runtime') } }
    ], cleanup.deadline(1000))
    await cleanup.settle({ name: 'manager', run: () => { observed.push('manager') } }, cleanup.deadline(1000))
    expect(observed).toEqual(['runtime', 'manager'])
    expect(() => cleanup.assertComplete()).toThrow('incomplete')
  })

  it('bounds a hung consumer without granting the next phase a new timeout budget', async () => {
    const cleanup = new DesktopShutdownSteps()
    expect(await cleanup.settle({ name: 'hung', run: () => new Promise(() => undefined) }, cleanup.deadline(5))).toBe(false)
    expect(cleanup.deadline(30)).toBe(cleanup.startedAt + 30)
    let stopped = false
    expect(await cleanup.settle({ name: 'manager', run: () => { stopped = true } }, cleanup.deadline(1000))).toBe(true)
    expect(stopped).toBe(true)
  })
})

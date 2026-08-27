import { describe, expect, it, vi } from 'vitest'
import { runMinimalUpdateProbe } from './update-health-probe'

vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(async () => undefined),
    getVersion: vi.fn(() => '0.2.0'),
    isPackaged: true
  }
}))

describe('runMinimalUpdateProbe', () => {
  const healthyInstall = { ok: true } as const

  it('loads the packaged runtime module without starting persistent services', async () => {
    const loadRuntimeAdapter = vi.fn(async () => ({}))

    await runMinimalUpdateProbe({
      isPackaged: () => true,
      executablePath: () => 'C:\\Program Files\\Kun\\Kun.exe',
      resourcesPath: () => 'C:\\Program Files\\Kun\\resources',
      inspectInstall: vi.fn(() => healthyInstall),
      loadRuntimeAdapter
    })

    expect(loadRuntimeAdapter).toHaveBeenCalledOnce()
  })

  it('rejects an incomplete candidate payload before loading runtime modules', async () => {
    const loadRuntimeAdapter = vi.fn(async () => ({}))

    await expect(runMinimalUpdateProbe({
      isPackaged: () => true,
      executablePath: () => 'C:\\Program Files\\Kun\\Kun.exe',
      resourcesPath: () => 'C:\\Program Files\\Kun\\resources',
      inspectInstall: vi.fn(() => ({ ok: false, missing: ['Kun runtime entry'] })),
      loadRuntimeAdapter
    })).rejects.toThrow('Kun runtime entry')

    expect(loadRuntimeAdapter).not.toHaveBeenCalled()
  })

  it('surfaces a packaged runtime module load failure', async () => {
    await expect(runMinimalUpdateProbe({
      isPackaged: () => true,
      executablePath: () => 'C:\\Program Files\\Kun\\Kun.exe',
      resourcesPath: () => 'C:\\Program Files\\Kun\\resources',
      inspectInstall: vi.fn(() => healthyInstall),
      loadRuntimeAdapter: vi.fn(async () => {
        throw new Error('runtime entry could not load')
      })
    })).rejects.toThrow('runtime entry could not load')
  })
})

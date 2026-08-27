import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { win32 as win32Path } from 'node:path'

const runMinimalUpdateProbe = vi.fn()
const mkdir = vi.fn()
const rename = vi.fn()
const writeFile = vi.fn()

vi.mock('electron', () => ({
  app: { getVersion: () => '0.2.0' }
}))
vi.mock('node:fs/promises', () => ({ mkdir, rename, writeFile }))
vi.mock('./update-health-probe', () => ({ runMinimalUpdateProbe }))

const originalPlatform = process.platform
let readUpdateHealthRequest: typeof import('./update-health-check').readUpdateHealthRequest
let runUpdateHealthCheck: typeof import('./update-health-check').runUpdateHealthCheck

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  runMinimalUpdateProbe.mockResolvedValue(undefined)
  mkdir.mockResolvedValue(undefined)
  rename.mockResolvedValue(undefined)
  writeFile.mockResolvedValue(undefined)
  ;({ readUpdateHealthRequest, runUpdateHealthCheck } = await import('./update-health-check'))
})

describe('update health request', () => {
  it('parses a complete tokenized request', () => {
    expect(readUpdateHealthRequest([
      'Kun.exe',
      '--kun-update-health-check=C:\\Temp\\health.json',
      '--kun-update-health-token=token-123',
      '--kun-update-target=C:\\Program Files\\Kun'
    ])).toEqual({
      resultPath: 'C:\\Temp\\health.json',
      token: 'token-123',
      target: 'C:\\Program Files\\Kun'
    })
  })

  it('returns null outside update health mode', () => {
    expect(readUpdateHealthRequest(['Kun.exe'])).toBeNull()
  })

  it('rejects an incomplete health request', () => {
    expect(() => readUpdateHealthRequest([
      'Kun.exe',
      '--kun-update-health-check=C:\\Temp\\health.json'
    ])).toThrow('incomplete')
  })

  it('runs only the side-effect-free probe', async () => {
    await runUpdateHealthCheck({
      resultPath: 'C:\\Temp\\health.json',
      token: 'token',
      target: win32Path.dirname(process.execPath)
    })

    expect(runMinimalUpdateProbe).toHaveBeenCalledOnce()
    expect(writeFile).toHaveBeenCalledOnce()
  })
})

afterAll(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
})

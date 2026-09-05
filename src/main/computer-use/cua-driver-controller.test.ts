import { describe, expect, it, vi } from 'vitest'
import type { CuaDriverLike } from '@trycua/cua-driver'
import { CuaDriverController } from './cua-driver-controller'

function fakeSdk(driver: Partial<CuaDriverLike>) {
  return {
    CuaDriver: { createConfigured: vi.fn(() => driver) },
    SessionPermissionMode: { Standard: 0 },
    ActionTarget: { Desktop: { new: vi.fn((inner) => ({ tag: 'Desktop', inner })) } },
    ClickButton: { Left: 0, Right: 1, Middle: 2 },
    ScrollBy: { Line: 0 },
    ScrollDirection: { Up: 0, Down: 1, Left: 2, Right: 3 }
  } as unknown as typeof import('@trycua/cua-driver')
}

describe('CuaDriverController readiness', () => {
  it('reports native metadata and keeps authorization at Standard', async () => {
    const driver = {
      isAvailable: vi.fn(() => true),
      metadata: vi.fn(async () => ({
        driverVersion: '0.22.2',
        contractVersion: '0.7.0',
        toolsListSchemaVersion: '1',
        capabilityVersion: '1',
        mcpProtocolVersion: '2025-06-18',
        pid: 1,
        embedded: true
      })),
      shutdown: vi.fn(async () => undefined)
    }
    const sdk = fakeSdk(driver)
    const controller = new CuaDriverController({ sdkLoader: async () => sdk })

    await expect(controller.ensureReady()).resolves.toEqual({
      available: true,
      backend: 'cua',
      driverVersion: '0.22.2',
      contractVersion: '0.7.0'
    })
    expect(sdk.CuaDriver.createConfigured).toHaveBeenCalledWith(expect.objectContaining({
      authorization: expect.objectContaining({
        allowedModes: [0],
        compatibilityMode: 0,
        unrestrictedAcknowledged: false
      })
    }))
    await controller.shutdown()
    expect(driver.shutdown).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the optional native SDK cannot load', async () => {
    const controller = new CuaDriverController({
      sdkLoader: async () => { throw new Error('native package missing') }
    })
    await expect(controller.ensureReady()).resolves.toMatchObject({
      available: false,
      backend: 'cua',
      reason: 'native package missing'
    })
  })
})

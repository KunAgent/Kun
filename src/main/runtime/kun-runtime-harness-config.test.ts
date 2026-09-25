import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  normalizeAppSettings
} from '../../shared/app-settings'
import { kunRuntimePatchSchema } from '../ipc/app-ipc-schemas/settings-model'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  buildManagedRuntimeHotApplyBody,
  syncGuiManagedKunConfig
} from './kun-runtime-config-service'
import {
  adeConfigForRuntime,
  harnessesConfigForRuntime
} from './kun-runtime-model-config'

const runtimeWith = (patch: Record<string, unknown>) => {
  const defaults = defaultKunRuntimeSettings()
  return normalizeAppSettings({
    provider: defaultModelProviderSettings(),
    agents: { kun: { ...defaults, ...patch } }
  } as AppSettingsV1).agents.kun
}

describe('harness/ade settings bridge', () => {
  it('generates byte-identical config for identical settings regardless of order', () => {
    const a = runtimeWith({
      harnesses: {
        disabledIds: ['cursor', 'claude-code'],
        binaryPaths: { cursor: '/opt/cursor', 'claude-code': '/opt/claude' },
        custom: [
          { id: 'zeta', displayName: 'Zeta', command: '/bin/zeta', args: ['--x'], env: { B: '2', A: '1' } },
          { id: 'alpha', displayName: 'Alpha', command: '/bin/alpha', args: [], env: {} }
        ],
        defaultPermissionMode: { cursor: 'ask', 'claude-code': 'default' },
        defaultHarnessId: 'claude-code'
      },
      ade: {
        enabled: true,
        harnessRouter: false,
        allowUnattendedFullAccess: true,
        limits: { softWorkers: 2, hardWorkers: 6 },
        approvedWorktreeConfigs: ['/repo/b', '/repo/a']
      }
    })
    const b = runtimeWith({
      harnesses: {
        disabledIds: ['claude-code', 'cursor'],
        binaryPaths: { 'claude-code': '/opt/claude', cursor: '/opt/cursor' },
        custom: [
          { id: 'alpha', displayName: 'Alpha', command: '/bin/alpha', args: [], env: {} },
          { id: 'zeta', displayName: 'Zeta', command: '/bin/zeta', args: ['--x'], env: { A: '1', B: '2' } }
        ],
        defaultPermissionMode: { 'claude-code': 'default', cursor: 'ask' },
        defaultHarnessId: 'claude-code'
      },
      ade: {
        approvedWorktreeConfigs: ['/repo/a', '/repo/b'],
        limits: { hardWorkers: 6, softWorkers: 2 },
        allowUnattendedFullAccess: true,
        harnessRouter: false,
        enabled: true
      }
    })
    const configA = {
      harnesses: harnessesConfigForRuntime(a.harnesses),
      ade: adeConfigForRuntime(a.ade)
    }
    const configB = {
      harnesses: harnessesConfigForRuntime(b.harnesses),
      ade: adeConfigForRuntime(b.ade)
    }
    expect(JSON.stringify(configA)).toBe(JSON.stringify(configB))
    expect(configA.ade).toMatchObject({
      enabled: true,
      harnessRouter: false,
      allowUnattendedFullAccess: true,
      limits: { softWorkers: 2, hardWorkers: 6 },
      approvedWorktreeConfigs: ['/repo/a', '/repo/b']
    })
    // GUI-only notifications never reach the runtime config.
    expect(configA.ade).not.toHaveProperty('notifications')
    expect((configA.harnesses.custom as Array<{ id: string }>).map((c) => c.id))
      .toEqual(['alpha', 'zeta'])
  })

  it('defaults missing sections to spec values', () => {
    const runtime = runtimeWith({})
    expect(adeConfigForRuntime(runtime.ade)).toMatchObject({
      enabled: false,
      harnessRouter: true,
      deterministicHandoff: true,
      managerMayApprove: false,
      allowUnattendedFullAccess: false,
      limits: { softWorkers: 4, hardWorkers: 8 },
      hibernation: { enabled: true, idleMinutes: 30 },
      stall: { structuredMinutes: 10, terminalMinutes: 20 },
      approvedWorktreeConfigs: []
    })
    expect(harnessesConfigForRuntime(runtime.harnesses)).toEqual({
      disabledIds: [],
      binaryPaths: {},
      custom: [],
      defaultPermissionMode: {},
      defaultHarnessId: 'kun'
    })
  })

  it('accepts a full harnesses/ade patch and rejects unknown subkeys', () => {
    const full = kunRuntimePatchSchema.safeParse({
      harnesses: {
        disabledIds: ['cursor'],
        binaryPaths: { cursor: '/usr/local/bin/cursor' },
        custom: [{ id: 'mine', displayName: 'Mine', command: '/bin/mine', args: ['--serve'], env: { PORT: '1' } }],
        defaultPermissionMode: { mine: 'default' },
        defaultHarnessId: 'mine'
      },
      ade: {
        enabled: true,
        managerModel: { providerId: 'p', model: 'm' },
        limits: { softWorkers: 3 },
        budget: null,
        notifications: { sound: false }
      }
    })
    expect(full.success).toBe(true)
    const unknownSubkey = kunRuntimePatchSchema.safeParse({
      ade: { enabled: true, notARealKey: true }
    })
    expect(unknownSubkey.success).toBe(false)
    const unknownHarnessSubkey = kunRuntimePatchSchema.safeParse({
      harnesses: { disabledIds: [], bogus: 1 }
    })
    expect(unknownHarnessSubkey.success).toBe(false)
  })

  it('writes both sections into config.json and survives sanitize of a broken ade section', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-config-ade-'))
    try {
      const runtime = runtimeWith({
        ade: { enabled: true, limits: { softWorkers: 2, hardWorkers: 3 } },
        harnesses: { disabledIds: ['cursor'] }
      })
      const config = await syncGuiManagedKunConfig(dataDir, runtime)
      expect(config.ade).toMatchObject({
        enabled: true,
        harnessRouter: true,
        limits: { softWorkers: 2, hardWorkers: 3 }
      })
      expect(config.harnesses?.disabledIds).toEqual(['cursor'])

      // Hand-corrupt the ade section; the next sync must sanitize, not throw.
      const configPath = join(dataDir, 'config.json')
      const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
      raw.ade = { enabled: 'yes', hibernation: { enabled: false, idleMinutes: 15 }, bogus: true }
      await writeFile(configPath, JSON.stringify(raw))
      const resynced = await syncGuiManagedKunConfig(dataDir, runtime)
      expect(resynced.ade?.enabled).toBe(true)
      expect(resynced.ade?.hibernation.idleMinutes).toBe(30)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('hot apply body carries both sections', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-config-ade-hot-'))
    try {
      const runtime = runtimeWith({ ade: { enabled: true } })
      const settings = normalizeAppSettings({
        provider: defaultModelProviderSettings(),
        agents: { kun: runtime }
      } as AppSettingsV1)
      const config = await syncGuiManagedKunConfig(dataDir, runtime)
      const body = buildManagedRuntimeHotApplyBody(settings, config)
      expect(body.ade?.enabled).toBe(true)
      expect(body.harnesses?.defaultHarnessId).toBe('kun')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

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
  it('preserves exact enabled profiles through IPC validation, normalization and runtime projection', () => {
    const profiles = [
      { harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'account-a' },
      { harnessId: 'codex', credentialMode: 'kun-gateway', providerId: 'provider-a' }
    ]
    const parsed = kunRuntimePatchSchema.parse({ harnesses: { enabledProfiles: profiles } })
    const runtime = runtimeWith(parsed)
    expect(harnessesConfigForRuntime(runtime.harnesses).enabledProfiles).toEqual(profiles)
    expect(kunRuntimePatchSchema.safeParse({ harnesses: { enabledProfiles: [
      { harnessId: 'pi', credentialMode: 'other' }
    ] } }).success).toBe(false)
  })

  it('generates byte-identical config for identical settings regardless of order', () => {
    const a = runtimeWith({
      harnesses: {
        disabledIds: ['cursor', 'claude-code'],
        binaryPaths: { cursor: '/opt/cursor', 'claude-code': '/opt/claude' },
        custom: [
          {
            id: 'zeta', displayName: 'Zeta', command: '/bin/zeta', args: ['--x'],
            env: { B: '2', A: '1' },
            secretEnv: [
              { name: 'Z_KEY', secretRef: 'cred_z' },
              { name: 'A_KEY', secretRef: 'cred_a' }
            ]
          },
          { id: 'alpha', displayName: 'Alpha', command: '/bin/alpha', args: [], env: {} }
        ],
        defaultPermissionMode: { cursor: 'ask', 'claude-code': 'default' },
        defaults: {
          'claude-code': {
            credentialMode: 'kun-gateway',
            providerId: 'deepseek',
            model: 'deepseek-chat',
            isolation: 'worktree'
          },
          cursor: { model: 'composer-2', permissionMode: 'ask' }
        },
        defaultHarnessId: 'claude-code',
        terminalAgents: [
          {
            id: 'zed-shell', displayName: 'Zed Shell', command: '/bin/zsh-agent',
            args: ['--tty'], taskFlag: '-i', resumeArgs: ['--resume'],
            hooks: 'claude-settings'
          },
          { id: 'plain-cli', displayName: 'Plain CLI', command: '/bin/plain', args: [] }
        ]
      },
      ade: {
        enabled: true,
        harnessRouter: false,
        allowUnattendedFullAccess: true,
        limits: { softWorkers: 2, hardWorkers: 6 }
      },
      worktrees: {
        sharedPaths: { '/repo/a': [{ path: '.env', mode: 'copy' }] }
      }
    })
    const b = runtimeWith({
      harnesses: {
        disabledIds: ['claude-code', 'cursor'],
        binaryPaths: { 'claude-code': '/opt/claude', cursor: '/opt/cursor' },
        custom: [
          { id: 'alpha', displayName: 'Alpha', command: '/bin/alpha', args: [], env: {} },
          {
            id: 'zeta', displayName: 'Zeta', command: '/bin/zeta', args: ['--x'],
            env: { A: '1', B: '2' },
            secretEnv: [
              { name: 'A_KEY', secretRef: 'cred_a' },
              { name: 'Z_KEY', secretRef: 'cred_z' }
            ]
          }
        ],
        defaultPermissionMode: { 'claude-code': 'default', cursor: 'ask' },
        defaults: {
          cursor: { permissionMode: 'ask', model: 'composer-2' },
          'claude-code': {
            isolation: 'worktree',
            model: 'deepseek-chat',
            providerId: 'deepseek',
            credentialMode: 'kun-gateway'
          }
        },
        defaultHarnessId: 'claude-code',
        terminalAgents: [
          { id: 'plain-cli', displayName: 'Plain CLI', command: '/bin/plain', args: [] },
          {
            id: 'zed-shell', displayName: 'Zed Shell', command: '/bin/zsh-agent',
            args: ['--tty'], hooks: 'claude-settings', taskFlag: '-i',
            resumeArgs: ['--resume']
          }
        ]
      },
      ade: {
        limits: { hardWorkers: 6, softWorkers: 2 },
        allowUnattendedFullAccess: true,
        harnessRouter: false,
        enabled: true
      },
      worktrees: {
        sharedPaths: { '/repo/a': [{ path: '.env', mode: 'copy' }] }
      }
    })
    const approved = [
      { repoRoot: '/repo/b', digest: 'd2', worktree: { branchPrefix: 'kun/' } },
      { repoRoot: '/repo/a', digest: 'd1', worktree: { branchPrefix: 'kun/' } }
    ]
    const configA = {
      harnesses: harnessesConfigForRuntime(a.harnesses),
      ade: adeConfigForRuntime(a.ade, {
        approvedWorktreeConfigs: approved,
        worktreeSharedPaths: a.worktrees?.sharedPaths
      })
    }
    const configB = {
      harnesses: harnessesConfigForRuntime(b.harnesses),
      ade: adeConfigForRuntime(b.ade, {
        approvedWorktreeConfigs: approved,
        worktreeSharedPaths: b.worktrees?.sharedPaths
      })
    }
    expect(JSON.stringify(configA)).toBe(JSON.stringify(configB))
    expect(configA.ade).toMatchObject({
      enabled: true,
      harnessRouter: false,
      allowUnattendedFullAccess: true,
      limits: { softWorkers: 2, hardWorkers: 6 },
      // Entries sort by repoRoot regardless of input order.
      approvedWorktreeConfigs: [
        { repoRoot: '/repo/a', digest: 'd1' },
        { repoRoot: '/repo/b', digest: 'd2' }
      ],
      worktreeSharedPaths: { '/repo/a': [{ path: '.env', mode: 'copy' }] }
    })
    // GUI-only notifications never reach the runtime config.
    expect(configA.ade).not.toHaveProperty('notifications')
    expect((configA.harnesses.custom as Array<{ id: string }>).map((c) => c.id))
      .toEqual(['alpha', 'zeta'])
    // P4-12: secretEnv refs emit sorted by name; values never appear — the
    // runtime config carries only opaque credential-store references.
    const zeta = (configA.harnesses.custom as Array<Record<string, unknown>>)
      .find((c) => c.id === 'zeta')
    expect(zeta?.secretEnv).toEqual([
      { name: 'A_KEY', secretRef: 'cred_a' },
      { name: 'Z_KEY', secretRef: 'cred_z' }
    ])
    // P4-13: terminalAgents emit sorted by id with a fixed field order, so
    // input key order never changes the generated config bytes.
    expect(configA.harnesses.terminalAgents).toEqual([
      { id: 'plain-cli', displayName: 'Plain CLI', command: '/bin/plain', args: [] },
      {
        id: 'zed-shell', displayName: 'Zed Shell', command: '/bin/zsh-agent',
        args: ['--tty'], taskFlag: '-i', resumeArgs: ['--resume'],
        hooks: 'claude-settings'
      }
    ])
    expect(JSON.stringify(configA)).not.toContain('api-key')
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
      approvedWorktreeConfigs: [],
      worktreeSharedPaths: {}
    })
    expect(harnessesConfigForRuntime(runtime.harnesses)).toEqual({
      enabledProfiles: [],
      disabledIds: [],
      binaryPaths: {},
      custom: [],
      defaults: {},
      defaultHarnessId: 'kun',
      agentOrder: [],
      terminalAgents: []
    })
  })

  it('migrates legacy defaultPermissionMode into defaults byte-identically', () => {
    // P4-11: a pre-migration settings file holding only
    // `defaultPermissionMode` must produce the same config as the migrated
    // `defaults[*].permissionMode` shape.
    const legacy = runtimeWith({
      harnesses: { defaultPermissionMode: { 'claude-code': 'plan', cursor: 'ask' } }
    })
    const migrated = runtimeWith({
      harnesses: {
        defaults: {
          cursor: { permissionMode: 'ask' },
          'claude-code': { permissionMode: 'plan' }
        }
      }
    })
    expect(JSON.stringify(harnessesConfigForRuntime(legacy.harnesses)))
      .toBe(JSON.stringify(harnessesConfigForRuntime(migrated.harnesses)))
    // And the explicit new shape wins over a stale legacy value.
    const both = runtimeWith({
      harnesses: {
        defaultPermissionMode: { cursor: 'ask' },
        defaults: { cursor: { permissionMode: 'edit', model: 'composer-2' } }
      }
    })
    expect(harnessesConfigForRuntime(both.harnesses).defaults).toEqual({
      cursor: { model: 'composer-2', permissionMode: 'edit' }
    })
  })

  it('carries agentOrder into runtime config and drops unknown harness ids', () => {
    const runtime = runtimeWith({
      harnesses: { agentOrder: ['claude-code', 'kun', 'not-a-harness' as never] }
    })
    expect(harnessesConfigForRuntime(runtime.harnesses).agentOrder)
      .toEqual(['claude-code', 'kun'])
  })

  it('accepts a full harnesses/ade patch and rejects unknown subkeys', () => {
    const full = kunRuntimePatchSchema.safeParse({
      harnesses: {
        disabledIds: ['cursor'],
        binaryPaths: { cursor: '/usr/local/bin/cursor' },
        custom: [{ id: 'mine', displayName: 'Mine', command: '/bin/mine', args: ['--serve'], env: { PORT: '1' } }],
        defaultPermissionMode: { mine: 'default' },
        defaults: {
          mine: { credentialMode: 'native-login', permissionMode: 'default', isolation: 'local' }
        },
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

it('preserves exact gateway bindings through normalized settings, hot apply and config serialization', async () => {
  const binding = { main: { routeId: 'daily-coding', allowedConnectionIds: ['provider-a', 'provider-b'] } }
  const profile = { harnessId: 'opencode', credentialMode: 'kun-gateway', gatewayBinding: binding }
  const runtime = runtimeWith(kunRuntimePatchSchema.parse({ harnesses: { enabledProfiles: [profile] } }))
  const projected = harnessesConfigForRuntime(runtime.harnesses)
  expect(projected.enabledProfiles).toEqual([profile])
  const profiles = projected.enabledProfiles as Array<{ gatewayBinding?: unknown }>
  expect(profiles[0]!.gatewayBinding).not.toBe(runtime.harnesses.enabledProfiles[0]!.gatewayBinding)
  const settings = normalizeAppSettings({ provider: defaultModelProviderSettings(), agents: { kun: runtime } } as AppSettingsV1)
  const body = buildManagedRuntimeHotApplyBody(settings, { harnesses: projected } as Parameters<typeof buildManagedRuntimeHotApplyBody>[1])
  expect(body.harnesses?.enabledProfiles).toEqual([profile])
})

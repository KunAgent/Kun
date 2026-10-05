import { describe, expect, it } from 'vitest'
import {
  defaultKunAdeSettings,
  defaultKunHarnessSettings,
  mergeKunAdeSettings,
  mergeKunHarnessSettings,
  mergeKunWorktreeSettings,
  normalizeKunAdeSettings,
  normalizeKunHarnessSettings,
  normalizeKunWorktreeSettings
} from './app-settings-kun-harness'

describe('normalizeKunHarnessSettings', () => {
  it('preserves independent OpenCode2 opt-in, binary, defaults and disabled state', () => {
    const settings = normalizeKunHarnessSettings({
      enabledProfiles: [{ harnessId: 'opencode2', credentialMode: 'native-login' }],
      disabledIds: ['opencode'], binaryPaths: { opencode2: '/selected/opencode2' },
      defaults: { opencode2: { model: 'openai/gpt-5.2' } },
      defaultHarnessId: 'opencode2', agentOrder: ['opencode2', 'opencode'],
      custom: [{ id: 'opencode2', command: '/wrong/custom' }]
    })
    expect(settings.enabledProfiles).toEqual([{ harnessId: 'opencode2', credentialMode: 'native-login' }])
    expect(settings.binaryPaths.opencode2).toBe('/selected/opencode2')
    expect(settings.defaults.opencode2?.model).toBe('openai/gpt-5.2')
    expect(settings.defaultHarnessId).toBe('opencode2')
    expect(settings.disabledIds).toEqual(['opencode'])
    expect(settings.agentOrder.slice(0, 2)).toEqual(['opencode2', 'opencode'])
    expect(settings.custom).toEqual([])
  })
  it('keeps Devin builtin settings and rejects a custom definition impersonating it', () => {
    const normalized = normalizeKunHarnessSettings({
      disabledIds: ['devin'],
      defaultHarnessId: 'devin',
      binaryPaths: { devin: '/opt/agents/devin' },
      custom: [{ id: 'devin', displayName: 'Other', command: '/bin/other' }],
      terminalAgents: [{ id: 'devin', displayName: 'Other', command: '/bin/other' }]
    })
    expect(normalized.disabledIds).toEqual(['devin'])
    expect(normalized.defaultHarnessId).toBe('devin')
    expect(normalized.binaryPaths).toEqual({ devin: '/opt/agents/devin' })
    expect(normalized.custom).toEqual([])
    expect(normalized.terminalAgents).toEqual([])
  })
  it('returns defaults for missing/garbage input', () => {
    expect(normalizeKunHarnessSettings(undefined)).toEqual(defaultKunHarnessSettings())
    expect(normalizeKunHarnessSettings('junk')).toEqual(defaultKunHarnessSettings())
  })

  it('drops non-builtin disabledIds, never disables kun, drops builtin-colliding custom ids', () => {
    const normalized = normalizeKunHarnessSettings({
      disabledIds: ['cursor', 'bogus-harness', 'kun'],
      custom: [
        { id: 'claude-code', displayName: 'X', command: '/bin/x', args: [], env: {} },
        { id: 'mine', displayName: 'Mine', command: '/bin/mine', args: ['-a'], env: { A: '1' } },
        { id: '', command: '/bin/none' },
        { id: 'mine2', displayName: 'No command' }
      ],
      defaultHarnessId: 'mine'
    })
    expect(normalized.disabledIds).toEqual(['cursor'])
    expect(normalized.custom).toEqual([
      { id: 'mine', displayName: 'Mine', command: '/bin/mine', args: ['-a'], env: { A: '1' } }
    ])
    expect(normalized.defaultHarnessId).toBe('mine')
  })

  // P4-12: secretEnv entries carry only opaque credential-store refs.
  it('normalizes custom secretEnv rows and drops malformed ones', () => {
    const normalized = normalizeKunHarnessSettings({
      custom: [{
        id: 'mine',
        displayName: 'Mine',
        command: '/bin/mine',
        secretEnv: [
          { name: 'GOOD_KEY', secretRef: 'cred_1' },
          { name: 'lowercase', secretRef: 'cred_2' },   // invalid env name
          { name: 'NO_REF', secretRef: '' },           // empty ref
          { name: 'GOOD_KEY', secretRef: 'cred_9' },   // last write wins
          'garbage',
          { name: 'TOOLONG', secretRef: 'x'.repeat(300) }
        ]
      }]
    })
    expect(normalized.custom[0]?.secretEnv).toEqual([
      { name: 'GOOD_KEY', secretRef: 'cred_9' }
    ])
  })

  it('omits secretEnv when the entry has none (keeps settings lean)', () => {
    const normalized = normalizeKunHarnessSettings({
      custom: [
        { id: 'a', displayName: 'A', command: '/bin/a', secretEnv: 'nope' },
        { id: 'b', displayName: 'B', command: '/bin/b' }
      ]
    })
    expect(normalized.custom[0]).not.toHaveProperty('secretEnv')
    expect(normalized.custom[1]).not.toHaveProperty('secretEnv')
  })

  it('merges patch fields over current', () => {
    const merged = mergeKunHarnessSettings(
      { ...defaultKunHarnessSettings(), disabledIds: ['cursor'] },
      { defaultHarnessId: 'antigravity' }
    )
    expect(merged.disabledIds).toEqual(['cursor'])
    expect(merged.defaultHarnessId).toBe('antigravity')
  })

  it('normalizes defaults entries and drops garbage (P4-11)', () => {
    const normalized = normalizeKunHarnessSettings({
      defaults: {
        'claude-code': {
          credentialMode: 'kun-gateway',
          providerId: ' deepseek ',
          model: 'deepseek-chat',
          permissionMode: 'plan',
          isolation: 'worktree',
          extra: 'dropped'
        },
        junk: { credentialMode: 'bogus', isolation: 'nope' },
        bad: 'not-an-object'
      }
    })
    expect(normalized.defaults).toEqual({
      'claude-code': {
        credentialMode: 'kun-gateway',
        providerId: 'deepseek',
        model: 'deepseek-chat',
        permissionMode: 'plan',
        isolation: 'worktree'
      }
    })
  })

  it('folds legacy defaultPermissionMode into defaults.permissionMode', () => {
    const normalized = normalizeKunHarnessSettings({
      defaultPermissionMode: { 'claude-code': 'plan', cursor: 'ask', '': 'x', nope: 5 }
    })
    expect('defaultPermissionMode' in normalized).toBe(false)
    expect(normalized.defaults).toEqual({
      'claude-code': { permissionMode: 'plan' },
      cursor: { permissionMode: 'ask' }
    })
  })

  it('explicit defaults.permissionMode wins over the legacy map', () => {
    const normalized = normalizeKunHarnessSettings({
      defaultPermissionMode: { 'claude-code': 'ask' },
      defaults: { 'claude-code': { permissionMode: 'plan', model: 'x' } }
    })
    expect(normalized.defaults['claude-code']).toEqual({
      model: 'x',
      permissionMode: 'plan'
    })
  })

  it('patch merge replaces the defaults map whole', () => {
    // Like binaryPaths/custom, a `defaults` patch is the full desired map —
    // omitting an entry deletes it. Callers (Agent Center) spread the current
    // map before dispatching.
    const current = normalizeKunHarnessSettings({
      defaults: { 'claude-code': { model: 'a', isolation: 'worktree' } }
    })
    const merged = mergeKunHarnessSettings(current, {
      defaults: { 'claude-code': { model: 'b' }, cursor: { credentialMode: 'provider' } }
    })
    expect(merged.defaults).toEqual({
      'claude-code': { model: 'b' },
      cursor: { credentialMode: 'provider' }
    })
  })

  it('patch merge still accepts a legacy defaultPermissionMode write', () => {
    const current = normalizeKunHarnessSettings({
      defaults: { cursor: { model: 'composer-2' } }
    })
    const merged = mergeKunHarnessSettings(current, {
      defaultPermissionMode: { 'claude-code': 'plan' }
    })
    // A direct legacy write seeds defaults while keeping existing entries.
    expect(merged.defaults).toEqual({
      cursor: { model: 'composer-2' },
      'claude-code': { permissionMode: 'plan' }
    })
  })

  it('legacy map alongside a defaults map still folds on load', () => {
    // The settings-load path merges the raw `harnesses` object as a patch.
    // A hand-edited or downgraded file can carry both shapes; the legacy
    // map fills entries that lack their own permissionMode.
    const merged = mergeKunHarnessSettings(defaultKunHarnessSettings(), {
      defaults: {
        cursor: { model: 'composer-2' },
        'claude-code': { permissionMode: 'plan' }
      },
      defaultPermissionMode: { cursor: 'ask', 'claude-code': 'default' }
    })
    expect(merged.defaults).toEqual({
      cursor: { model: 'composer-2', permissionMode: 'ask' },
      'claude-code': { permissionMode: 'plan' }
    })
  })

  // P4-13: terminalAgents join the catalog as `transport: 'terminal'` —
  // interactive CLIs that never host delegated turns.
  it('normalizes terminalAgents and drops collisions with builtin/custom ids', () => {
    const normalized = normalizeKunHarnessSettings({
      custom: [{ id: 'mine', displayName: 'Mine', command: '/bin/mine' }],
      terminalAgents: [
        {
          id: 'zed-shell', displayName: ' Zed Shell ', command: ' /bin/zsh-agent ',
          args: ['--tty', '', 'x'.repeat(2000)], taskFlag: '-i',
          resumeArgs: ['--resume'], hooks: 'claude-settings'
        },
        { id: 'kun', displayName: 'Fake', command: '/bin/fake' },
        { id: 'mine', displayName: 'Shadow', command: '/bin/shadow' },
        { id: 'zed-shell', displayName: 'Dup', command: '/bin/dup' },
        { id: 'no-cmd', displayName: 'No command' },
        'garbage',
        { id: 'quiet', command: '/bin/quiet', hooks: 'bogus-hook' }
      ]
    })
    expect(normalized.terminalAgents).toEqual([
      {
        id: 'zed-shell',
        displayName: 'Zed Shell',
        command: '/bin/zsh-agent',
        args: ['--tty'],
        taskFlag: '-i',
        resumeArgs: ['--resume'],
        hooks: 'claude-settings'
      },
      { id: 'quiet', displayName: 'quiet', command: '/bin/quiet', args: [] }
    ])
  })

  it('patch merge replaces terminalAgents whole', () => {
    const current = normalizeKunHarnessSettings({
      terminalAgents: [{ id: 'a', displayName: 'A', command: '/bin/a' }]
    })
    const merged = mergeKunHarnessSettings(current, {
      terminalAgents: [{ id: 'b', displayName: 'B', command: '/bin/b', args: [] }]
    })
    expect(merged.terminalAgents.map((entry) => entry.id)).toEqual(['b'])
    const untouched = mergeKunHarnessSettings(current, {})
    expect(untouched.terminalAgents.map((entry) => entry.id)).toEqual(['a'])
  })
})

describe('normalizeKunAdeSettings', () => {
  it('returns defaults for missing input', () => {
    expect(normalizeKunAdeSettings(undefined)).toEqual(defaultKunAdeSettings())
  })

  it('clamps worker limits and idle minutes to schema bounds', () => {
    const normalized = normalizeKunAdeSettings({
      enabled: true,
      limits: { softWorkers: 0, hardWorkers: 3 },
      hibernation: { enabled: true, idleMinutes: 99_999 }
    })
    expect(normalized.limits).toEqual({ softWorkers: 1, hardWorkers: 3 })
    // hardWorkers is clamped to >= softWorkers.
    expect(normalized.limits.hardWorkers).toBeGreaterThanOrEqual(normalized.limits.softWorkers)
    expect(normalized.hibernation.idleMinutes).toBe(1_440)
  })

  it('hardWorkers never goes below the effective softWorkers', () => {
    const normalized = normalizeKunAdeSettings({
      limits: { softWorkers: 10, hardWorkers: 2 }
    })
    expect(normalized.limits).toEqual({ softWorkers: 10, hardWorkers: 10 })
  })

  it('drops malformed managerModel and budget but keeps valid ones', () => {
    expect(normalizeKunAdeSettings({ managerModel: { providerId: '', model: 'm' } }).managerModel)
      .toBeUndefined()
    const normalized = normalizeKunAdeSettings({
      managerModel: { providerId: 'p', model: 'm' },
      budget: { softTokens: 1_000, hardTokens: -5 }
    })
    expect(normalized.managerModel).toEqual({ providerId: 'p', model: 'm' })
    expect(normalized.budget).toEqual({ softTokens: 1_000 })
  })

  it('merge clears budget on null and deep-merges nested groups', () => {
    const current = normalizeKunAdeSettings({
      enabled: true,
      budget: { softTokens: 5, hardTokens: 9 },
      notifications: { sound: false }
    })
    const cleared = mergeKunAdeSettings(current, { budget: null })
    expect(cleared.budget).toBeUndefined()
    const merged = mergeKunAdeSettings(current, {
      limits: { hardWorkers: 12 },
      notifications: { keepAwake: true }
    })
    expect(merged.limits).toEqual({ softWorkers: 4, hardWorkers: 12 })
    expect(merged.notifications.sound).toBe(false)
    expect(merged.notifications.keepAwake).toBe(true)
  })
})

describe('normalizeKunWorktreeSettings', () => {
  it('keeps valid sharedPaths entries and drops malformed ones', () => {
    const normalized = normalizeKunWorktreeSettings({
      sharedPaths: {
        '/repo/a': [
          { path: '.env.local', mode: 'copy' },
          { path: 'deps', mode: 'symlink' },
          { path: '', mode: 'copy' },
          { path: 'x', mode: 'bogus' },
          'junk'
        ],
        '': [{ path: 'x', mode: 'copy' }],
        '/repo/b': 'not-a-list'
      }
    })
    expect(normalized.sharedPaths).toEqual({
      '/repo/a': [
        { path: '.env.local', mode: 'copy' },
        { path: 'deps', mode: 'symlink' }
      ]
    })
  })

  it('merge replaces sharedPaths wholesale and defaults missing input', () => {
    const current = normalizeKunWorktreeSettings({
      sharedPaths: { '/repo/a': [{ path: 'deps' }] }
    })
    expect(current.sharedPaths['/repo/a']).toEqual([{ path: 'deps', mode: 'symlink' }])
    const merged = mergeKunWorktreeSettings(current, {
      sharedPaths: { '/repo/b': [{ path: '.env', mode: 'copy' }] }
    })
    expect(merged.sharedPaths).toEqual({ '/repo/b': [{ path: '.env', mode: 'copy' }] })
    expect(mergeKunWorktreeSettings(current, undefined).sharedPaths['/repo/a']).toHaveLength(1)
  })
})

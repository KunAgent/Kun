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

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
    expect(settings.providers).toEqual({ opencode2: { command: '/selected/opencode2' } })
    expect(settings.defaults.opencode2?.model).toBe('openai/gpt-5.2')
    expect(settings.defaultHarnessId).toBe('opencode2')
    expect(settings.disabledIds).toEqual(['opencode'])
    expect(settings.agentOrder.slice(0, 2)).toEqual(['opencode2', 'opencode'])
    expect(settings).not.toHaveProperty('binaryPaths')
    expect(settings).not.toHaveProperty('custom')
    expect(settings).not.toHaveProperty('terminalAgents')
  })
  it('keeps Devin builtin settings and rejects a user Agent impersonating it', () => {
    const normalized = normalizeKunHarnessSettings({
      disabledIds: ['devin'],
      defaultHarnessId: 'devin',
      binaryPaths: { devin: '/opt/agents/devin' },
      custom: [{ id: 'devin', displayName: 'Other', command: '/bin/other' }],
      terminalAgents: [{ id: 'devin', displayName: 'Other', command: '/bin/other' }],
      providers: { devin: { extends: 'acp', label: 'Other', args: { mode: 'append', values: ['--x'] } } }
    })
    expect(normalized.disabledIds).toEqual(['devin'])
    expect(normalized.defaultHarnessId).toBe('devin')
    // A builtin id only keeps its launch patch; `extends` cannot rebind it.
    expect(normalized.providers).toEqual({ devin: { label: 'Other', args: { mode: 'append', values: ['--x'] }, command: '/opt/agents/devin' } })
  })
  it('returns defaults for missing/garbage input', () => {
    expect(normalizeKunHarnessSettings(undefined)).toEqual(defaultKunHarnessSettings())
    expect(normalizeKunHarnessSettings('junk')).toEqual(defaultKunHarnessSettings())
  })

  it('drops non-builtin disabledIds, never disables kun, folds valid custom Agents', () => {
    const normalized = normalizeKunHarnessSettings({
      disabledIds: ['cursor', 'bogus-harness', 'kun'],
      custom: [
        { id: 'claude-code', displayName: 'X', command: '/bin/x', args: [], env: {} },
        { id: 'mine', displayName: 'Mine', command: '/bin/mine', args: ['-a'], env: { A: '1', lower: 'dropped' } },
        { id: '', command: '/bin/none' },
        { id: 'mine2', displayName: 'No command' },
        { id: 'Bad_Id', displayName: 'Bad', command: '/bin/bad' }
      ],
      defaultHarnessId: 'mine',
      agentOrder: ['mine', 'bad-id']
    })
    expect(normalized.disabledIds).toEqual(['cursor'])
    expect(normalized.providers).toEqual({
      mine: { extends: 'acp', label: 'Mine', command: '/bin/mine', args: { mode: 'replace', values: ['-a'] }, env: { A: '1' } }
    })
    expect(normalized.defaultHarnessId).toBe('mine')
    expect(normalized.agentOrder).toEqual(['mine'])
  })

  // secretEnv entries carry only opaque credential-store refs.
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
    expect(normalized.providers.mine?.secretEnv).toEqual([
      { name: 'GOOD_KEY', secretRef: 'cred_9' }
    ])
  })

  it('omits secretEnv when the entry has none (keeps settings lean)', () => {
    const normalized = normalizeKunHarnessSettings({
      custom: [
        { id: 'aa', displayName: 'A', command: '/bin/a', secretEnv: 'nope' },
        { id: 'bb', displayName: 'B', command: '/bin/b' }
      ]
    })
    expect(normalized.providers.aa).not.toHaveProperty('secretEnv')
    expect(normalized.providers.bb).not.toHaveProperty('secretEnv')
  })

  it('keeps derived Agents and builtin patches, drops entries that cannot launch', () => {
    const normalized = normalizeKunHarnessSettings({ providers: {
      'opencode-fork': { extends: 'opencode', label: ' Fork '.repeat(20), command: 'fork' },
      'generic-no-command': { extends: 'acp' },
      orphan: { command: '/bin/orphan' },
      'unknown-base': { extends: 'nowhere', command: '/bin/x' },
      codex: { env: { CODEX_HOME: '/tmp/codex' } },
      junk: 'nope'
    } })
    expect(Object.keys(normalized.providers)).toEqual(['opencode-fork', 'codex'])
    expect(normalized.providers['opencode-fork']?.label).toHaveLength(64)
    expect(normalized.providers.codex).toEqual({ env: { CODEX_HOME: '/tmp/codex' } })
  })

  it('merges patch fields over current', () => {
    const merged = mergeKunHarnessSettings(
      { ...defaultKunHarnessSettings(), disabledIds: ['cursor'] },
      { defaultHarnessId: 'antigravity' }
    )
    expect(merged.disabledIds).toEqual(['cursor'])
    expect(merged.defaultHarnessId).toBe('antigravity')
  })

  it('normalizes defaults entries and drops garbage', () => {
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

  // terminal agents join the catalog as `transport: 'terminal'` —
  // interactive CLIs that never host delegated turns.
  it('folds terminalAgents and drops collisions with builtin/custom ids', () => {
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
      ],
      agentOrder: ['zed-shell', 'mine']
    })
    expect(normalized.providers).toEqual({
      mine: { extends: 'acp', label: 'Mine', command: '/bin/mine' },
      'zed-shell': {
        extends: 'terminal', label: 'Zed Shell', command: '/bin/zsh-agent',
        args: { mode: 'replace', values: ['--tty'] },
        terminal: { taskFlag: '-i', resumeArgs: ['--resume'], hooks: 'claude-settings' }
      },
      quiet: { extends: 'terminal', label: 'quiet', command: '/bin/quiet' }
    })
    // Terminal agents never host turns, so they cannot rank as workers.
    expect(normalized.agentOrder).toEqual(['mine'])
  })

  it('patch merge replaces providers whole', () => {
    const current = normalizeKunHarnessSettings({
      providers: { aa: { extends: 'terminal', command: '/bin/a' } }
    })
    const merged = mergeKunHarnessSettings(current, {
      providers: { bb: { extends: 'terminal', command: '/bin/b' } }
    })
    expect(Object.keys(merged.providers)).toEqual(['bb'])
    const untouched = mergeKunHarnessSettings(current, {})
    expect(Object.keys(untouched.providers)).toEqual(['aa'])
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

  it('clamps the no-response dispatch window and keeps 0 as "always wait"', () => {
    expect(defaultKunAdeSettings().dispatch).toEqual({ autoStartSeconds: 60, autoStartWhenConfirmationRequired: true, preferencePrompt: '' })
    expect(normalizeKunAdeSettings({ dispatch: { autoStartSeconds: 99_999 } }).dispatch.autoStartSeconds).toBe(3_600)
    expect(normalizeKunAdeSettings({ dispatch: { autoStartSeconds: 0, autoStartWhenConfirmationRequired: false } }).dispatch)
      .toEqual({ autoStartSeconds: 0, autoStartWhenConfirmationRequired: false, preferencePrompt: '' })
    const merged = mergeKunAdeSettings(normalizeKunAdeSettings({ dispatch: { autoStartSeconds: 180 } }),
      { dispatch: { autoStartWhenConfirmationRequired: false } })
    expect(merged.dispatch).toEqual({ autoStartSeconds: 180, autoStartWhenConfirmationRequired: false, preferencePrompt: '' })
    expect(normalizeKunAdeSettings({ dispatch: { preferencePrompt: `UI: claude-code\n${'x'.repeat(2_100)}` } }).dispatch.preferencePrompt)
      .toHaveLength(2_000)
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

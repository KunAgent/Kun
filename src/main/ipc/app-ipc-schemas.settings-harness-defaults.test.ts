import {
  describe,
  expect,
  it
} from 'vitest'
import { settingsPatchSchema } from './app-ipc-schemas'

describe('app-ipc-schemas harnesses.defaults (P4-11)', () => {
  const patch = (harnesses: unknown) => ({ agents: { kun: { harnesses } } })

  it('accepts a full per-harness defaults entry', () => {
    const parsed = settingsPatchSchema.parse(patch({
      defaults: {
        'claude-code': {
          credentialMode: 'kun-gateway',
          providerId: 'deepseek',
          model: 'deepseek-chat',
          permissionMode: 'plan',
          isolation: 'worktree'
        },
        cursor: { model: 'composer-2' }
      }
    }))
    expect(parsed.agents?.kun?.harnesses?.defaults?.['claude-code']).toEqual({
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      permissionMode: 'plan',
      isolation: 'worktree'
    })
  })

  it('still accepts the legacy defaultPermissionMode map', () => {
    const parsed = settingsPatchSchema.parse(patch({
      defaultPermissionMode: { 'claude-code': 'plan' }
    }))
    expect(parsed.agents?.kun?.harnesses?.defaultPermissionMode).toEqual({
      'claude-code': 'plan'
    })
  })

  it('rejects unknown keys and bad enum values inside a defaults entry', () => {
    expect(() =>
      settingsPatchSchema.parse(patch({
        defaults: { 'claude-code': { mystery: true } }
      }))
    ).toThrow(/Unrecognized key/)
    expect(() =>
      settingsPatchSchema.parse(patch({
        defaults: { 'claude-code': { credentialMode: 'bogus' } }
      }))
    ).toThrow()
    expect(() =>
      settingsPatchSchema.parse(patch({
        defaults: { 'claude-code': { isolation: 'container' } }
      }))
    ).toThrow()
  })
})

describe('app-ipc-schemas harnesses.providers', () => {
  const patch = (harnesses: unknown) => ({ agents: { kun: { harnesses } } })

  it('accepts launch overrides, derived and terminal Agents', () => {
    const providers = {
      codex: { command: '/opt/codex', args: { mode: 'append', values: ['--verbose'] }, env: { CODEX_X: '1' } },
      'opencode-fork': { extends: 'opencode', label: 'Fork', command: 'fork' },
      'zed-shell': { extends: 'terminal', label: 'Zed Shell', command: '/bin/zsh-agent',
        args: { mode: 'replace', values: ['--tty'] }, terminal: { taskFlag: '-i', resumeArgs: ['--resume'], hooks: 'claude-settings' } }
    }
    expect(settingsPatchSchema.parse(patch({ providers })).agents?.kun?.harnesses?.providers).toEqual(providers)
  })

  it('rejects unknown fields, bad env names and the retired legacy fields', () => {
    expect(() => settingsPatchSchema.parse(patch({ providers: { x: { command: '/bin/x', mystery: true } } })))
      .toThrow(/Unrecognized key/)
    expect(() => settingsPatchSchema.parse(patch({ providers: { x: { env: { lower: '1' } } } }))).toThrow()
    expect(() => settingsPatchSchema.parse(patch({ providers: { x: { terminal: { hooks: 'bogus' } } } }))).toThrow()
    expect(() => settingsPatchSchema.parse(patch({ terminalAgents: [] }))).toThrow(/Unrecognized key/)
    expect(() => settingsPatchSchema.parse(patch({ binaryPaths: {} }))).toThrow(/Unrecognized key/)
  })
})

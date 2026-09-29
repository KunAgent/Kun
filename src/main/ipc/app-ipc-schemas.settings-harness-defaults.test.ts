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

describe('app-ipc-schemas harnesses.terminalAgents (P4-13)', () => {
  const patch = (harnesses: unknown) => ({ agents: { kun: { harnesses } } })

  it('accepts a full terminal agent entry', () => {
    const parsed = settingsPatchSchema.parse(patch({
      terminalAgents: [{
        id: 'zed-shell',
        displayName: 'Zed Shell',
        command: '/bin/zsh-agent',
        args: ['--tty'],
        taskFlag: '-i',
        resumeArgs: ['--resume'],
        hooks: 'claude-settings'
      }]
    }))
    expect(parsed.agents?.kun?.harnesses?.terminalAgents?.[0]).toEqual({
      id: 'zed-shell',
      displayName: 'Zed Shell',
      command: '/bin/zsh-agent',
      args: ['--tty'],
      taskFlag: '-i',
      resumeArgs: ['--resume'],
      hooks: 'claude-settings'
    })
  })

  it('rejects entries without a command and unknown hooks values', () => {
    expect(() =>
      settingsPatchSchema.parse(patch({ terminalAgents: [{ id: 'x' }] }))
    ).toThrow()
    expect(() =>
      settingsPatchSchema.parse(patch({
        terminalAgents: [{ id: 'x', command: '/bin/x', hooks: 'bogus' }]
      }))
    ).toThrow()
    expect(() =>
      settingsPatchSchema.parse(patch({
        terminalAgents: [{ id: 'x', command: '/bin/x', mystery: true }]
      }))
    ).toThrow(/Unrecognized key/)
  })
})

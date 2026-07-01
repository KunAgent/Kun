import { describe, expect, it } from 'vitest'
import { buildRemotePrecheckPlan, describeRemoteTarget, isSshTarget } from './remote-target.js'
import { supportsControlMaster, isAutoReplaySafeOnReconnect } from './ssh-control.js'

describe('remote-target', () => {
  it('identifies ssh targets', () => {
    expect(isSshTarget({ kind: 'local' })).toBe(false)
    expect(isSshTarget({ kind: 'ssh', alias: 'prod' })).toBe(true)
  })

  it('describes a target as alias · dir · branch', () => {
    expect(describeRemoteTarget({
      target: { kind: 'ssh', alias: 'prod', remoteDir: '/srv/api' },
      status: 'connected',
      branch: 'main'
    })).toBe('prod · /srv/api · main')
    expect(describeRemoteTarget({ target: { kind: 'local' }, status: 'connected' })).toBe('local')
  })

  it('builds a read-only precheck plan scoped to the remote dir', () => {
    const plan = buildRemotePrecheckPlan('/srv/api')
    expect(plan.every((step) => step.writes === false)).toBe(true)
    expect(plan.map((step) => step.id)).toEqual(['pwd', 'uname', 'git-status', 'git-root', 'toolcheck'])
    expect(plan.find((step) => step.id === 'git-status')?.command).toContain("git -C '/srv/api'")
  })
})

describe('ssh-control', () => {
  it('disables ControlMaster on Windows only', () => {
    expect(supportsControlMaster('win32')).toBe(false)
    expect(supportsControlMaster('linux')).toBe(true)
    expect(supportsControlMaster('darwin')).toBe(true)
  })

  it('only auto-replays read-only commands on reconnect', () => {
    expect(isAutoReplaySafeOnReconnect({ writes: false })).toBe(true)
    expect(isAutoReplaySafeOnReconnect({ writes: true })).toBe(false)
  })
})

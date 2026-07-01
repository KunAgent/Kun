import { describe, expect, it, vi } from 'vitest'
import { executeRemoteCommand } from './remote-command-tool.js'
import type { RemoteExecutionHandle } from '../../ports/remote-execution.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

function handle(overrides: Partial<RemoteExecutionHandle> = {}): RemoteExecutionHandle {
  return {
    target: { kind: 'ssh', alias: 'prod', remoteDir: '/srv/api' },
    runMode: 'develop',
    production: false,
    status: () => 'connected',
    describe: () => ({ target: { kind: 'ssh', alias: 'prod', remoteDir: '/srv/api' }, status: 'connected' }),
    guardCommand: () => ({ decision: 'allow', reasons: ['ok'] }),
    guardPath: () => ({ decision: 'allow', reasons: ['ok'] }),
    guardFile: () => ({ decision: 'allow', reasons: ['ok'] }),
    exec: vi.fn(async (command) => ({
      command, stdout: 'remote-out', stderr: '', exitCode: 0, signal: null, durationMs: 7, timedOut: false
    })),
    ...overrides
  }
}

function context(awaitApproval: ToolHostContext['awaitApproval'] = vi.fn(async () => 'allow' as const)): ToolHostContext {
  return {
    threadId: 't1',
    turnId: 'turn1',
    workspace: '/ws',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval
  }
}

describe('executeRemoteCommand', () => {
  it('runs on the remote and tags the result with target/host/remoteDir', async () => {
    const result = await executeRemoteCommand({ handle: handle(), command: 'ls', timeoutSeconds: 30, context: context() })
    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({ target: 'ssh', host: 'prod', remoteDir: '/srv/api', stdout: 'remote-out', exitCode: 0 })
  })

  it('blocks a denied command without executing it', async () => {
    const exec = vi.fn()
    const result = await executeRemoteCommand({
      handle: handle({ guardCommand: () => ({ decision: 'deny', reasons: ['not allowed in observe mode'] }), exec }),
      command: 'rm -rf /',
      timeoutSeconds: 30,
      context: context()
    })
    expect(exec).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ decision: 'deny' })
  })

  it('requests approval BEFORE executing a confirm-class command', async () => {
    const order: string[] = []
    const awaitApproval = vi.fn(async () => { order.push('approval'); return 'allow' as const })
    const exec = vi.fn(async (command: string) => { order.push('exec'); return { command, stdout: 'ok', stderr: '', exitCode: 0, signal: null, durationMs: 1, timedOut: false } })
    const result = await executeRemoteCommand({
      handle: handle({ guardCommand: () => ({ decision: 'confirm', reasons: ['irreversible'] }), exec }),
      command: 'kubectl delete pod x',
      timeoutSeconds: 30,
      context: context(awaitApproval)
    })
    expect(order).toEqual(['approval', 'exec'])
    expect(result.output).toMatchObject({ riskConfirmed: true })
  })

  it('does NOT execute a confirm-class command when approval is denied', async () => {
    const exec = vi.fn()
    const result = await executeRemoteCommand({
      handle: handle({ guardCommand: () => ({ decision: 'confirm', reasons: ['production restart'] }), exec }),
      command: 'systemctl restart api',
      timeoutSeconds: 30,
      context: context(vi.fn(async () => 'deny' as const))
    })
    expect(exec).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ approved: false })
  })

  it('marks a non-zero exit as an error', async () => {
    const result = await executeRemoteCommand({
      handle: handle({ exec: vi.fn(async (command) => ({ command, stdout: '', stderr: 'boom', exitCode: 1, signal: null, durationMs: 2, timedOut: false })) }),
      command: 'false',
      timeoutSeconds: 30,
      context: context()
    })
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ exitCode: 1, stderr: 'boom' })
  })

  it('preserves executor truncation metadata without requiring an artifact store', async () => {
    const big = 'x'.repeat(20_000)
    const result = await executeRemoteCommand({
      handle: handle({ exec: vi.fn(async (command) => ({ command, stdout: big, stderr: '', exitCode: 0, signal: null, durationMs: 5, timedOut: false, truncated: true })) }),
      command: 'cat huge.log',
      timeoutSeconds: 30,
      context: context()
    })
    expect(result.output).toMatchObject({ stdout: big, truncated: true })
  })
})

import type { RemoteExecutionHandle, RemoteExecOptions, RemoteExecResult, RemoteFileOperation, RemoteGuardOutcome } from '../ports/remote-execution.js'
import type { ThreadRemoteTarget } from '../contracts/threads.js'
import { evaluateRemoteCommand } from './remote-run-mode.js'
import { classifyRemoteCommand } from './remote-command-risk.js'
import { evaluateRemotePathAccess, type RemoteProfile } from './remote-profile.js'
import { SshExecutor, type SshSpawnFn } from './ssh-executor.js'
import { RemoteConnection } from './remote-connection.js'
import type { RemoteConnectionStatus, RemoteTarget, RemoteTargetDescriptor } from './remote-target.js'

export type SshRemoteExecutionHandleOptions = {
  binding: ThreadRemoteTarget
  spawn?: SshSpawnFn
}

export class SshRemoteExecutionHandle implements RemoteExecutionHandle {
  readonly target: RemoteTarget
  readonly runMode: ThreadRemoteTarget['runMode']
  readonly production: boolean
  private readonly executor: SshExecutor
  private readonly connection: RemoteConnection
  private readonly profile: Pick<RemoteProfile, 'protectedPaths'>

  constructor(options: SshRemoteExecutionHandleOptions) {
    const binding = options.binding
    this.target = {
      kind: 'ssh',
      alias: binding.alias,
      ...(binding.host ? { host: binding.host } : {}),
      ...(binding.remoteDir ? { remoteDir: binding.remoteDir } : {})
    }
    this.runMode = binding.runMode
    this.production = binding.production
    this.profile = { protectedPaths: binding.protectedPaths }
    this.executor = new SshExecutor({
      alias: binding.alias,
      ...(binding.remoteDir ? { remoteDir: binding.remoteDir } : {}),
      ...(options.spawn ? { spawn: options.spawn } : {})
    })
    this.connection = new RemoteConnection({ executor: this.executor })
  }

  status(): RemoteConnectionStatus {
    return this.connection.status()
  }

  describe(): RemoteTargetDescriptor {
    return {
      target: this.target,
      status: this.connection.status(),
      ...(this.connection.latencyMs() !== undefined ? { latencyMs: this.connection.latencyMs() } : {}),
      ...(this.connection.lastError() ? { lastError: this.connection.lastError() } : {})
    }
  }

  guardCommand(command: string): RemoteGuardOutcome {
    const evaluation = evaluateRemoteCommand({ command, mode: this.runMode, production: this.production })
    return { decision: evaluation.decision, reasons: evaluation.reasons }
  }

  guardPath(input: { capability: 'read' | 'write'; path: string }): RemoteGuardOutcome {
    const decision = evaluateRemotePathAccess({
      capability: input.capability,
      path: input.path,
      profile: this.profile,
      production: this.production
    })
    return { decision: decision.decision, reasons: [decision.reason] }
  }

  guardFile(input: { operation: RemoteFileOperation; path: string; recursive?: boolean }): RemoteGuardOutcome {
    const mutates = input.operation === 'create' || input.operation === 'write' || input.operation === 'edit' || input.operation === 'delete'
    if (mutates && this.runMode === 'observe') {
      return { decision: 'deny', reasons: ['observe mode allows read-only remote file operations only'] }
    }
    const decision = evaluateRemotePathAccess({
      capability: mutates ? 'write' : 'read',
      path: input.path,
      profile: this.profile,
      production: this.production,
      recursive: input.recursive
    })
    return { decision: decision.decision, reasons: [decision.reason] }
  }

  async exec(command: string, options: RemoteExecOptions = {}): Promise<RemoteExecResult> {
    const classification = classifyRemoteCommand(command)
    const result = await this.connection.run(command, {
      writes: classification.writes,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.input !== undefined ? { input: options.input } : {})
    })
    if (!result.outcome) {
      return {
        command,
        stdout: '',
        stderr: result.error ?? '',
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        statusUnknown: result.statusUnknown
      }
    }
    return {
      command,
      stdout: result.outcome.stdout,
      stderr: result.outcome.stderr,
      exitCode: result.outcome.exitCode,
      signal: result.outcome.signal,
      durationMs: result.outcome.durationMs,
      timedOut: result.outcome.timedOut,
      ...(result.outcome.aborted ? { aborted: true } : {}),
      ...(result.statusUnknown ? { statusUnknown: true } : {}),
      ...(result.outcome.truncated ? { truncated: true } : {})
    }
  }
}

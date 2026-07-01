/**
 * Target-aware command execution (Issue #647).
 *
 * When a thread is bound to an SSH target, the built-in `bash` tool routes here
 * instead of spawning a local shell. The remote run-mode guard can deny the
 * command outright; the result ALWAYS carries the target, host, remote dir, and
 * exit status so the model can never confuse remote and local execution. A
 * mid-flight disconnect on a mutating command comes back as `statusUnknown`
 * (never silently retried).
 */

import type { RemoteExecutionHandle } from '../../ports/remote-execution.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { createApprovalRequest } from '../../domain/approval.js'
import { isSshTarget } from '../../remote/remote-target.js'

export type RemoteCommandToolResult = {
  output: Record<string, unknown>
  isError?: boolean
}

export async function executeRemoteCommand(input: {
  handle: RemoteExecutionHandle
  command: string
  timeoutSeconds: number
  context: ToolHostContext
}): Promise<RemoteCommandToolResult> {
  const { handle, command, context } = input
  const descriptor = handle.describe()
  const target = descriptor.target
  const host = isSshTarget(target) ? target.alias : 'local'
  const remoteDir = isSshTarget(target) ? target.remoteDir : undefined
  const base = {
    target: 'ssh' as const,
    host,
    ...(remoteDir ? { remoteDir } : {}),
    command
  }

  const guard = handle.guardCommand(command)
  if (guard.decision === 'deny') {
    return {
      output: { ...base, decision: 'deny', error: `blocked by remote run mode: ${guard.reasons.join('; ')}` },
      isError: true
    }
  }

  // A 'confirm' decision (irreversible / high-risk / production write) MUST gate
  // on a real human approval BEFORE the command runs — never execute first and
  // label it confirmed afterwards. The approval card shows target + command +
  // risk reasons so the user knows exactly what runs where.
  if (guard.decision === 'confirm') {
    const approvalId = `appr_remote_${context.turnId}_${Math.random().toString(36).slice(2, 8)}`
    const approval = createApprovalRequest({
      id: approvalId,
      threadId: context.threadId,
      turnId: context.turnId,
      toolName: 'bash',
      summary: `Run on remote ${host}${remoteDir ? ` (${remoteDir})` : ''}: ${command}\nRisk: ${guard.reasons.join('; ')}`
    })
    const decision = await context.awaitApproval(approval)
    if (decision !== 'allow') {
      return {
        output: { ...base, decision: 'confirm', approved: false, error: 'remote command was not approved', riskReasons: guard.reasons },
        isError: true
      }
    }
  }

  const result = await handle.exec(command, {
    timeoutMs: Math.max(1, input.timeoutSeconds) * 1_000,
    ...(context.abortSignal ? { signal: context.abortSignal } : {})
  })

  if (result.statusUnknown) {
    return {
      output: {
        ...base,
        statusUnknown: true,
        stderr: result.stderr,
        note: 'connection dropped before a result was confirmed; the command was NOT auto-replayed. Use the target controls to query status or reconnect.'
      },
      isError: true
    }
  }

  return {
    output: {
      ...base,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      ...(result.truncated ? { truncated: true } : {}),
      ...(guard.decision === 'confirm' ? { riskConfirmed: true, riskReasons: guard.reasons } : {})
    },
    isError: result.timedOut || (result.exitCode !== null && result.exitCode !== 0)
  }
}

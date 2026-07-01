/**
 * Remote execution port (Issue #647).
 *
 * The seam the agent loop / tool host uses to run the tool chain on a remote
 * SSH target without knowing how SSH works. A local thread leaves
 * `ToolHostContext.executionTarget` undefined (tools operate on this machine);
 * an SSH thread attaches a {@link RemoteExecutionHandle} so the SAME tools run
 * remotely. The model, API keys, approvals, and session records always stay
 * local — only tool EXECUTION moves to the remote.
 *
 * This is a PORT: the concrete implementation lives in `kun/src/remote/*`
 * (built on the system `ssh` binary). Keeping it here lets the loop and tests
 * depend only on the interface.
 */

import type {
  RemoteConnectionStatus,
  RemoteTarget,
  RemoteTargetDescriptor
} from '../remote/remote-target.js'
import type { RemoteRunMode } from '../remote/remote-run-mode.js'

export type RemoteExecOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  /** Optional stdin payload; keeps file contents and secrets out of argv. */
  input?: string | Buffer
}

export type RemoteExecResult = {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  timedOut: boolean
  aborted?: boolean
  /** True when the connection dropped before a result was confirmed. */
  statusUnknown?: boolean
  /** True when stdout/stderr was capped (output exceeded the executor's limit). */
  truncated?: boolean
}

export type RemoteGuardOutcome = {
  decision: 'allow' | 'confirm' | 'deny'
  reasons: string[]
}

/**
 * File operations, used by the unified run-mode + protected-path gate. Mutation
 * operations are blocked in `observe` mode; every operation (including list/
 * search/read) is checked against protected paths.
 */
export type RemoteFileOperation = 'list' | 'search' | 'read' | 'create' | 'write' | 'edit' | 'delete'

/**
 * Live handle to a connected (or reconnecting) remote target for one thread.
 * Concrete impl wraps an {@link import('../remote/ssh-executor.js').SshExecutor}
 * plus the connection state machine, run-mode guard, and path-access guard.
 */
export interface RemoteExecutionHandle {
  readonly target: RemoteTarget
  readonly runMode: RemoteRunMode
  readonly production: boolean
  /** Current connection status (connected/degraded/disconnected/...). */
  status(): RemoteConnectionStatus
  /** A descriptor for the thread header / diagnostics. */
  describe(): RemoteTargetDescriptor
  /**
   * Classify a shell command against the run mode + risk model. Tools call this
   * BEFORE executing so the approval card can show the decision and reasons.
   */
  guardCommand(command: string): RemoteGuardOutcome
  /**
   * Classify a file read/write against protected paths + capability. Tools call
   * this for read/edit/write before touching a remote file.
   */
  guardPath(input: { capability: 'read' | 'write'; path: string }): RemoteGuardOutcome
  /**
   * Unified file-operation gate: blocks mutations in `observe` mode and applies
   * the protected-path policy to EVERY operation (list/search/read included),
   * so secrets cannot be probed via grep/find. All remote file tools route
   * through this so the run-mode + path policy is enforced in one place.
   */
  guardFile(input: { operation: RemoteFileOperation; path: string; recursive?: boolean }): RemoteGuardOutcome
  /**
   * Run a command on the remote target. Throws only on a hard spawn error;
   * normal non-zero exits and timeouts come back in the result. On a mid-flight
   * disconnect the result carries `statusUnknown: true` and the command is NOT
   * auto-replayed if it mutates state.
   */
  exec(command: string, options?: RemoteExecOptions): Promise<RemoteExecResult>
}

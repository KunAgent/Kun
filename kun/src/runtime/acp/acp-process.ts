/**
 * Owned ACP agent process (P6-03): delegates to the shared harness process
 * host in `kun/src/session/harness-process.ts` — spawn containment (process
 * group / job object), bounded sanitized stderr capture, and shutdown fencing
 * are transport-agnostic. ACP keeps its names so call sites stay readable.
 */
import {
  HarnessProcess,
  HARNESS_STDERR_TAIL_BYTES,
  startHarnessProcess
} from '../../session/harness-process.js'
import type { HarnessSpawnFn } from '../../session/harness-session.js'

export const ACP_STDERR_TAIL_BYTES = HARNESS_STDERR_TAIL_BYTES

export type AcpSpawnFn = HarnessSpawnFn

export type AcpProcess = HarnessProcess

export async function startAcpProcess(input: {
  command: string
  args?: readonly string[]
  /** Non-sensitive launch env from the harness definition. */
  env?: Record<string, string>
  /** Resolved secretEnv values (P4-12); overrides plain env entries. */
  secretEnv?: Record<string, string>
  /** Credential env from credential resolution (injected last, wins). */
  credentialEnv?: Record<string, string>
  /** Extra caller-specific strip keys beyond the shared denylist. */
  stripEnv?: readonly string[]
  cwd?: string
  /** Injectable for tests; production uses the owned-process launcher. */
  spawn?: AcpSpawnFn
  stderrTailBytes?: number
}): Promise<AcpProcess> {
  return startHarnessProcess(input)
}

import { isAbsolute } from 'node:path'
import { isAbsoluteTerminalCwd } from '@kun/remote-protocol'
import type { TerminalAuthority, TerminalOrigin } from './session-service'

/**
 * Working-directory resolution for a phone terminal.
 *
 * The phone sends a code/agent origin only. Main first proves access through the
 * same authorized runtime read that `desktop.session.start` uses for its origin.
 * Those remote answers deliberately carry **no** workspace path (`code.history`
 * returns the thread page, `agent.history` the room page, and `catalog.host`
 * hides the workspace), so the directory comes from the host's own thread
 * record through an explicit port. Nothing is inferred from the phone and an
 * unresolved origin fails closed.
 */
export type RuntimeInvoke = (
  call: { method: 'code.history' | 'agent.history'; params: Record<string, string> },
  authority: TerminalAuthority
) => Promise<unknown>

/** Host-side lookup of the approved project directory for an origin. */
export type WorkspaceReader = (
  origin: TerminalOrigin,
  authority: TerminalAuthority
) => Promise<string | null | undefined>

export function parseWorkspace(value: unknown): string {
  if (!isAbsoluteTerminalCwd(value) || !isAbsolute(value)) throw new Error('TERMINAL_ORIGIN_UNAVAILABLE')
  return value
}

/**
 * Authorization only: exact method and params confirmed by
 * `kun/src/remote/code/contracts.ts` (`code.history: { threadId }`) and
 * `kun/src/remote/agents/conversation-contracts.ts` (`agent.history: { agentId }`).
 */
export async function authorizeOrigin(invoke: RuntimeInvoke, authority: TerminalAuthority, origin: TerminalOrigin): Promise<void> {
  if (!authority.current()) throw new Error('TERMINAL_AUTHORITY_CHANGED')
  await invoke(origin.kind === 'code'
    ? { method: 'code.history', params: { threadId: origin.id } }
    : { method: 'agent.history', params: { agentId: origin.id } }, authority)
  // The authorization may have lapsed while the runtime answered.
  if (!authority.current()) throw new Error('TERMINAL_AUTHORITY_CHANGED')
}

export async function resolveOriginWorkspace(
  invoke: RuntimeInvoke,
  readWorkspace: WorkspaceReader,
  authority: TerminalAuthority,
  origin: TerminalOrigin
): Promise<{ cwd: string }> {
  await authorizeOrigin(invoke, authority, origin)
  const cwd = parseWorkspace(await readWorkspace(origin, authority))
  if (!authority.current()) throw new Error('TERMINAL_AUTHORITY_CHANGED')
  return { cwd }
}

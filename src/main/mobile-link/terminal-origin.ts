import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'

/**
 * `readWorkspace` port for the phone terminal engine.
 *
 * The phone sends an origin only (`kind` + id). Main never derives, accepts or
 * guesses a directory: it asks the runtime's host-local origin route, which
 * re-runs the exact authorized `code.history`/`agent.history` read for this
 * session's account, controller, authorization and scopes before it resolves
 * the thread/room workspace from its own records. Anything else — a rejected
 * read, another origin in the answer, a malformed body, or an authority that
 * lapsed during the round trip — fails closed so the terminal session reports
 * `TERMINAL_ORIGIN_UNAVAILABLE` instead of opening a wrong directory.
 */

/** Structural mirror of `TerminalOrigin` in `@kun/remote-protocol` 0.25.0. */
export type OriginRef = { kind: 'code' | 'agent'; id: string }

/** Structural mirror of the terminal session authority used by the runtime route. */
export type OriginAuthority = {
  accountId: string
  deviceId: string
  authorizationId: string
  scopes: readonly string[]
  current(): boolean
}

/** Host-local runtime route; deliberately not a published remote method. */
const ORIGIN_ROUTE = '/v1/remote/origin-workspace'
/** Matches `TERMINAL_LIMITS.cwdBytes`; a longer answer cannot be a usable cwd. */
const MAX_CWD_BYTES = 4_096

export type RuntimeOriginWorkspaceOptions = {
  acquireRuntimeRequestLease: () => Promise<ProtectedRuntimeRequestLease>
}

export type RuntimeOriginWorkspace = (
  origin: OriginRef,
  authority: OriginAuthority
) => Promise<string | null>

export function createRuntimeOriginWorkspace(
  options: RuntimeOriginWorkspaceOptions
): RuntimeOriginWorkspace {
  return async (origin, authority) => {
    if (!authority.current()) throw new Error('TERMINAL_AUTHORITY_CHANGED')
    const lease = await options.acquireRuntimeRequestLease()
    if (!authority.current()) throw new Error('TERMINAL_AUTHORITY_CHANGED')
    const response = await lease.request(ORIGIN_ROUTE, 'POST', JSON.stringify({
      accountId: authority.accountId,
      deviceId: authority.deviceId,
      authorizationId: authority.authorizationId,
      scopes: [...authority.scopes],
      origin: { kind: origin.kind, id: origin.id }
    }))
    // A revoke or account switch during the round trip must not open a shell.
    if (!authority.current()) throw new Error('TERMINAL_AUTHORITY_CHANGED')
    if (!response.ok) return null
    const answer = parseAnswer(response.body)
    if (!answer || answer.kind !== origin.kind || answer.id !== origin.id) return null
    if (typeof answer.cwd !== 'string' || !answer.cwd || answer.cwd.length > MAX_CWD_BYTES) return null
    return answer.cwd
  }
}

function parseAnswer(body: unknown): { kind?: unknown; id?: unknown; cwd?: unknown } | null {
  if (typeof body !== 'string' || !body) return null
  try {
    const value = JSON.parse(body) as unknown
    if (typeof value !== 'object' || value === null) return null
    return value as { kind?: unknown; id?: unknown; cwd?: unknown }
  } catch {
    return null
  }
}

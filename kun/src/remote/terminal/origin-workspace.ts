import { randomUUID } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { REMOTE_SCOPES } from '@kun/remote-protocol'
import { z } from 'zod'
import { currentAgentConversation } from '../../agents/agent-conversations.js'
import { privateWorkspace } from '../../agents/agent-direct-service.js'
import type { Router } from '../../server/router.js'
import { readJsonBody } from '../../server/read-json-body.js'
import { jsonResponse } from '../../server/response.js'
import { authorize } from '../../server/routes/route-auth.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { requireRemoteScope } from '../authorization/scopes.js'
import { requireCode } from '../code/access.js'
import { Envelope, RemoteId } from '../contracts.js'
import type { RemoteFacade } from '../facade.js'

/**
 * Phone terminal origin → absolute working directory, resolved from the
 * runtime's own records.
 *
 * No published remote method returns a workspace: `code.history` returns the
 * thread page, `agent.history` the room page, and `catalog.host` hides the
 * path. The phone therefore sends only `{ kind, id }`, and this host-local
 * route (1) re-runs the exact authorized read the phone performs with the same
 * account, controller, authorization and scopes, (2) resolves the directory
 * from the thread record or the agent conversation, and (3) returns the real
 * path only when it is absolute and an existing directory. Every failure is
 * `TERMINAL_ORIGIN_UNAVAILABLE` with no path in the response body.
 */
export const TERMINAL_ORIGIN_UNAVAILABLE = 'TERMINAL_ORIGIN_UNAVAILABLE'
/** Matches `TERMINAL_LIMITS.cwdBytes` in `@kun/remote-protocol`. */
const MAX_CWD_BYTES = 4_096
/** Host-local route; deliberately not a remote-protocol method. */
const ORIGIN_PATH = '/v1/remote/origin-workspace'
const ORIGIN_DEADLINE_MS = 15_000

export const TerminalOriginRequest = z.object({
  accountId: RemoteId,
  deviceId: RemoteId,
  authorizationId: RemoteId,
  scopes: z.array(z.enum(REMOTE_SCOPES)).max(REMOTE_SCOPES.length).default(['personal']),
  origin: z.object({ kind: z.enum(['code', 'agent']), id: RemoteId }).strict()
}).strict()
export type TerminalOriginRequest = z.infer<typeof TerminalOriginRequest>

export type TerminalOriginResolution = {
  kind: 'code' | 'agent'
  id: string
  cwd: string
}

function unavailable(): never {
  throw new Error(TERMINAL_ORIGIN_UNAVAILABLE)
}

export function boundedCwd(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) unavailable()
  if (!isAbsolute(value) || Buffer.byteLength(value, 'utf8') > MAX_CWD_BYTES) unavailable()
  return value
}

async function absoluteDirectory(candidate: unknown): Promise<string> {
  const resolved = await realpath(boundedCwd(candidate)).catch(() => unavailable())
  const info = await stat(resolved).catch(() => unavailable())
  if (!info.isDirectory()) unavailable()
  return boundedCwd(resolved)
}

async function codeWorkspace(runtime: ServerRuntime, threadId: string): Promise<string> {
  // Same resource gate as `code.history`: a remote Code thread, never an ADE
  // room, a worker, or a child thread, so a room thread can never borrow its
  // own workspace for a phone terminal.
  const thread = await requireCode(runtime, threadId)
  return absoluteDirectory(thread.workspace)
}

async function agentWorkspace(runtime: ServerRuntime, agentId: string): Promise<string> {
  const rooms = runtime.rooms
  if (!rooms) unavailable()
  // Read-only lookup of the same single conversation `agent.history` opens.
  const row = await currentAgentConversation(rooms.agents, agentId)
  if (!row?.value) unavailable()
  const room = row.value
  if (room.members[0]?.participantAgentId !== agentId) unavailable()
  // `privateWorkspace` is the resolver a direct agent run uses:
  // `room.privateWorkspace ?? agentWorkspace(dataDir, agentId)`, already realpathed.
  const { path } = await privateWorkspace(rooms, room)
  // Only the host-owned default under `dataDir` is created on demand, mirroring
  // `agent-direct-runner.ts`. A user-chosen room workspace must already exist.
  if (!room.privateWorkspace) await mkdir(path, { recursive: true }).catch(() => unavailable())
  return absoluteDirectory(path)
}

export async function resolveTerminalOrigin(
  runtime: ServerRuntime,
  facade: Pick<RemoteFacade, 'execute'>,
  body: unknown
): Promise<TerminalOriginResolution> {
  const parsed = TerminalOriginRequest.safeParse(body)
  if (!parsed.success) throw new Error('INVALID_REQUEST')
  const { accountId, deviceId, authorizationId, scopes, origin } = parsed.data
  const authority = { accountId, deviceId, authorizationId, scopes }
  // A grant that may not open a terminal must not learn a host directory, so the
  // same two scopes `terminal.open` already requires are re-asserted here.
  requireRemoteScope(authority, 'desktop.view')
  requireRemoteScope(authority, 'desktop.control')
  // The exact authorized read the phone itself performs. A revoked or expired
  // grant, a wrong device/authorization, a mismatched origin id, or a missing
  // record rejects here, before any record is read.
  await facade.execute(Envelope.parse({
    accountId,
    deviceId,
    authorizationId,
    // Desktop authority was checked above; the history facade needs only its
    // own scopes, and older runtime envelopes do not accept desktop flags.
    scopes: scopes.filter((scope) => scope !== 'desktop.view' && scope !== 'desktop.control'),
    call: {
      method: origin.kind === 'code' ? 'code.history' : 'agent.history',
      requestId: 'terminal-origin-' + randomUUID(),
      expiresAt: Date.now() + ORIGIN_DEADLINE_MS,
      params: origin.kind === 'code' ? { threadId: origin.id } : { agentId: origin.id }
    }
  }))
  const cwd = origin.kind === 'code'
    ? await codeWorkspace(runtime, origin.id)
    : await agentWorkspace(runtime, origin.id)
  return { kind: origin.kind, id: origin.id, cwd }
}

export function registerTerminalOriginRoute(
  router: Router,
  runtime: ServerRuntime,
  facade: RemoteFacade
): void {
  router.add('POST', ORIGIN_PATH, async (request) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    const body = await readJsonBody(request, 4_096)
    if (!body.ok) return body.response
    try {
      return jsonResponse(await resolveTerminalOrigin(runtime, facade, body.value))
    } catch (error) {
      // Error bodies carry a code, never a path: the phone sees the same
      // TERMINAL_ORIGIN_UNAVAILABLE the terminal session already uses.
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : TERMINAL_ORIGIN_UNAVAILABLE
      return jsonResponse({ code }, 403)
    }
  })
}

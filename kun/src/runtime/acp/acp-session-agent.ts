import type { AcpConnection } from './acp-connection.js'
import { ACP_AGENT_METHODS, AcpError, type AcpSessionModes } from './acp-schema.js'
import { isAcpAuthenticationRequired } from './acp-authentication.js'

/**
 * Select the composer-picked native Agent (OpenCode primary agent) through
 * `session/set_mode`. An Agent the session does not offer fails before the
 * prompt is sent instead of silently running the native default.
 */
export async function applyAcpSessionAgent(
  conn: AcpConnection,
  session: { sessionId: string; modes?: AcpSessionModes | null },
  agentId: string
): Promise<void> {
  const modes = session.modes
  if (!modes?.availableModes.some((mode) => mode.id === agentId)) throw unavailable(agentId)
  if (modes.currentModeId === agentId) return
  let result: { modes?: AcpSessionModes; currentModeId?: string } | null | undefined
  try {
    result = await conn.rpc.request(ACP_AGENT_METHODS.sessionSetMode, { sessionId: session.sessionId, modeId: agentId })
  } catch (error) {
    if ((error instanceof AcpError && error.code === 'request_aborted') || isAcpAuthenticationRequired(error)) throw error
    throw unavailable(agentId)
  }
  const hasEcho = Boolean(result && ('currentModeId' in result || 'modes' in result))
  const echoed = result?.modes && 'currentModeId' in result.modes ? result.modes.currentModeId : result?.currentModeId
  if (hasEcho && echoed !== agentId) throw unavailable(agentId)
  modes.currentModeId = agentId
}

function unavailable(agentId: string): AcpError {
  return new AcpError('policy_denied',
    `The Agent '${agentId}' is not available in this session. Choose another Agent in the composer and retry; no prompt was sent.`)
}

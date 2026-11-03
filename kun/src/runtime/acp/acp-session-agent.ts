import type { AcpConnection } from './acp-connection.js'
import { ACP_AGENT_METHODS, AcpError, type AcpConfigOption, type AcpSessionModes } from './acp-schema.js'
import { isAcpAuthenticationRequired } from './acp-authentication.js'
import { acpSessionModeSelector } from './acp-session-modes.js'

/**
 * Select the composer-picked native Agent (OpenCode primary agent) through
 * `session/set_mode`, or `session/set_config_option` when the agent reports
 * its modes as the `mode` config option. An Agent the session does not offer
 * fails before the prompt is sent instead of silently running the native default.
 */
export async function applyAcpSessionAgent(
  conn: AcpConnection,
  session: { sessionId: string; modes?: AcpSessionModes | null; configOptions?: AcpConfigOption[] | null },
  agentId: string
): Promise<void> {
  const selector = acpSessionModeSelector(session)
  if (!selector?.availableModes.some((mode) => mode.id === agentId)) throw unavailable(agentId)
  if (selector.currentModeId === agentId) return
  if (selector.source === 'config-option') {
    const result = await request<{ configOptions?: AcpConfigOption[] }>(conn, agentId, ACP_AGENT_METHODS.sessionSetConfigOption, {
      sessionId: session.sessionId, configId: selector.configId, value: agentId
    })
    if (result && 'configOptions' in result) {
      const echoed = Array.isArray(result.configOptions)
        ? result.configOptions.find((entry) => entry.id === selector.configId) : undefined
      if (!echoed || echoed.type !== 'select' || echoed.currentValue !== agentId) throw unavailable(agentId)
    }
    const option = session.configOptions?.find((entry) => entry.id === selector.configId)
    if (option?.type === 'select') option.currentValue = agentId
    return
  }
  const result = await request<{ modes?: AcpSessionModes; currentModeId?: string }>(conn, agentId,
    ACP_AGENT_METHODS.sessionSetMode, { sessionId: session.sessionId, modeId: agentId })
  const hasEcho = Boolean(result && ('currentModeId' in result || 'modes' in result))
  const echoed = result?.modes && 'currentModeId' in result.modes ? result.modes.currentModeId : result?.currentModeId
  if (hasEcho && echoed !== agentId) throw unavailable(agentId)
  if (session.modes) session.modes.currentModeId = agentId
}

async function request<T>(conn: AcpConnection, agentId: string, method: string,
  params: Record<string, string>): Promise<T | null | undefined> {
  try {
    return await conn.rpc.request<T>(method, params)
  } catch (error) {
    if ((error instanceof AcpError && error.code === 'request_aborted') || isAcpAuthenticationRequired(error)) throw error
    throw unavailable(agentId)
  }
}

function unavailable(agentId: string): AcpError {
  return new AcpError('policy_denied',
    `The Agent '${agentId}' is not available in this session. Choose another Agent in the composer and retry; no prompt was sent.`)
}

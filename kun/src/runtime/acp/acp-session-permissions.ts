import type { HarnessDefinition } from '../../contracts/harness.js'
import type { AcpConnection } from './acp-connection.js'
import { ACP_AGENT_METHODS, AcpError, acpConfigOptionValues, type AcpConfigOption, type AcpSessionModes } from './acp-schema.js'
import { isAcpAuthenticationRequired } from './acp-authentication.js'

type PermissionSession = {
  sessionId: string
  configOptions?: AcpConfigOption[] | null
  modes?: AcpSessionModes | null
}

/** A restored agent default is not proof that Kun's permission ceiling holds. */
export async function applyAcpSessionPermission(
  conn: AcpConnection,
  session: PermissionSession,
  requestedMode: string | undefined,
  policy?: HarnessDefinition['acpPermission']
): Promise<void> {
  if (!requestedMode) return
  const candidates = [requestedMode, ...(policy?.modeAliases?.[requestedMode] ?? [])]
  const option = session.configOptions?.find((entry) => policy?.configOptionId
    ? entry.id === policy.configOptionId : entry.category === 'mode')
  if (option?.type === 'select') {
    const offered = acpConfigOptionValues(option)
    const value = candidates.find((candidate) => offered.includes(candidate))
    if (!value) throw denied(requestedMode)
    if (option.currentValue !== value) {
      const result = await set<{ configOptions?: AcpConfigOption[] }>(conn, requestedMode, ACP_AGENT_METHODS.sessionSetConfigOption, {
        sessionId: session.sessionId, configId: option.id, value
      })
      if (result && 'configOptions' in result) {
        if (!Array.isArray(result.configOptions)) throw denied(requestedMode)
        const echoed = result.configOptions.find((entry) => entry.id === option.id)
        if (!echoed || echoed.type !== 'select' || echoed.currentValue !== value) throw denied(requestedMode)
      }
      option.currentValue = value
    }
    return
  }
  if (option || policy?.configOptionId) throw denied(requestedMode)
  const modes = session.modes
  if (modes?.availableModes.length) {
    const modeId = candidates.find((candidate) => modes.availableModes.some((mode) => mode.id === candidate))
    if (!modeId) throw denied(requestedMode)
    if (modes.currentModeId !== modeId) {
      const result = await set<{ modes?: AcpSessionModes; currentModeId?: string }>(conn, requestedMode, ACP_AGENT_METHODS.sessionSetMode, {
        sessionId: session.sessionId, modeId
      })
      const hasEcho = Boolean(result && ('currentModeId' in result || 'modes' in result))
      const echoed = result?.modes && 'currentModeId' in result.modes ? result.modes.currentModeId : result?.currentModeId
      if (hasEcho && echoed !== modeId) throw denied(requestedMode)
      modes.currentModeId = modeId
    }
    return
  }
  // Only a repository-owned declaration may state that this protocol has no
  // native mode selector and delegates every tool approval to the ACP client.
  if (policy?.requireMode === false) return
  throw denied(requestedMode)
}

function denied(mode: string): AcpError {
  return new AcpError('policy_denied',
    `The Agent could not establish permission mode '${mode}'. Select a supported permission mode and retry; no prompt was sent.`)
}

async function set<T>(conn: AcpConnection, mode: string, method: string, params: Record<string, string>): Promise<T> {
  try { return await conn.rpc.request<T>(method, params) }
  catch (error) {
    if ((error instanceof AcpError && error.code === 'request_aborted') || isAcpAuthenticationRequired(error)) throw error
    // A rejected control must never look like a missing saved session and
    // trigger a portable rebase that retains an unchecked native default.
    throw denied(mode)
  }
}

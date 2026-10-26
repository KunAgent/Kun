import { redactApprovalSensitiveText } from '../../domain/approval.js'
import type { HarnessDefinition } from '../../contracts/harness.js'
import type { AcpConnection } from './acp-connection.js'
import { ACP_AGENT_METHODS, AcpError, acpConfigOptionValues, type AcpConfigOption, type AcpSessionModes } from './acp-schema.js'
import { isAcpAuthenticationRequired } from './acp-authentication.js'

type PermissionSession = {
  sessionId: string
  configOptions?: AcpConfigOption[] | null
  modes?: AcpSessionModes | null
}

function modeSelectorFor(session: PermissionSession, policy?: HarnessDefinition['acpPermission']): AcpConfigOption | undefined {
  return session.configOptions?.find((entry) => policy?.configOptionId
    ? entry.id === policy.configOptionId : entry.category === 'mode')
}

/**
 * The agent publishes a mode selector, but none of the modes Kun maps this
 * permission to. OpenCode reports this when plugins replace its build/plan
 * primary agents; only an explicitly picked native Agent can run there.
 */
export function acpPermissionModeUnoffered(
  session: PermissionSession,
  requestedMode: string,
  policy?: HarnessDefinition['acpPermission']
): boolean {
  const candidates = [requestedMode, ...(policy?.modeAliases?.[requestedMode] ?? [])]
  const option = modeSelectorFor(session, policy)
  if (option?.type === 'select') {
    const offered = acpConfigOptionValues(option)
    return offered.length > 0 && !candidates.some((candidate) => offered.includes(candidate))
  }
  if (option || policy?.configOptionId) return false
  const available = session.modes?.availableModes ?? []
  return available.length > 0 && !candidates.some((candidate) => available.some((mode) => mode.id === candidate))
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
  const option = modeSelectorFor(session, policy)
  if (option?.type === 'select') {
    const offered = acpConfigOptionValues(option)
    const value = candidates.find((candidate) => offered.includes(candidate))
    if (!value) throw denied(requestedMode, offered)
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
    if (!modeId) throw denied(requestedMode, modes.availableModes.map((mode) => mode.id))
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

function denied(mode: string, offered: readonly string[] = []): AcpError {
  const listed = offered.slice(0, 8).map((value) => `'${value.slice(0, 64)}'`).join(', ')
  return new AcpError('policy_denied',
    `The Agent could not establish permission mode '${mode}'${listed ? ` (it offers ${listed})` : ''}. Select a supported permission mode${listed ? ' or pick one of its Agents in the composer' : ''} and retry; no prompt was sent.`)
}

async function set<T>(conn: AcpConnection, mode: string, method: string, params: Record<string, string>): Promise<T> {
  try { return await conn.rpc.request<T>(method, params) }
  catch (error) {
    if ((error instanceof AcpError && error.code === 'request_aborted') || isAcpAuthenticationRequired(error)) throw error
    // A rejected control must never look like a missing saved session and
    // trigger a portable rebase that retains an unchecked native default.
    const details = error instanceof AcpError && error.data && typeof error.data === 'object' && 'details' in error.data
      && typeof error.data.details === 'string' ? error.data.details : ''
    const nativeMessage = `${error instanceof Error ? error.message : 'request failed'} ${details}`
      .replace(/("[^"]*(?:token|secret|password|key|authorization)[^"]*"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
    const summary = redactApprovalSensitiveText(nativeMessage)
      // eslint-disable-next-line no-control-regex -- summaries strip ASCII controls
      .replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 300)
    const rpcCode = error instanceof AcpError ? error.rpcCode : undefined
    throw new AcpError('policy_denied', `${denied(mode).message} ${method}${rpcCode === undefined ? '' : ` (RPC ${rpcCode})`}: ${summary}`, { rpcCode })
  }
}

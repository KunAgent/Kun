import type { AcpConnection } from './acp-connection.js'
import {
  ACP_AGENT_METHODS,
  AcpError,
  acpConfigOptionValues,
  type AcpConfigOption,
  type AcpSessionModes
} from './acp-schema.js'

/**
 * Devin can restore a wider saved mode. Require the requested mode before
 * sending a prompt, including after session/load. CLI flags are not a
 * substitute for the ACP session controls. `auto` is the documented alias
 * of `normal`; never infer a safe mode from a translated display label.
 */
export async function applyDevinSessionPermission(
  conn: AcpConnection,
  session: {
    sessionId: string
    configOptions?: AcpConfigOption[] | null
    modes?: AcpSessionModes | null
  },
  requestedMode = 'normal'
): Promise<void> {
  const candidates = requestedMode === 'normal' ? ['normal', 'auto'] : [requestedMode]
  const option = session.configOptions?.find((entry) => entry.category === 'mode')
  if (option?.type === 'select') {
    const values = acpConfigOptionValues(option)
    const value = candidates.find((candidate) => values.includes(candidate))
    if (value) {
      if (option.currentValue !== value) {
        await conn.rpc.request(ACP_AGENT_METHODS.sessionSetConfigOption, {
          sessionId: session.sessionId, configId: option.id, value
        })
        option.currentValue = value
      }
      return
    }
  } else if (!option && session.modes) {
    const modeId = candidates.find((candidate) =>
      session.modes!.availableModes.some((mode) => mode.id === candidate))
    if (modeId) {
      if (session.modes.currentModeId !== modeId) {
        await conn.rpc.request(ACP_AGENT_METHODS.sessionSetMode, {
          sessionId: session.sessionId, modeId
        })
        session.modes.currentModeId = modeId
      }
      return
    }
  }
  throw new AcpError(
    'policy_denied',
    `Devin did not advertise the requested permission mode '${requestedMode}'. Update Devin CLI and retry; no prompt was sent.`
  )
}

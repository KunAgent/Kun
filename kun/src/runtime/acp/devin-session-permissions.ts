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
 * substitute for the ACP session controls. Current ACP uses `ask` for its
 * read-only mode; legacy normal/auto can only fall back to this narrower mode.
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
  const candidates = ['normal', 'auto'].includes(requestedMode)
    ? [requestedMode, ...['normal', 'auto', 'ask'].filter((mode) => mode !== requestedMode)]
    : requestedMode === 'bypass' ? ['bypass', 'dangerous'] : [requestedMode]
  const option = session.configOptions?.find((entry) => entry.category === 'mode')
  if (option?.type === 'select') {
    const values = acpConfigOptionValues(option)
    const value = candidates.find((candidate) => values.includes(candidate))
    if (value) {
      if (option.currentValue !== value) {
        const updated = await conn.rpc.request<{ configOptions?: AcpConfigOption[] }>(ACP_AGENT_METHODS.sessionSetConfigOption, {
          sessionId: session.sessionId, configId: option.id, value
        })
        const echoed = updated.configOptions?.find((entry) => entry.id === option.id)
        if (echoed?.type === 'select' && echoed.currentValue !== value) {
          throw new AcpError('policy_denied', `Devin did not apply the requested permission mode '${value}'; no prompt was sent.`)
        }
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
    `Devin permission mode '${requestedMode}' is unavailable. Select a supported Agent permission mode and retry; no prompt was sent.`
  )
}

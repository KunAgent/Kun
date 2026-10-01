import type { AcpConnection } from './acp-connection.js'
import { ACP_AGENT_METHODS, ACP_RPC_ERROR, AcpError, acpConfigOptionValues, type AcpConfigOption } from './acp-schema.js'

/** Compatibility surface from the official ACP v0.9.1 unstable schema. */
export type AcpLegacyModels = {
  currentModelId?: string
  availableModels: string[]
}

export function parseAcpLegacyModels(value: unknown): AcpLegacyModels | undefined {
  if (!value || typeof value !== 'object' || !('availableModels' in value) ||
    !Array.isArray(value.availableModels)) return undefined
  const availableModels = value.availableModels.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('modelId' in entry)) return []
    return typeof entry.modelId === 'string' && entry.modelId.trim() ? [entry.modelId] : []
  })
  return {
    ...('currentModelId' in value && typeof value.currentModelId === 'string'
      ? { currentModelId: value.currentModelId } : {}),
    availableModels: [...new Set(availableModels)]
  }
}

/** A rejected model selection must not be mistaken for a missing saved session. */
export class AcpModelSelectionError extends AcpError {
  constructor(message: string) {
    super('agent_error', message)
  }
}

/** Explicit model selections must be accepted by the authoritative selector. */
export async function applyAcpSessionModel(
  conn: AcpConnection,
  session: { sessionId: string; models?: AcpLegacyModels; configOptions?: AcpConfigOption[] | null },
  modelId: string | undefined
): Promise<void> {
  if (!modelId) return
  const option = session.configOptions?.find((entry) => entry.category === 'model')
  if (!option) return applyAcpLegacyModel(conn, session, modelId)
  if (option.type !== 'select' || !acpConfigOptionValues(option).includes(modelId)) {
    throw new AcpModelSelectionError(
      `The agent's model selector does not offer '${modelId}'. Refresh its model list or choose Agent default; no prompt was sent.`
    )
  }
  if (option.currentValue === modelId) return
  try {
    await conn.rpc.request(ACP_AGENT_METHODS.sessionSetConfigOption, {
      sessionId: session.sessionId, configId: option.id, value: modelId
    })
  } catch (error) {
    if (error instanceof AcpError && error.rpcCode === ACP_RPC_ERROR.methodNotFound) {
      throw new AcpModelSelectionError('The agent does not support its model selector. Update the agent or choose Agent default; no prompt was sent.')
    }
    throw error
  }
  option.currentValue = modelId
}

/**
 * Use only when no modern model config option is present. The pinned SDK no
 * longer exports legacy model types, but recognizes session/set_model as a
 * session-scoped method. Wire fields are retained from the official schema:
 * https://github.com/agentclientprotocol/agent-client-protocol/blob/v0.9.1/schema/schema.unstable.json
 */
export async function applyAcpLegacyModel(
  conn: AcpConnection,
  session: { sessionId: string; models?: AcpLegacyModels },
  modelId: string | undefined
): Promise<void> {
  if (!modelId) return
  if (!session.models?.availableModels.includes(modelId)) {
    throw new AcpModelSelectionError(
      `The agent did not advertise model '${modelId}'. Refresh its model list or choose Agent default; no prompt was sent.`
    )
  }
  if (session.models.currentModelId === modelId) return
  try {
    await conn.rpc.request('session/set_model', { sessionId: session.sessionId, modelId })
  } catch (error) {
    if (error instanceof AcpError && error.rpcCode === ACP_RPC_ERROR.methodNotFound) {
      throw new AcpModelSelectionError(
        'The agent does not support its advertised model selector. Update the agent or choose Agent default; no prompt was sent.'
      )
    }
    throw error
  }
  session.models.currentModelId = modelId
}

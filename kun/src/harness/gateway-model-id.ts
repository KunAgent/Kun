/**
 * Direct-addressed gateway model ids of the form `kun/<provider>/<model>`.
 * Only harness gateway grants may address them; public gateway credentials
 * never resolve this prefix (see model-gateway-core.resolveGatewayModel).
 */

export const GATEWAY_MODEL_PREFIX = 'kun/'

export type GatewayModelAddress = {
  providerId: string
  model: string
}

export function isGatewayModelId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(GATEWAY_MODEL_PREFIX)
}

/** Splits at the first slash after the prefix so model ids may contain `/`. */
export function parseGatewayModelId(value: string | null | undefined): GatewayModelAddress | null {
  if (!isGatewayModelId(value)) return null
  const rest = value.slice(GATEWAY_MODEL_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  const providerId = rest.slice(0, slash)
  const model = rest.slice(slash + 1)
  if (providerId.length > 128 || model.length > 512) return null
  return { providerId, model }
}

export function formatGatewayModelId(providerId: string, model: string): string {
  if (!providerId || providerId.includes('/') || providerId.length > 128) {
    throw new Error(`invalid gateway provider id: ${providerId}`)
  }
  if (!model || model.length > 512) throw new Error(`invalid gateway model id: ${model}`)
  return `${GATEWAY_MODEL_PREFIX}${providerId}/${model}`
}

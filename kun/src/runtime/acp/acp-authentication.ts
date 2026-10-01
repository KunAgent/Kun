import { AcpError } from './acp-schema.js'

/**
 * ACP authMethods advertises available flows, not account state. Only an
 * actual auth_required response (official SDK RequestError.authRequired)
 * establishes that the requested operation needs login.
 */
export function isAcpAuthenticationRequired(error: unknown): boolean {
  return error instanceof AcpError && error.code === 'agent_error' && error.rpcCode === -32000
}

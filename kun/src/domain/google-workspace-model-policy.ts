/** Label for the fixed direct cloud recipient; exact account evidence is required before dispatch. */
export const GOOGLE_WORKSPACE_MODEL_PROVIDER = 'DeepSeek API'

export class GoogleWorkspaceModelPolicyError extends Error {
  readonly code = 'google_data_provider_not_approved'
  constructor(message = 'Gmail data requires an explicitly consented, verified model account and a fixed direct route without automatic routing or failover.') {
    super(message)
    this.name = 'GoogleWorkspaceModelPolicyError'
  }
}

export function assertGoogleWorkspaceModelEndpoint(value: string, protocol: string, full = false): void {
  let url: URL
  try { url = new URL(value) } catch { throw new GoogleWorkspaceModelPolicyError() }
  const path = url.pathname.replace(/\/$/u, '')
  const validPath = full ? ['/chat/completions', '/v1/chat/completions'].includes(path) : ['', '/v1'].includes(path)
  if (protocol !== 'chat_completions' || url.origin !== 'https://api.deepseek.com' || url.username || url.password ||
      url.search || url.hash || !validPath) {
    throw new GoogleWorkspaceModelPolicyError()
  }
}

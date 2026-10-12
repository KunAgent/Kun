/** Label for the guarded cloud transport, disabled in the initial public release. */
export const GOOGLE_WORKSPACE_MODEL_PROVIDER = 'Ollama Cloud'

export class GoogleWorkspaceModelPolicyError extends Error {
  readonly code = 'google_data_provider_not_approved'
  constructor(message = 'Gmail data requires Kun’s verified cloud-disabled local Ollama model in this release, without automatic routing or failover.') {
    super(message)
    this.name = 'GoogleWorkspaceModelPolicyError'
  }
}

export function assertGoogleWorkspaceModelEndpoint(value: string, protocol: string, full = false): void {
  let url: URL
  try { url = new URL(value) } catch { throw new GoogleWorkspaceModelPolicyError() }
  const expected = full ? '/v1/chat/completions' : '/v1'
  if (protocol !== 'chat_completions' || url.origin !== 'https://ollama.com' || url.username || url.password ||
      url.search || url.hash || url.pathname.replace(/\/$/u, '') !== expected) {
    throw new GoogleWorkspaceModelPolicyError()
  }
}

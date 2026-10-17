import type { ModelRequest } from '../../ports/model-client.js'

/** Normal model admission still applies; mail permission is checked after every asynchronous gate. */
export async function admitGmailAwareModelDispatch(request: ModelRequest, input: {
  body: Record<string, unknown>; protocol: string
}): Promise<void> {
  request.googleWorkspaceData?.assertCurrent()
  await request.beforeProviderDispatch?.()
  request.googleWorkspaceData?.assertCurrent()
  await request.beforeWireDispatch?.({ providerId: request.providerId ?? 'default', model: request.model,
    protocol: input.protocol, maxOutputTokens: request.maxTokens,
    estimatedTokens: Math.ceil(Buffer.byteLength(JSON.stringify(input.body)) / 3) + (request.maxTokens ?? 4096) })
  request.googleWorkspaceData?.assertCurrent()
  request.abortSignal.throwIfAborted()
  request.onWireDispatch?.()
  request.googleWorkspaceData?.assertCurrent()
}

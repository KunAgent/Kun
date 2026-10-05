/** The CLI JSON result is also the durable native conversation handle. */
export function parseAntigravityResult(output: string, expectedId?: string): {
  conversationId: string
  text: string
} {
  let result: Record<string, unknown>
  try { result = JSON.parse(output) } catch {
    throw new Error('Antigravity CLI did not return a JSON conversation result')
  }
  if (!result || typeof result !== 'object' || result.status !== 'SUCCESS') {
    throw new Error(typeof result?.error === 'string' ? result.error : 'Antigravity turn failed')
  }
  const id = result.conversation_id
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(id)) {
    throw new Error('Antigravity CLI returned an invalid conversation id')
  }
  if (expectedId && id !== expectedId) {
    throw new Error('Antigravity CLI restored a different conversation; response was not attached')
  }
  if (typeof result.response !== 'string' || !result.response.trim()) {
    throw new Error('Antigravity CLI returned an empty response')
  }
  return { conversationId: id, text: result.response.trim() }
}

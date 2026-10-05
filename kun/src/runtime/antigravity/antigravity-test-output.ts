export function antigravityTestOutput(output: string | readonly Buffer[]): Buffer[] {
  const text = typeof output === 'string' ? output : Buffer.concat(output).toString('utf8')
  const json = Buffer.from(JSON.stringify({ conversation_id: 'test-native-conversation', status: 'SUCCESS', response: text }))
  // Byte-sized chunks also exercise multibyte streaming boundaries.
  return Array.from(json, (byte) => Buffer.from([byte]))
}

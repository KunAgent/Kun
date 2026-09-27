/**
 * UTF-8 byte budgeting helpers shared by the delegated-history transcript and
 * the deterministic handoff brief (docs/ade/08 §3). All truncation iterates
 * Unicode code points so a cut never produces half a character.
 */

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

export function fitUtf8(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text
  let out = ''
  let used = 0
  for (const char of text) {
    const bytes = utf8Bytes(char)
    if (used + bytes > maxBytes) break
    out += char
    used += bytes
  }
  return out
}

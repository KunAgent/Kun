/** dotenv files (`KEY=value` per line), as Gemini CLI reads `~/.gemini/.env`. Other lines stay byte for byte. */
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

function unquote(raw: string): string {
  if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) return JSON.parse(raw) as string
  if (/^'[^']*'$/.test(raw)) return raw.slice(1, -1)
  const comment = raw.search(/\s#/)
  return comment >= 0 ? raw.slice(0, comment).trim() : raw
}

export function getDotenv(text: string, key: string): string | undefined {
  const lines = text.split(/\r?\n/)
  // The last assignment wins, as dotenv readers apply them in order.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = LINE.exec(lines[index]!)
    if (match?.[1] === key) return unquote(match[2]!)
  }
  return undefined
}

export function setDotenv(text: string, key: string, value: string | undefined): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const trailing = text.endsWith('\n') || !text
  const lines = text ? text.replace(/\r?\n$/, '').split(/\r?\n/) : []
  const rendered = value === undefined ? undefined : `${key}=${/^[A-Za-z0-9_./:@+-]*$/.test(value) ? value : JSON.stringify(value)}`
  let found = false
  const out: string[] = []
  for (const line of lines) {
    if (LINE.exec(line)?.[1] !== key) { out.push(line); continue }
    if (rendered !== undefined && !found) out.push(rendered)
    found = true
  }
  if (!found && rendered !== undefined) out.push(rendered)
  if (!out.length) return ''
  return out.join(eol) + (trailing ? eol : '')
}

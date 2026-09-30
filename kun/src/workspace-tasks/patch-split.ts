/**
 * Per-file patch splitting for the review diff surface (docs/ade/11 §3).
 * Pure parsing — a `diff --git` unified patch becomes one section per file
 * with status, path rename info, binary flag, and insertion/deletion counts.
 */

export type PatchFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export type PatchFileSection = {
  /** New-side path (`b/…`); the deleted path for `deleted` sections. */
  path: string
  /** Old-side path, only for renames. */
  oldPath?: string
  status: PatchFileStatus
  insertions: number
  deletions: number
  binary: boolean
  /** Raw section text, `diff --git` line included. */
  patch: string
}

/** Git quotes paths with spaces or escapes as `"a/pa\th"`. */
function unquoteGitPath(token: string): string {
  if (!token.startsWith('"')) return token
  const inner = token.slice(1, token.endsWith('"') ? -1 : undefined)
  const bytes: number[] = []
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      continue
    }
    const next = inner[i + 1]
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1, i + 4))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 3
    } else if (next === 'n') { bytes.push(0x0a); i += 1 }
    else if (next === 't') { bytes.push(0x09); i += 1 }
    else if (next === 'r') { bytes.push(0x0d); i += 1 }
    else if (next === '"' || next === '\\') { bytes.push(next.charCodeAt(0)); i += 1 }
    else { bytes.push(next.charCodeAt(0)); i += 1 }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Consume one `a/…` or `"a/…"` token; returns the path and remainder. */
function takeGitPath(rest: string): { path: string; rest: string } | undefined {
  if (rest.startsWith('"')) {
    let i = 1
    while (i < rest.length && !(rest[i] === '"' && rest[i - 1] !== '\\')) i += 1
    const token = rest.slice(0, i + 1)
    return { path: unquoteGitPath(token), rest: rest.slice(i + 1) }
  }
  const match = /^(\S+)(.*)$/.exec(rest)
  if (!match) return undefined
  return { path: match[1], rest: match[2] }
}

function parseDiffGitLine(line: string): { a: string; b: string } | undefined {
  const rest = line.slice('diff --git '.length)
  const a = takeGitPath(rest)
  if (!a) return undefined
  const b = takeGitPath(a.rest.trimStart())
  if (!b) return undefined
  return {
    a: unquoteGitPath(a.path).replace(/^a\//, ''),
    b: unquoteGitPath(b.path).replace(/^b\//, '')
  }
}

export function splitPatchByFile(patch: string): PatchFileSection[] {
  const lines = patch.split('\n')
  const starts: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('diff --git ')) starts.push(i)
  }
  const sections: PatchFileSection[] = []
  for (let s = 0; s < starts.length; s += 1) {
    const start = starts[s]
    const end = s + 1 < starts.length ? starts[s + 1] : lines.length
    const body = lines.slice(start, end)
    const paths = parseDiffGitLine(lines[start])
    if (!paths) continue
    let status: PatchFileStatus = 'modified'
    let insertions = 0
    let deletions = 0
    let binary = false
    let inHunks = false
    for (const line of body) {
      if (line.startsWith('new file mode')) status = 'added'
      else if (line.startsWith('deleted file mode')) status = 'deleted'
      else if (line.startsWith('rename from ')) status = 'renamed'
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) binary = true
      else if (line.startsWith('@@')) inHunks = true
      else if (inHunks) {
        if (line.startsWith('+')) insertions += 1
        else if (line.startsWith('-')) deletions += 1
      }
    }
    const text = body.join('\n')
    sections.push({
      path: status === 'deleted' ? paths.a : paths.b,
      ...(status === 'renamed' ? { oldPath: paths.a } : {}),
      status,
      insertions,
      deletions,
      binary,
      patch: text.endsWith('\n') ? text : `${text}\n`
    })
  }
  return sections
}

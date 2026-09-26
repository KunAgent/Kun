/**
 * TeX-source figure extraction (D5 level 2): unpack the arXiv e-print tar,
 * match `\begin{figure|table}` environments to `\includegraphics` +
 * `\caption`, resolve `\graphicspath` and omitted extensions, and hand out
 * in-memory image payloads for the caller to persist.
 */
import { gunzipSync } from 'node:zlib'
import * as tar from 'tar-stream'

const MAX_TAR_ENTRIES = 2_000
const MAX_TAR_BYTES = 200 * 1024 * 1024
const MAX_ENTRY_BYTES = 32 * 1024 * 1024

const IMAGE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.eps']

export type TexFigureEnv = {
  kind: 'figure' | 'table'
  /** Raw caption text with TeX commands stripped. */
  caption: string
  /** `\includegraphics` target as written in the source. */
  graphicPath: string
}

/** Extract a `.tar` payload into a path→buffer map (bounds-checked). */
export async function extractTarEntries(data: Buffer): Promise<Map<string, Buffer>> {
  const extract = tar.extract()
  const files = new Map<string, Buffer>()
  let total = 0

  const done = new Promise<void>((resolvePromise, reject) => {
    extract.on('entry', (header, stream, next) => {
      if (header.type !== 'file' || files.size >= MAX_TAR_ENTRIES || total > MAX_TAR_BYTES) {
        stream.resume()
        next()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      stream.on('data', (chunk: unknown) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        size += buf.byteLength
        if (size <= MAX_ENTRY_BYTES) chunks.push(buf)
      })
      stream.on('end', () => {
        total += size
        if (size <= MAX_ENTRY_BYTES) files.set(header.name.replace(/^\.\//, ''), Buffer.concat(chunks, Math.min(size, MAX_ENTRY_BYTES)))
        next()
      })
      stream.on('error', next)
    })
    extract.on('finish', () => resolvePromise())
    extract.on('error', reject)
  })
  extract.end(data)
  await done
  return files
}

/** Balanced-brace read of `\command{…}` starting at the `{`. */
function readBraceGroup(source: string, openIndex: number): { text: string; end: number } | null {
  if (source[openIndex] !== '{') return null
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    const c = source[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return { text: source.slice(openIndex + 1, i), end: i + 1 }
    } else if (c === '\\') {
      i += 1 // skip escaped char
    }
  }
  return null
}

/** Strip TeX markup from captions: commands, braces, math kept as `$…$`. */
export function texToPlainText(tex: string): string {
  let out = tex
  // \command{inner} → inner, applied innermost-first.
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$1')
    if (next === out) break
    out = next
  }
  return out
    .replace(/\\[a-zA-Z]+\*?\s*(\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\([&%#$])/g, '$1')
    .replace(/~/g, ' ')
    .replace(/\\,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Global `\graphicspath{{dir1/}{dir2/}}` prefixes. */
export function parseGraphicsPaths(tex: string): string[] {
  const paths: string[] = []
  const re = /\\graphicspath\s*\{/g
  for (;;) {
    const m = re.exec(tex)
    if (!m) break
    const group = readBraceGroup(tex, m.index + m[0].length - 1)
    if (!group) break
    for (const inner of group.text.matchAll(/\{([^{}]*)\}/g)) {
      const dir = inner[1].trim().replace(/\/+$/, '')
      if (dir) paths.push(`${dir}/`)
    }
    re.lastIndex = group.end
  }
  return paths
}

/**
 * `\begin{figure|table}` environments → (kind, caption, graphic). Environments
 * with multiple `\includegraphics` yield one entry per image, sharing the
 * caption.
 */
export function parseTexFigures(tex: string): TexFigureEnv[] {
  const out: TexFigureEnv[] = []
  const envRe = /\\begin\{(figure\*?|table\*?)\}([\s\S]*?)\\end\{\1\}/g
  for (;;) {
    const m = envRe.exec(tex)
    if (!m) break
    const kind = m[1].startsWith('table') ? 'table' : 'figure'
    const body = m[2]
    const captionMatch = /\\caption\b/.exec(body)
    let caption = ''
    if (captionMatch) {
      const braceAt = body.indexOf('{', captionMatch.index + captionMatch[0].length)
      const group = braceAt >= 0 ? readBraceGroup(body, braceAt) : null
      if (group) caption = texToPlainText(group.text)
    }
    const graphics = [...body.matchAll(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g)]
    for (const g of graphics) {
      const graphicPath = g[1].trim()
      if (graphicPath) out.push({ kind, caption, graphicPath })
    }
  }
  return out
}

export type TexResolvedFigure = TexFigureEnv & { resolvedPath: string; data: Buffer }

/**
 * Resolve `\includegraphics` paths against the extracted e-print entries,
 * honoring `\graphicspath` prefixes and extension-less references.
 */
export function resolveTexFigures(
  texSources: string[],
  files: Map<string, Buffer>
): TexResolvedFigure[] {
  const resolved: TexResolvedFigure[] = []
  for (const tex of texSources) {
    const graphicsPaths = parseGraphicsPaths(tex)
    for (const figure of parseTexFigures(tex)) {
      const candidates: string[] = []
      const raw = figure.graphicPath
      for (const prefix of ['', ...graphicsPaths]) {
        candidates.push(prefix + raw)
        if (!/\.[a-zA-Z]{2,4}$/.test(raw)) {
          for (const ext of IMAGE_EXTENSIONS) candidates.push(`${prefix}${raw}${ext}`)
        }
      }
      const hit = candidates.find((candidate) => files.has(candidate))
      if (hit) {
        resolved.push({ ...figure, resolvedPath: hit, data: files.get(hit)! })
      }
    }
    if (resolved.length > 0) break // the root .tex that owns figures wins
  }
  return resolved
}

/** `.tex` sources from an e-print payload (tar bundle or single gzipped file). */
export async function eprintToTexSources(payload: { kind: 'tar-gz' | 'gz'; data: Buffer }): Promise<{
  texSources: string[]
  files: Map<string, Buffer>
}> {
  if (payload.kind === 'gz') {
    return {
      texSources: [payload.data.toString('utf8')],
      files: new Map()
    }
  }
  const files = await extractTarEntries(gunzipSync(payload.data))
  const texSources = [...files.entries()]
    .filter(([name]) => /\.tex$/i.test(name))
    // Root-level tex files first; the outermost source usually owns figures.
    .sort(([a], [b]) => a.split('/').length - b.split('/').length)
    .map(([, data]) => data.toString('utf8'))
  return { texSources, files }
}

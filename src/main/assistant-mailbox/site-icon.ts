// Finds a custom assistant's icon on the website the user gave: the page's apple-touch-icon or
// icon links first, then the conventional paths. The result is a data URL kept on this desktop.
const PAGE_LIMIT = 1024 * 1024
const ICON_LIMIT = 256 * 1024
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/

export function normalizeWebsite(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 200) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

/** Icon candidates from `<link rel=...icon...>` tags, best first. */
export function iconLinks(html: string, base: string): string[] {
  const scored: Array<{ href: string; score: number }> = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
    const value = (name: string) => { const m = attr(name); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '' }
    const rel = value('rel').toLowerCase()
    const href = value('href')
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel)) continue
    const size = Math.max(0, ...(value('sizes').match(/\d+/g) ?? ['0']).map(Number))
    const svg = /svg/i.test(value('type')) || /\.svg(\?|$)/i.test(href)
    const score = (rel.includes('apple-touch-icon') ? 3000 : 0) + (svg ? 2000 : 0) + Math.min(size, 1024)
    try { scored.push({ href: new URL(href, base).href, score }) } catch { /* skip malformed */ }
  }
  return scored.sort((a, b) => b.score - a.score).map((item) => item.href)
}

export async function fetchSiteIcon(website: string, fetcher: typeof fetch): Promise<string | null> {
  const origin = normalizeWebsite(website)
  if (!origin) return null
  const candidates: string[] = []
  try {
    const page = await fetcher(origin + '/', { signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' } })
    const body = page.ok ? await readLimited(page, PAGE_LIMIT) : null
    if (body) candidates.push(...iconLinks(new TextDecoder().decode(body), page.url || origin + '/'))
  } catch { /* fall back to conventional paths */ }
  candidates.push(origin + '/apple-touch-icon.png', origin + '/favicon.ico')
  for (const href of [...new Set(candidates)].slice(0, 6)) {
    if (!href.startsWith('https://')) continue
    try {
      const response = await fetcher(href, { signal: AbortSignal.timeout(8000) })
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!response.ok || !IMAGE_TYPES.test(type)) { await response.body?.cancel().catch(() => {}); continue }
      const bytes = await readLimited(response, ICON_LIMIT)
      if (bytes?.byteLength) return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
    } catch { /* try the next candidate */ }
  }
  return null
}

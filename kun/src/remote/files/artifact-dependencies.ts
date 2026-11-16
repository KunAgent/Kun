import { parse as parseHtml } from 'parse5'
import { init, parse as parseModule } from 'es-module-lexer'
import type { ArtifactBundle, PreviewAssetRecord } from './artifact-bundle.js'

const ORIGIN = 'https://kun-artifact.invalid/'
const TEXT_LIMIT = 2 * 1024 * 1024
interface Node { tagName?: string; attrs?: { name: string; value: string }[]; value?: string; childNodes?: Node[] }

function cssReferences(css: string) {
  return [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi)]
    .map(match => match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '')
}

function boundedReferences(urls: string[]) {
  if (urls.length > 512) throw new Error('ARTIFACT_ASSET_LIMIT')
  return urls
}

function localPath(base: string, reference: string) {
  const value = reference.trim()
  if (!value || value.startsWith('#') || /^(?:data|blob|https?):/i.test(value) || value.startsWith('//')) return
  try {
    const url = new URL(value, new URL(base, ORIGIN))
    if (url.origin !== new URL(ORIGIN).origin || url.username || url.password) return
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!path || /[\\\x00-\x1f]/.test(path)) return
    return path
  } catch { return }
}

async function references(record: PreviewAssetRecord) {
  const mime = record.asset.mimeType
  if (!['text/html', 'text/css', 'text/javascript', 'application/javascript', 'image/svg+xml'].includes(mime)) return []
  if (record.asset.size > TEXT_LIMIT) throw new Error('ARTIFACT_DOCUMENT_LIMIT')
  const text = (await record.read()).toString('utf8')
  if (mime === 'text/css') return boundedReferences(cssReferences(text))
  if (mime.endsWith('javascript')) {
    await init
    const [imports] = parseModule(text)
    const urls = imports.map(entry => entry.n).filter((value): value is string => Boolean(value))
    for (const match of text.matchAll(/new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)|\bfetch\(\s*(['"])([^'"]+)\3\s*[,)]/g))
      urls.push(match[2] ?? match[4]!)
    return boundedReferences(urls)
  }
  const document = parseHtml(text) as unknown as Node
  const urls: string[] = [], stack = [document]
  let visits = 0
  while (stack.length) {
    if (++visits > 20000) throw new Error('ARTIFACT_DOCUMENT_LIMIT')
    const node = stack.pop()!, tag = node.tagName ?? ''
    if (['iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta'].includes(tag)) continue
    const attrs = new Map(node.attrs?.map(attr => [attr.name, attr.value]))
    for (const key of ['src', 'poster', 'xlink:href']) {
      const value = attrs.get(key)
      if (value) urls.push(value)
    }
    const href = attrs.get('href')
    if (href && (['image', 'use'].includes(tag) || tag === 'link' && /(?:stylesheet|icon|preload|modulepreload)/i.test(attrs.get('rel') ?? '')))
      urls.push(href)
    const style = attrs.get('style')
    if (style) urls.push(...cssReferences(style))
    if (tag === 'style') urls.push(...cssReferences((node.childNodes ?? []).map(child => child.value ?? '').join('')))
    if (tag === 'script' && attrs.get('type') === 'module' && !attrs.has('src')) {
      await init
      const code = (node.childNodes ?? []).map(child => child.value ?? '').join('')
      urls.push(...parseModule(code)[0].map(entry => entry.n).filter((value): value is string => Boolean(value)))
    }
    const srcset = attrs.get('srcset')
    if (srcset && !/^data:/i.test(srcset.trim())) urls.push(...srcset.split(',').map(value => value.trim().split(/\s+/)[0]!).filter(Boolean))
    stack.push(...(node.childNodes ?? []))
  }
  return boundedReferences(urls)
}

/** Follow declared local dependencies only, through the same protected file reader as project files. */
export async function collectArtifactDependencies(
  bundle: ArtifactBundle,
  entries: readonly PreviewAssetRecord[],
  load: (from: PreviewAssetRecord, reference: string, path: string) => Promise<PreviewAssetRecord> = (_from, _reference, path) => bundle.file(path)
) {
  const queue = [...entries], seen = new Set<string>(), queued = new Set(entries.map(entry => entry.asset.id))
  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current.asset.id)) continue
    seen.add(current.asset.id)
    const dependencies = new Set<string>()
    for (const reference of await references(current)) {
      const path = localPath(current.asset.path, reference)
      if (!path || path === current.asset.path) continue
      try {
        const dependency = await load(current, reference, path)
        dependencies.add(dependency.asset.id)
        if (!queued.has(dependency.asset.id)) {
          queued.add(dependency.asset.id)
          queue.push(dependency)
        }
      } catch {
        if (bundle.missing.size < 100) bundle.missing.add(path.slice(0, 1024))
      }
    }
    if (dependencies.size) current.asset.dependencies = [...dependencies]
  }
}

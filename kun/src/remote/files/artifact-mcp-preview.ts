import type { ArtifactResourcePolicy } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { isMcpAppHtmlMimeType, normalizeMcpAppResourceMeta, resolveMcpAppRelativeResource } from '../../contracts/mcp-apps.js'
import { ArtifactBundle, type PreviewAssetRecord } from './artifact-bundle.js'
import { collectArtifactDependencies } from './artifact-dependencies.js'
import { artifactMime } from './artifact-mime.js'
import { artifactText, record, type ArtifactSource } from './artifact-sources.js'

/** Resource reads stay pinned to the server and ui:// authority of the successful source call. */
export async function buildMcpArtifact(runtime: ServerRuntime, bundle: ArtifactBundle, source: ArtifactSource) {
  const target = source.mcp
  if (!target) throw new Error('ARTIFACT_UNAVAILABLE')
  const access = () => {
    const current = runtime.mcpApps?.()
    if (!current || !current.catalog(bundle.root).some(entry => entry.serverId === target.serverId &&
      entry.resourceUri === target.resourceUri && entry.toolName === target.toolName)) throw new Error('ARTIFACT_UNAVAILABLE')
    return current
  }
  const read = async (uri: string) => {
    const response = record(await access().readResource(target.serverId, uri, bundle.root, AbortSignal.timeout(15000)))
    const contents = Array.isArray(response?.contents) ? response.contents : []
    const content = contents.map(record).find(item => item?.uri === uri) ?? record(contents[0])
    if (!content) throw new Error('ARTIFACT_UNAVAILABLE')
    const data = typeof content.text === 'string' ? Buffer.from(content.text, 'utf8')
      : typeof content.blob === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(content.blob) ? Buffer.from(content.blob, 'base64') : null
    if (!data || !data.length || data.length > 2 * 1024 * 1024) throw new Error('ARTIFACT_DOCUMENT_LIMIT')
    return { data, mimeType: artifactText(content.mimeType, 120), meta: normalizeMcpAppResourceMeta(content._meta) }
  }
  const initial = await read(target.resourceUri)
  if (!isMcpAppHtmlMimeType(initial.mimeType)) throw new Error('ARTIFACT_FORMAT_UNSUPPORTED')
  const uris = new Map<string, string>([['mcp/index.html', target.resourceUri]])
  const entry = await bundle.provided('mcp/index.html', async () => (await read(target.resourceUri)).data, 'text/html')
  const load = async (from: PreviewAssetRecord, reference: string, path: string) => {
    const base = uris.get(from.asset.path)
    const resolved = base ? new URL(reference, base) : undefined
    const uri = base && resolved && resolved.protocol === 'ui:' && resolved.host === new URL(base).host
      ? resolveMcpAppRelativeResource(base, resolved.pathname.replace(/^\//, '')) : null
    if (!uri) throw new Error('FILE_NOT_ALLOWED')
    const resource = await read(uri)
    uris.set(path, uri)
    return bundle.provided(path, async () => (await read(uri)).data, artifactMime(path, resource.mimeType || 'application/octet-stream'))
  }
  await collectArtifactDependencies(bundle, [entry], load)
  const exactOrigins = (values: string[] | undefined) => [...new Set(values ?? [])].filter(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password } catch { return false }
  }).slice(0, 24)
  const origins = exactOrigins(initial.meta.csp?.resourceDomains)
  const policy: ArtifactResourcePolicy = {
    assetOrigins: origins,
    scriptOrigins: origins.slice(0, 12),
    connectOrigins: exactOrigins(initial.meta.csp?.connectDomains)
  }
  const context = bundle.json('mcp/context.json', {
    version: 1, serverId: target.serverId, toolName: target.toolName,
    resourceUri: target.resourceUri, input: source.toolInput ?? {}, result: source.toolOutput ?? null
  })
  return { entryAssetId: entry.asset.id, dataAssetId: context.asset.id, resourcePolicy: policy }
}

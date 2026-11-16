import { opendir, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { ArtifactBundle } from './artifact-bundle.js'
import { inside } from './project-content.js'
import { permittedProjectFile } from './project-file-permissions.js'
import { artifactText, record, type ArtifactSource, type PreviewSourcePage } from './artifact-sources.js'

/** Desktop metadata is interpreted on the host; clients never crawl its private storage schema. */
export async function designPreviewPages(runtime: ServerRuntime, bundle: ArtifactBundle, source: ArtifactSource) {
  const known = new Map((source.pages ?? []).map(page => [page.id, { ...page, x: 0, y: 0 }]))
  if (!source.documentId || !/^[a-f0-9]{8}$/.test(source.documentId)) return [...known.values()]
  const directoryPath = `.kun-design/${source.documentId}`
  let directory
  try {
    const path = await realpath(resolve(bundle.root, directoryPath))
    if (!inside(bundle.root, path) || !await permittedProjectFile(runtime, bundle.root, path)) throw new Error('FILE_NOT_ALLOWED')
    directory = await opendir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [...known.values()]
    throw error
  }
  let count = 0
  try {
    for await (const entry of directory) {
      if (++count > 512) throw new Error('ARTIFACT_ASSET_LIMIT')
      if (!/^[a-f0-9]{8}$/.test(entry.name)) continue
      const prefix = `${directoryPath}/${entry.name}`
      const meta = record(await bundle.metadata(`${prefix}/meta.json`).catch(() => undefined))
      if (!meta || meta.kind !== 'html') continue
      const previous = known.get(entry.name)
      const versions = Array.isArray(meta.versions) ? meta.versions : []
      const latest = record(versions.at(-1))
      const candidate = artifactText(latest?.relativePath ?? meta.relativePath, 1024)
      const pattern = new RegExp(`^\\.kun-design/${source.documentId}/${entry.name}/v[1-9][0-9]*\\.html$`)
      if (!pattern.test(candidate)) continue
      const node = record(meta.node)
      const dimension = (value: unknown, fallback: number, max: number) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(max, Math.round(value)) : fallback
      const section = artifactText(meta.boardSection, 120) || previous?.section
      const page: PreviewSourcePage & { x: number; y: number } = {
        id: entry.name, title: artifactText(meta.title) || previous?.title || entry.name,
        path: candidate, width: dimension(node?.width, previous?.width ?? 390, 10000),
        height: dimension(node?.height, previous?.height ?? 844, 20000),
        x: typeof node?.x === 'number' && Number.isFinite(node.x) ? node.x : 0,
        y: typeof node?.y === 'number' && Number.isFinite(node.y) ? node.y : 0,
        ...(section ? { section } : {})
      }
      known.set(page.id, page)
    }
  } finally { await directory.close().catch(() => undefined) }
  return [...known.values()].sort((left, right) => left.y - right.y || left.x - right.x)
}

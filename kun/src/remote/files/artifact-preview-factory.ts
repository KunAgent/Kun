import type { ArtifactPreview, ArtifactSummary, ResourceRef } from '@kun/remote-protocol'
import { validateArtifactPreview } from '@kun/remote-protocol'
import { ChartSpecV1Schema } from '@kun/extension-api'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { DataReportFileSchema } from '../../contracts/data-report.js'
import { ConversationVisualizationV1Schema } from '../../contracts/conversation-visualization.js'
import { GEN_UI_STATIC_ORIGINS } from '../../contracts/gen-ui.js'
import { readableAgentArtifact, artifactDownloadName, artifactMimeType } from '../agents/library/access.js'
import { ArtifactBundle, artifactHash } from './artifact-bundle.js'
import { collectArtifactDependencies } from './artifact-dependencies.js'
import { designPreviewPages } from './artifact-design-pages.js'
import { buildMcpArtifact } from './artifact-mcp-preview.js'
import { record, type ArtifactSource } from './artifact-sources.js'

export interface PreparedArtifact {
  preview: ArtifactPreview
  bundle: ArtifactBundle
  source: ArtifactSource
  root: string
}

export function artifactIdentity(resource: ResourceRef, source: ArtifactSource) {
  return 'artifact_' + artifactHash(JSON.stringify([resource.kind, resource.id, source.key])).slice(0, 48)
}

export function unavailableArtifact(resource: ResourceRef, source: ArtifactSource): ArtifactSummary {
  return {
    id: artifactIdentity(resource, source), resource, kind: source.kind, title: source.title,
    name: source.title, mimeType: 'application/octet-stream', size: 0,
    revision: 'artifact-v1:' + artifactHash(JSON.stringify([source.key, source.itemId, source.updatedAt])),
    available: false, messageId: source.itemId,
    ...(source.turnId ? { turnId: source.turnId } : {}),
    ...(source.updatedAt ? { updatedAt: source.updatedAt } : {}),
    detail: 'ARTIFACT_UNAVAILABLE'
  }
}

/** Produce a content-addressed read snapshot without running any author code. */
export async function prepareArtifact(
  runtime: ServerRuntime,
  resource: ResourceRef,
  root: string,
  source: ArtifactSource
): Promise<PreparedArtifact> {
  const bundle = new ArtifactBundle(runtime, root)
  const preview: ArtifactPreview = {
    version: 1, artifact: { ...unavailableArtifact(resource, source), available: true },
    renderer: 'file', assets: [], pages: []
  }
  delete preview.artifact.detail

  if (source.agentArtifact) {
    const { id, version } = source.agentArtifact
    const meta = await readableAgentArtifact(runtime, resource.id, id, version)
    const name = artifactDownloadName(meta), mime = artifactMimeType(meta)
    const entry = await bundle.provided(`agent/${id}/${version}/${name}`, async () => {
      const current = await readableAgentArtifact(runtime, resource.id, id, version)
      if (current.sha256 !== meta.sha256) throw new Error('ARTIFACT_CHANGED')
      return (await runtime.rooms!.artifactLibrary.read(resource.id, id, version)).data
    }, mime)
    preview.entryAssetId = entry.asset.id
    preview.originalAssetId = entry.asset.id
    preview.artifact.name = name
    if (mime === 'text/html') preview.renderer = 'html'
  } else if (source.kind === 'design' || source.kind === 'slides') {
    const pages = source.kind === 'design' ? await designPreviewPages(runtime, bundle, source) : source.pages ?? []
    if (!pages.length) throw new Error('ARTIFACT_UNAVAILABLE')
    const entries = []
    for (const page of pages) {
      const entry = await bundle.file(page.path)
      entries.push(entry)
      preview.pages.push({ id: page.id, title: page.title, assetId: entry.asset.id,
        width: page.width, height: page.height, ...(page.section ? { section: page.section } : {}) })
    }
    await collectArtifactDependencies(bundle, entries)
    preview.renderer = 'pages'
    preview.artifact.pageCount = preview.pages.length
    if (source.originalPath) {
      const original = await bundle.file(source.originalPath).catch(() => undefined)
      if (original) preview.originalAssetId = original.asset.id
    }
  } else if (source.kind === 'widget' && source.widget) {
    const widget = source.widget
    const store = runtime.genUi?.store
    if (!store || resource.kind !== 'code') throw new Error('ARTIFACT_UNAVAILABLE')
    const entry = await bundle.provided(`widgets/${widget.widgetId}.html`, async () => {
      const html = await store.readWidget(widget.widgetId)
      if (!html || artifactHash(html) !== widget.sha256 || Buffer.byteLength(html, 'utf8') !== widget.bytes)
        throw new Error('ARTIFACT_CHANGED')
      return Buffer.from(html, 'utf8')
    }, 'text/html')
    preview.renderer = 'html'
    preview.entryAssetId = entry.asset.id
    preview.widgetState = (await store.readState(resource.id)).find(entry => entry.widgetId === widget.widgetId)?.state
    preview.resourcePolicy = {
      assetOrigins: [...GEN_UI_STATIC_ORIGINS], scriptOrigins: [...GEN_UI_STATIC_ORIGINS], connectOrigins: []
    }
    await collectArtifactDependencies(bundle, [entry])
  } else if (source.kind === 'mcp-app') {
    Object.assign(preview, await buildMcpArtifact(runtime, bundle, source))
    preview.renderer = 'html'
  } else if (source.kind === 'chart' || source.kind === 'visualization') {
    const data = source.kind === 'chart' ? ChartSpecV1Schema.parse(source.data)
      : ConversationVisualizationV1Schema.parse(source.data)
    preview.dataAssetId = bundle.json(`data/${source.kind}.json`, data).asset.id
    preview.renderer = 'data'
  } else if (source.kind === 'report' || source.kind === 'canvas') {
    if (!source.path) throw new Error('ARTIFACT_UNAVAILABLE')
    const entry = await bundle.file(source.path, 'application/json')
    if (entry.asset.size > 8 * 1024 * 1024) throw new Error('ARTIFACT_DOCUMENT_LIMIT')
    const data: unknown = JSON.parse((await entry.read()).toString('utf8'))
    if (source.kind === 'report') {
      const report = DataReportFileSchema.parse(data)
      if (report.threadId && report.threadId !== resource.id) throw new Error('FILE_NOT_ALLOWED')
      preview.artifact.title = report.title
      preview.artifact.updatedAt = report.updatedAt
    } else {
      const scene = record(data)
      if (!scene || !Array.isArray(scene.elements) || scene.elements.length > 10000) throw new Error('ARTIFACT_FORMAT_UNSUPPORTED')
    }
    preview.dataAssetId = entry.asset.id
    preview.originalAssetId = entry.asset.id
    preview.renderer = 'data'
  } else {
    if (!source.path) throw new Error('ARTIFACT_UNAVAILABLE')
    const entry = await bundle.file(source.path)
    preview.entryAssetId = entry.asset.id
    preview.originalAssetId = entry.asset.id
    preview.artifact.name = entry.asset.name
    if (entry.asset.mimeType === 'text/html' || source.kind === 'component' || source.kind === 'diagram') {
      preview.renderer = 'html'
      preview.resourcePolicy = source.resourcePolicy
      preview.viewport = source.viewport
      await collectArtifactDependencies(bundle, [entry])
    } else if (entry.asset.mimeType === 'image/svg+xml') {
      preview.renderer = 'pages'
      preview.pages = [{ id: 'image', title: source.title, assetId: entry.asset.id, width: 1280, height: 800 }]
      await collectArtifactDependencies(bundle, [entry])
    }
  }

  preview.assets = bundle.assets
  if (bundle.missing.size) preview.missingResources = [...bundle.missing]
  preview.artifact.mimeType = preview.renderer === 'data' ? 'application/json'
    : preview.entryAssetId ? bundle.records.get(preview.entryAssetId)!.asset.mimeType
      : preview.pages.length ? bundle.records.get(preview.pages[0]!.assetId)!.asset.mimeType : 'application/octet-stream'
  preview.artifact.size = preview.assets.reduce((total, asset) => total + asset.size, 0)
  preview.artifact.revision = 'artifact-v1:' + artifactHash(JSON.stringify([
    resource, source.key, preview.artifact.title, preview.pages, preview.viewport, preview.resourcePolicy, bundle.fingerprint()
  ]))
  validateArtifactPreview(preview)
  return { preview, bundle, source, root }
}

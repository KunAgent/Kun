import { basename } from 'node:path'
import type { ArtifactKind, ArtifactResourcePolicy } from '@kun/remote-protocol'
import type { GenUiWidgetRef } from '../../contracts/gen-ui.js'
import { parseMcpAppToolOutputMeta, type McpAppToolOutputMeta } from '../../contracts/mcp-apps.js'

export interface PreviewSourcePage {
  id: string
  title: string
  path: string
  width: number
  height: number
  section?: string
}

export interface ArtifactSource {
  key: string
  kind: ArtifactKind
  title: string
  itemId: string
  turnId?: string
  updatedAt?: string
  path?: string
  originalPath?: string
  documentId?: string
  pages?: PreviewSourcePage[]
  data?: Record<string, unknown>
  widget?: GenUiWidgetRef
  mcp?: McpAppToolOutputMeta
  toolOutput?: unknown
  toolInput?: Record<string, unknown>
  viewport?: { width: number; height: number }
  resourcePolicy?: ArtifactResourcePolicy
  agentArtifact?: { id: string; version: number }
}

export interface ArtifactToolItem {
  id: string
  kind: string
  toolName?: string
  turnId?: string
  createdAt?: string
  updatedAt?: string
  output?: unknown
  callId?: string
  arguments?: Record<string, unknown>
  meta?: unknown
  isError?: boolean
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

export function artifactText(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : ''
}

function dimension(value: unknown, fallback: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(max, Math.round(value)) : fallback
}

function viewport(value: unknown) {
  const entry = record(value)
  return { width: dimension(entry?.width, 390, 10000), height: dimension(entry?.height, 844, 20000) }
}

function toolName(name: unknown) {
  const value = artifactText(name, 160)
  return value.startsWith('mcp__kun__') ? value.slice(10) : value.startsWith('mcp:kun/') ? value.slice(8) : value
}

/** Native and delegated MCP results share the same bounded JSON envelope adapter. */
export function artifactPayloads(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 3) return []
  if (typeof value === 'string') {
    if (value.length > 2 * 1024 * 1024) return []
    try { return artifactPayloads(JSON.parse(value), depth + 1) } catch { return [] }
  }
  const payload = record(value)
  if (!payload) return []
  const content = Array.isArray(payload.content) ? payload.content.slice(0, 16) : []
  return [payload, ...artifactPayloads(payload.result, depth + 1),
    ...content.flatMap(entry => artifactPayloads(record(entry)?.text, depth + 1))].slice(0, 32)
}

function source(item: ArtifactToolItem, kind: ArtifactKind, key: string, title: unknown): ArtifactSource {
  const date = artifactText(item.updatedAt ?? item.createdAt, 64)
  return { key: `${kind}:${key}`, kind, title: artifactText(title) || kind, itemId: item.id,
    ...(item.turnId ? { turnId: item.turnId } : {}),
    ...(date && Number.isFinite(Date.parse(date)) ? { updatedAt: date } : {}) }
}

function design(item: ArtifactToolItem, value: unknown): ArtifactSource | undefined {
  const request = record(value)
  const documentId = artifactText(request?.documentId, 16)
  if (request?.version !== 2 || request.status !== 'ready' || !/^[a-f0-9]{8}$/.test(documentId) || !Array.isArray(request.screens)) return
  const pages: PreviewSourcePage[] = []
  for (const value of request.screens.slice(0, 12)) {
    const screen = record(value), id = artifactText(screen?.artifactId, 16)
    if (!/^[a-f0-9]{8}$/.test(id) || screen?.relativePath !== `.kun-design/${documentId}/${id}/v1.html`) continue
    const section = artifactText(screen.section, 120)
    pages.push({ id, title: artifactText(screen.name) || id, path: screen.relativePath as string,
      ...viewport(screen), ...(section ? { section } : {}) })
  }
  if (pages.length) return { ...source(item, 'design', documentId, request.title), documentId, pages }
}

function prototype(item: ArtifactToolItem, value: unknown, kind: 'component' | 'diagram'): ArtifactSource | undefined {
  const payload = record(value), path = artifactText(payload?.relativePath, 1024)
  const folder = kind === 'component' ? 'component-prototypes' : 'diagram-prototypes'
  if (payload?.version !== 1 || payload.status !== 'completed' ||
    !new RegExp(`^\\.kun-design/${folder}/[A-Za-z0-9_-]+/(?:prototype|diagram)\\.html$`).test(path)) return
  const result = { ...source(item, kind, path, payload.title), path, viewport: viewport(payload.viewport) }
  const policy = record(payload.resourcePolicy)
  return policy ? { ...result, resourcePolicy: policy as ArtifactResourcePolicy } : result
}

function slides(item: ArtifactToolItem, payload: Record<string, unknown>): ArtifactSource | undefined {
  const review = record(payload.reviewBundle), direction = record(payload.directionBundle)
  const deck = artifactText(payload.deck, 1024)
  if (review && Array.isArray(review.slides)) {
    const pages: PreviewSourcePage[] = []
    for (const entry of review.slides.slice(0, 200)) {
      const slide = record(entry), path = artifactText(slide?.previewPath, 1024)
      if (!path || slide?.status !== 'ready') continue
      pages.push({ id: artifactText(slide.slideId, 128) || `slide-${pages.length + 1}`,
        title: artifactText(slide.title) || `Slide ${pages.length + 1}`, path, width: 960, height: 540 })
    }
    const original = artifactText(payload.output, 1024)
    if (pages.length) return { ...source(item, 'slides', deck || artifactText(review.workflowId), review.deckTitle), pages,
      ...(original.toLowerCase().endsWith('.pptx') ? { originalPath: original } : {}) }
  }
  if (direction && Array.isArray(direction.directions)) {
    const pages: PreviewSourcePage[] = []
    for (const value of direction.directions.slice(0, 3)) {
      const choice = record(value)
      for (const entry of Array.isArray(choice?.previews) ? choice.previews.slice(0, 3) : []) {
        const preview = record(entry), path = artifactText(preview?.imagePath, 1024)
        if (!path) continue
        pages.push({ id: `direction-${pages.length + 1}`, title: `${artifactText(choice?.name)} · ${artifactText(preview?.role)}`,
          path, width: 960, height: 540, section: artifactText(choice?.name) || 'Directions' })
      }
    }
    if (pages.length) return { ...source(item, 'slides', deck || artifactText(direction.workflowId), direction.deckTitle), pages }
  }
}

/** Only successful structured tool deliveries produce entries; ordinary assistant prose never does. */
export function artifactSources(item: ArtifactToolItem): ArtifactSource[] {
  if (item.kind !== 'tool_result' || item.isError) return []
  const output: ArtifactSource[] = [], name = toolName(item.toolName)
  const meta = record(item.meta)
  const widget = record(meta?.genUi)
  if (widget && /^gw_[a-f0-9]{64}$/.test(artifactText(widget.widgetId, 80)) &&
    /^[a-f0-9]{64}$/.test(artifactText(widget.sha256, 64))) {
    output.push({ ...source(item, 'widget', widget.widgetId as string, widget.title), widget: widget as unknown as GenUiWidgetRef })
  }
  for (const payload of artifactPayloads(item.output)) {
    if (name === 'design_open') {
      const entry = design(item, payload.designRequest)
      if (entry) output.push(entry)
    }
    if (name === 'design_component' || name === 'show_diagram') {
      const entry = prototype(item, name === 'design_component' ? payload.componentPrototype : payload.diagramPrototype,
        name === 'design_component' ? 'component' : 'diagram')
      if (entry) output.push(entry)
    }
    if (name === 'render_chart' && record(payload.chart)?.version === 1) {
      output.push({ ...source(item, 'chart', item.id, record(payload.chart)?.title), data: payload.chart as Record<string, unknown> })
    }
    if (name === 'show_visualization' && record(payload.conversationVisualization)?.version === 1) {
      const data = payload.conversationVisualization as Record<string, unknown>
      output.push({ ...source(item, 'visualization', item.id, data.title), data })
    }
    if (name === 'report_open') {
      const report = record(payload.reportRequest ?? payload.reportOpenRequest)
      const path = artifactText(report?.relativePath, 1024)
      if (report?.version === 1 && /^\.kun-reports\/[a-f0-9]{10}\.json$/.test(path))
        output.push({ ...source(item, 'report', path, report.title), path })
    }
    if (name === 'ppt_preview' || name === 'ppt_export') {
      const entry = slides(item, payload)
      if (entry) output.push(entry)
    }
    const mcp = parseMcpAppToolOutputMeta(payload.mcpApp ?? record(payload.meta)?.mcpApp ?? meta?.mcpApp)
    if (mcp) output.push({ ...source(item, 'mcp-app', `${mcp.serverId}:${mcp.resourceUri}:${item.id}`, mcp.surface || mcp.toolName),
      mcp, toolOutput: payload })
    if (name === 'design_apply_excalidraw' || name === 'design_open_excalidraw') {
      const boardId = artifactText(payload.boardId, 128)
      if (/^[A-Za-z0-9_-]{1,128}$/.test(boardId) && payload.status === 'applied') {
        output.push({ ...source(item, 'canvas', boardId, payload.title ?? boardId), path: `.kun-whiteboards/${boardId}/excalidraw.json` })
      }
    }
    for (const value of [...(Array.isArray(payload.generatedFiles) ? payload.generatedFiles : []),
      ...(Array.isArray(payload.generatedArtifacts) ? payload.generatedArtifacts : [])].slice(0, 64)) {
      const file = record(value), path = artifactText(file?.relativePath ?? file?.path ?? file?.absolutePath, 2048)
      if (!path) continue
      output.push({ ...source(item, 'file', path, file?.name ?? basename(path)), path })
    }
  }
  return [...new Map(output.map(entry => [entry.key, entry])).values()]
}

/** Merge oldest to newest, keeping first board placement and the newest metadata for each board. */
export function mergeArtifactSources(items: readonly ArtifactToolItem[]) {
  const merged = new Map<string, ArtifactSource>()
  const calls = new Map<string, Record<string, unknown>>()
  for (const item of items) {
    if (item.kind === 'tool_call' && item.callId && record(item.arguments) &&
      JSON.stringify(item.arguments).length <= 64 * 1024) calls.set(item.callId, item.arguments!)
    for (const next of artifactSources(item)) {
      if (next.kind === 'mcp-app' && item.callId) next.toolInput = calls.get(item.callId)
      const previous = merged.get(next.key)
      if (previous?.kind === 'design' && next.kind === 'design') {
        const pages = new Map(previous.pages?.map(page => [page.id, page]))
        for (const page of next.pages ?? []) pages.set(page.id, page)
        merged.set(next.key, { ...next, pages: [...pages.values()] })
      } else merged.set(next.key, next)
    }
  }
  return [...merged.values()].reverse()
}

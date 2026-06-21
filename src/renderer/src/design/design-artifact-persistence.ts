/**
 * Durable design-artifact metadata. The in-memory artifact list is mirrored to
 * a per-artifact `.kun-design/<id>/meta.json` sidecar so the list survives a
 * reload/restart (the HTML/canvas files alone can't recover title / versions /
 * implement provenance). On load the store rehydrates from these sidecars,
 * falling back to reconstructing from the on-disk files when a sidecar is
 * missing (artifacts created before this existed, or hand-authored dirs).
 */
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  defaultDesignArtifactNode,
  type DesignArtifact,
  type DesignArtifactNode
} from './design-types'

const DESIGN_DIR = '.kun-design'

export function artifactDirPath(id: string): string {
  return `${DESIGN_DIR}/${id}`
}

export function artifactMetaPath(id: string): string {
  return `${DESIGN_DIR}/${id}/meta.json`
}

export function artifactDesignMdPath(id: string): string {
  return `${DESIGN_DIR}/${id}/DESIGN.md`
}

export function serializeArtifactMeta(artifact: DesignArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseNode(value: unknown): DesignArtifactNode | undefined {
  if (!value || typeof value !== 'object') return undefined
  const node = value as Record<string, unknown>
  if (!isNum(node.x) || !isNum(node.y) || !isNum(node.width) || !isNum(node.height)) {
    return undefined
  }
  const viewMode =
    node.viewMode === 'code' || node.viewMode === 'live' || node.viewMode === 'preview'
      ? node.viewMode
      : undefined
  return {
    x: node.x,
    y: node.y,
    width: Math.max(240, node.width),
    height: Math.max(180, node.height),
    ...(node.sizeMode === 'auto' || node.sizeMode === 'manual' ? { sizeMode: node.sizeMode } : {}),
    ...(typeof node.favorite === 'boolean' ? { favorite: node.favorite } : {}),
    ...(viewMode ? { viewMode } : {})
  }
}

/** Parse a persisted meta.json into a DesignArtifact, defaulting from the dir id. */
export function parseArtifactMeta(raw: string, dirId: string): DesignArtifact | null {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const relativePath = isStr(o.relativePath) ? o.relativePath : ''
  if (!relativePath) return null
  const id = isStr(o.id) ? o.id : dirId
  const createdAt = isStr(o.createdAt) ? o.createdAt : new Date(0).toISOString()
  const updatedAt = isStr(o.updatedAt) ? o.updatedAt : createdAt
  const versions = Array.isArray(o.versions)
    ? o.versions
        .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object')
        .map((v) => ({
          id: isStr(v.id) ? v.id : id,
          relativePath: isStr(v.relativePath) ? v.relativePath : relativePath,
          createdAt: isStr(v.createdAt) ? v.createdAt : createdAt,
          summary: isStr(v.summary) ? v.summary : ''
        }))
    : []
  const parsedNode = parseNode(o.node)
  const kind: DesignArtifact['kind'] = o.kind === 'canvas' ? 'canvas' : 'html'
  const previewStatus =
    o.previewStatus === 'pending' || o.previewStatus === 'ready' || o.previewStatus === 'error'
      ? o.previewStatus
      : undefined
  return {
    id,
    kind,
    title: isStr(o.title) ? o.title : dirId,
    relativePath,
    createdAt,
    updatedAt,
    versions: versions.length > 0 ? versions : [{ id, relativePath, createdAt, summary: '' }],
    ...(kind === 'html' ? { designMdPath: isStr(o.designMdPath) ? o.designMdPath : artifactDesignMdPath(id) } : {}),
    ...(previewStatus ? { previewStatus } : {}),
    ...(parsedNode ? { node: parsedNode } : {}),
    implementedAt: isStr(o.implementedAt) ? o.implementedAt : undefined,
    implementedThreadId: isStr(o.implementedThreadId) ? o.implementedThreadId : undefined,
    implementedDesignSystemHash: isStr(o.implementedDesignSystemHash) ? o.implementedDesignSystemHash : undefined
  }
}

/** Reconstruct an artifact from on-disk files when no meta.json sidecar exists. */
export function reconstructArtifact(dirId: string, entries: WorkspaceEntry[]): DesignArtifact | null {
  const files = entries.filter((e) => e.type === 'file')
  const hasCanvas = files.some((f) => f.name === 'canvas.json')
  const htmlVersions = files
    .map((f) => /^v(\d+)\.html$/.exec(f.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a)
  if (!hasCanvas && htmlVersions.length === 0) return null
  const now = new Date().toISOString()
  const kind: DesignArtifact['kind'] = hasCanvas ? 'canvas' : 'html'
  const relativePath = hasCanvas
    ? `${DESIGN_DIR}/${dirId}/canvas.json`
    : `${DESIGN_DIR}/${dirId}/v${htmlVersions[0]}.html`
  const versions =
    kind === 'html'
      ? htmlVersions.map((n) => ({
          id: `${dirId}-v${n}`,
          relativePath: `${DESIGN_DIR}/${dirId}/v${n}.html`,
          createdAt: now,
          summary: ''
        }))
      : [{ id: dirId, relativePath, createdAt: now, summary: '' }]
  return {
    id: dirId,
    kind,
    title: dirId,
    relativePath,
    createdAt: now,
    updatedAt: now,
    versions,
    ...(kind === 'html' ? { designMdPath: artifactDesignMdPath(dirId) } : {}),
    node: defaultDesignArtifactNode(0)
  }
}

/** Fire-and-forget write of an artifact's meta.json sidecar. */
export function persistArtifactMeta(workspaceRoot: string, artifact: DesignArtifact): void {
  if (!workspaceRoot || typeof window.kunGui?.writeWorkspaceFile !== 'function') return
  void window.kunGui
    .writeWorkspaceFile({
      path: artifactMetaPath(artifact.id),
      workspaceRoot,
      content: serializeArtifactMeta(artifact)
    })
    .catch(() => undefined)
}

/** Fire-and-forget delete of an artifact's whole on-disk dir (keeps disk in sync with the list). */
export function deleteArtifactDir(workspaceRoot: string, artifactId: string): void {
  if (!workspaceRoot || typeof window.kunGui?.deleteWorkspaceEntry !== 'function') return
  void window.kunGui.deleteWorkspaceEntry({ path: artifactDirPath(artifactId), workspaceRoot }).catch(() => undefined)
}

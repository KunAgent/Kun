/**
 * Durable design-artifact metadata. The in-memory artifact list is mirrored to
 * a per-artifact `.kun-design/<id>/meta.json` sidecar so the list survives a
 * reload/restart (the HTML/SVG/canvas files alone can't recover title / versions /
 * implement provenance). On load the store rehydrates from these sidecars,
 * falling back to reconstructing from the on-disk files when a sidecar is
 * missing (artifacts created before this existed, or hand-authored dirs).
 */
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  deleteDesignWorkspaceEntry,
  writeDesignWorkspaceFile
} from './design-persistence-coordinator'
import {
  defaultDesignArtifactNode,
  type DesignArtifact,
  type DesignDirection,
  type DesignArtifactNode,
  type DesignArtifactVersion,
  type DesignPrototypeLink
} from './design-types'

const DESIGN_DIR = '.kun-design'

// --- Construction helpers: build paths for an artifact nested under its 设计稿.
export function artifactDirPath(docId: string, artifactId: string): string {
  return `${DESIGN_DIR}/${docId}/${artifactId}`
}

export function artifactMetaPath(docId: string, artifactId: string): string {
  return `${artifactDirPath(docId, artifactId)}/meta.json`
}

export function artifactDesignMdPath(docId: string, artifactId: string): string {
  return `${artifactDirPath(docId, artifactId)}/DESIGN.md`
}

// --- Derivation helpers: recover sibling paths from an artifact's stored
// relativePath. Works uniformly for nested (.kun-design/<doc>/<id>/v1.html) and
// legacy-flat (.kun-design/<id>/v1.html) artifacts, so persistence/deletion need
// no docId — the path already encodes where the files live.
export function artifactDirOf(relativePath: string): string {
  const i = relativePath.lastIndexOf('/')
  return i <= 0 ? DESIGN_DIR : relativePath.slice(0, i)
}

export function artifactMetaPathOf(relativePath: string): string {
  return `${artifactDirOf(relativePath)}/meta.json`
}

export function artifactDesignMdPathOf(relativePath: string): string {
  return `${artifactDirOf(relativePath)}/DESIGN.md`
}

export function serializeArtifactMeta(artifact: DesignArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseNode(
  value: unknown,
  minimumSize: { width: number; height: number } = { width: 240, height: 180 }
): DesignArtifactNode | undefined {
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
    width: Math.max(minimumSize.width, node.width),
    height: Math.max(minimumSize.height, node.height),
    ...(node.sizeMode === 'auto' || node.sizeMode === 'manual' || node.sizeMode === 'manual-width-auto-height'
      ? { sizeMode: node.sizeMode }
      : {}),
    ...(typeof node.favorite === 'boolean' ? { favorite: node.favorite } : {}),
    ...(typeof node.boardHidden === 'boolean' ? { boardHidden: node.boardHidden } : {}),
    ...(parseBoardHiddenVersionIds(node.boardHiddenVersionIds) ?? {}),
    ...(viewMode ? { viewMode } : {})
  }
}

function parseBoardHiddenVersionIds(value: unknown): Pick<DesignArtifactNode, 'boardHiddenVersionIds'> | null {
  if (!Array.isArray(value)) return null
  const versionIds = [...new Set(
    value.filter((item): item is string => isStr(item) && item.trim().length > 0)
  )]
  return versionIds.length > 0 ? { boardHiddenVersionIds: versionIds } : null
}

function parsePrototypeLinks(value: unknown): DesignPrototypeLink[] | undefined {
  if (!Array.isArray(value)) return undefined
  const links = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const targetTitle = isStr(item.targetTitle) ? item.targetTitle.trim() : ''
      const targetArtifactId = isStr(item.targetArtifactId) ? item.targetArtifactId.trim() : ''
      const href = isStr(item.href) ? item.href.trim() : ''
      const label = isStr(item.label) ? item.label.trim() : ''
      if (!targetTitle && !targetArtifactId) return null
      return {
        targetTitle: targetTitle || targetArtifactId,
        ...(targetArtifactId ? { targetArtifactId } : {}),
        ...(href ? { href } : {}),
        ...(label ? { label } : {})
      }
    })
    .filter((item): item is DesignPrototypeLink => item !== null)
  return links.length > 0 ? links : undefined
}

function parseDirection(value: unknown): DesignDirection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  const id = isStr(item.id) ? item.id.trim() : ''
  const name = isStr(item.name) ? item.name.trim() : ''
  if (!id || !name) return undefined
  const status =
    item.status === 'active' || item.status === 'accepted' || item.status === 'archived'
      ? item.status
      : undefined
  const createdAt = isStr(item.createdAt) ? item.createdAt : ''
  return {
    id,
    name,
    ...(status ? { status } : {}),
    ...(createdAt ? { createdAt } : {})
  }
}

function versionIdForRelativePath(artifactId: string, relativePath: string): string {
  const match = /\/v(\d+)\.(?:html?|svg)$/i.exec(relativePath)
  return match ? `${artifactId}-v${match[1]}` : artifactId
}

function versionsWithCurrentPresent(
  artifactId: string,
  relativePath: string,
  createdAt: string,
  versions: DesignArtifactVersion[]
): DesignArtifactVersion[] {
  const fallback = {
    id: versionIdForRelativePath(artifactId, relativePath),
    relativePath,
    createdAt,
    summary: ''
  }
  const list = versions.length > 0 ? versions : [fallback]
  const currentIndex = list.findIndex((version) => version.relativePath === relativePath)
  return currentIndex < 0 ? [fallback, ...list] : list
}

function svgRootAttribute(source: string, name: string): string | undefined {
  const root = /<svg\b[^>]*>/i.exec(source)?.[0]
  if (!root) return undefined
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\s${escaped}\\s*=\\s*["']([^"']+)["']`, 'i').exec(root)?.[1]?.trim()
}

function svgNumericLength(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value.trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Infer a sensible whiteboard frame from a hand-authored SVG without meta.json. */
export function inferSvgArtifactNode(source: string, index = 0): DesignArtifactNode {
  const fallback = defaultDesignArtifactNode(index)
  const viewBox = svgRootAttribute(source, 'viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
  const viewBoxWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0
    ? viewBox[2]
    : null
  const viewBoxHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0
    ? viewBox[3]
    : null
  let width = svgNumericLength(svgRootAttribute(source, 'width'))
  let height = svgNumericLength(svgRootAttribute(source, 'height'))
  if (width === null && height !== null && viewBoxWidth && viewBoxHeight) {
    width = height * (viewBoxWidth / viewBoxHeight)
  }
  if (height === null && width !== null && viewBoxWidth && viewBoxHeight) {
    height = width * (viewBoxHeight / viewBoxWidth)
  }
  width ??= viewBoxWidth
  height ??= viewBoxHeight
  if (width === null || height === null) return fallback
  return {
    ...fallback,
    width: Math.min(4096, Math.max(64, Math.round(width))),
    height: Math.min(4096, Math.max(64, Math.round(height))),
    sizeMode: 'manual',
    viewMode: 'preview'
  }
}

function safeArtifactDirectory(artifactDir: string, dirId: string): string | null {
  const normalized = artifactDir.replace(/\/+$/, '')
  const segments = normalized.split('/')
  if (
    segments[0] !== DESIGN_DIR ||
    (segments.length !== 2 && segments.length !== 3) ||
    segments.at(-1) !== dirId ||
    segments.slice(1).some((segment) =>
      !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    return null
  }
  return normalized
}

function artifactFileInDirectory(
  relativePath: string,
  artifactDir: string,
  kind: DesignArtifact['kind']
): boolean {
  if (!relativePath.startsWith(`${artifactDir}/`)) return false
  const name = relativePath.slice(artifactDir.length + 1)
  if (!name || name.includes('/') || name.includes('\\')) return false
  if (kind === 'canvas') return name === 'canvas.json'
  return kind === 'svg' ? /^v\d+\.svg$/i.test(name) : /^v\d+\.html$/i.test(name)
}

/** Parse persisted metadata while binding every identity/path to its actual artifact directory. */
export function parseArtifactMeta(raw: string, dirId: string, actualArtifactDir?: string): DesignArtifact | null {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const relativePath = isStr(o.relativePath) ? o.relativePath : ''
  if (!relativePath) return null
  const artifactDir = safeArtifactDirectory(actualArtifactDir ?? artifactDirOf(relativePath), dirId)
  if (!artifactDir) return null
  const kind: DesignArtifact['kind'] =
    o.kind === 'canvas' ? 'canvas' : o.kind === 'svg' ? 'svg' : 'html'
  if (!artifactFileInDirectory(relativePath, artifactDir, kind)) return null
  const id = dirId
  const createdAt = isStr(o.createdAt) ? o.createdAt : new Date(0).toISOString()
  const updatedAt = isStr(o.updatedAt) ? o.updatedAt : createdAt
  const versions = Array.isArray(o.versions)
    ? o.versions
        .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object')
        .map((v) => {
          const versionPath = isStr(v.relativePath) ? v.relativePath : relativePath
          return {
            id: versionIdForRelativePath(id, versionPath),
            relativePath: versionPath,
            createdAt: isStr(v.createdAt) ? v.createdAt : createdAt,
            summary: isStr(v.summary) ? v.summary : ''
          }
        })
        .filter((version) => artifactFileInDirectory(version.relativePath, artifactDir, kind))
    : []
  const parsedNode = parseNode(
    o.node,
    kind === 'svg' ? { width: 64, height: 64 } : undefined
  )
  const previewStatus =
    o.previewStatus === 'pending' || o.previewStatus === 'ready' || o.previewStatus === 'error'
      ? o.previewStatus
      : undefined
  const role = o.role === 'design-system' || o.role === 'logo' ? o.role : undefined
  const boardSection = isStr(o.boardSection) ? o.boardSection.trim().slice(0, 60) : ''
  const prototypeLinks = parsePrototypeLinks(o.prototypeLinks)
  const direction = parseDirection(o.direction)
  const importedFromPath = (() => {
    const raw = isStr(o.importedFromPath) ? o.importedFromPath.trim().replaceAll('\\', '/') : ''
    if (
      !raw ||
      !/^\.kun-design\/component-prototypes\/[^/]+\/prototype\.html$/i.test(raw) ||
      raw.split('/').includes('..')
    ) return undefined
    return raw
  })()
  const normalizedVersions = versionsWithCurrentPresent(id, relativePath, createdAt, versions)
  return {
    id,
    kind,
    title: isStr(o.title) ? o.title : dirId,
    relativePath,
    createdAt,
    updatedAt,
    versions: normalizedVersions,
    ...(kind !== 'canvas'
      ? { designMdPath: `${artifactDir}/DESIGN.md` }
      : {}),
    ...(previewStatus ? { previewStatus } : {}),
    ...(parsedNode ? { node: parsedNode } : {}),
    ...(prototypeLinks ? { prototypeLinks } : {}),
    ...(direction ? { direction } : {}),
    ...(importedFromPath ? { importedFromPath } : {}),
    implementedAt: isStr(o.implementedAt) ? o.implementedAt : undefined,
    implementedThreadId: isStr(o.implementedThreadId) ? o.implementedThreadId : undefined,
    implementedDesignSystemHash: isStr(o.implementedDesignSystemHash) ? o.implementedDesignSystemHash : undefined,
    ...(role ? { role } : {}),
    ...(boardSection ? { boardSection } : {})
  }
}

/**
 * Reconstruct an artifact from on-disk files when no meta.json sidecar exists.
 * `artifactDir` is the artifact's full workspace-relative directory (nested:
 * `.kun-design/<docId>/<id>`, or legacy-flat: `.kun-design/<id>`).
 */
export function reconstructArtifact(
  artifactDir: string,
  entries: WorkspaceEntry[],
  options?: { svgSource?: string }
): DesignArtifact | null {
  const normalizedDir = artifactDir.startsWith(`${DESIGN_DIR}/`) ? artifactDir : `${DESIGN_DIR}/${artifactDir}`
  const dirId = normalizedDir.slice(normalizedDir.lastIndexOf('/') + 1)
  const files = entries.filter((e) => e.type === 'file')
  const hasCanvas = files.some((f) => f.name === 'canvas.json')
  const htmlVersions = files
    .map((f) => /^v(\d+)\.html$/.exec(f.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a)
  const svgVersions = files
    .map((f) => /^v(\d+)\.svg$/i.exec(f.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a)
  if (!hasCanvas && htmlVersions.length === 0 && svgVersions.length === 0) return null
  const now = new Date().toISOString()
  const kind: DesignArtifact['kind'] = hasCanvas
    ? 'canvas'
    : svgVersions.length > 0 && htmlVersions.length === 0
      ? 'svg'
      : 'html'
  const relativePath = hasCanvas
    ? `${normalizedDir}/canvas.json`
    : kind === 'svg'
      ? `${normalizedDir}/v${svgVersions[0]}.svg`
      : `${normalizedDir}/v${htmlVersions[0]}.html`
  const versions =
    kind !== 'canvas'
      ? (kind === 'svg' ? svgVersions : htmlVersions).map((n) => ({
          id: `${dirId}-v${n}`,
          relativePath: `${normalizedDir}/v${n}.${kind === 'svg' ? 'svg' : 'html'}`,
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
    ...(kind !== 'canvas' ? { designMdPath: `${normalizedDir}/DESIGN.md` } : {}),
    node: kind === 'svg' && options?.svgSource
      ? inferSvgArtifactNode(options.svgSource)
      : defaultDesignArtifactNode(0)
  }
}

/** Fire-and-forget write of an artifact's meta.json sidecar (alongside its files). */
export function persistArtifactMeta(workspaceRoot: string, artifact: DesignArtifact): void {
  if (!workspaceRoot) return
  void writeDesignWorkspaceFile({
      path: artifactMetaPathOf(artifact.relativePath),
      workspaceRoot,
      content: serializeArtifactMeta(artifact)
    })
}

/** Fire-and-forget delete of an artifact's whole on-disk dir (keeps disk in sync with the list). */
export function deleteArtifactDir(workspaceRoot: string, relativePath: string): void {
  if (!workspaceRoot) return
  const dir = artifactDirOf(relativePath)
  const dirId = dir.slice(dir.lastIndexOf('/') + 1)
  const safeDir = safeArtifactDirectory(dir, dirId)
  const validFile = safeDir && (
    artifactFileInDirectory(relativePath, safeDir, 'canvas') ||
    artifactFileInDirectory(relativePath, safeDir, 'html') ||
    artifactFileInDirectory(relativePath, safeDir, 'svg')
  )
  if (!safeDir || !validFile) return
  void deleteDesignWorkspaceEntry({ path: safeDir, workspaceRoot })
}

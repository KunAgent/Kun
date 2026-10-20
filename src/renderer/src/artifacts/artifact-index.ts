import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntry,
  WorkspaceFileReadResult,
  WorkspaceFileTarget
} from '@shared/workspace-file'
import { parseDocumentsIndex } from '../design/design-document-persistence'
import { parseWorkWhiteboardRegistry, WORK_WHITEBOARD_DIR, WORK_WHITEBOARD_INDEX } from '../write/work-whiteboard'
import { KUN_GENERATED_IMAGE_DIR, LEGACY_GENERATED_IMAGE_DIR } from '@shared/generated-image-path'
import { isImageExt, officeKindForExt, type LibraryArtifact } from './artifact-types'

export type ArtifactScanApi = {
  listWorkspaceDirectory: (target: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>
  readWorkspaceFile: (target: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
}

/**
 * Where agents usually leave office deliverables. Scanning stays shallow on
 * purpose: walking a whole repository on every visit would be slow and would
 * surface every README as a "document".
 */
export const OFFICE_SCAN_DIRS = ['', 'docs', 'reports', 'exports', 'output', 'outputs', 'slides', 'presentations'] as const
export const IMAGE_SCAN_DIRS = [KUN_GENERATED_IMAGE_DIR, LEGACY_GENERATED_IMAGE_DIR] as const
const MAX_ROOTS = 16
const MAX_ARTIFACTS = 400

export function projectNameForRoot(workspaceRoot: string): string {
  const parts = workspaceRoot.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? workspaceRoot
}

export function artifactId(kind: LibraryArtifact['kind'], workspaceRoot: string, path: string): string {
  return `${kind}:${workspaceRoot}:${path}`
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function timeOf(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

async function listFiles(api: ArtifactScanApi, workspaceRoot: string, path: string): Promise<WorkspaceEntry[]> {
  try {
    const result = await api.listWorkspaceDirectory({ workspaceRoot, ...(path ? { path } : {}) })
    return result.ok ? result.entries.filter((entry) => entry.type === 'file') : []
  } catch {
    return []
  }
}

async function readText(api: ArtifactScanApi, workspaceRoot: string, path: string): Promise<string | null> {
  try {
    const result = await api.readWorkspaceFile({ workspaceRoot, path })
    return result.ok && !result.truncated ? result.content : null
  } catch {
    return null
  }
}

async function scanDesigns(api: ArtifactScanApi, workspaceRoot: string, projectName: string): Promise<LibraryArtifact[]> {
  const raw = await readText(api, workspaceRoot, '.kun-design/documents.json')
  const index = raw ? parseDocumentsIndex(raw) : null
  if (!index) return []
  return index.documents.map((document) => {
    const path = `.kun-design/${document.id}`
    return {
      id: artifactId('design', workspaceRoot, path),
      kind: 'design' as const,
      title: document.title.trim() || document.id,
      workspaceRoot,
      projectName,
      path,
      ext: '',
      updatedAt: timeOf(document.updatedAt),
      designDocumentId: document.id
    }
  })
}

async function scanWhiteboards(api: ArtifactScanApi, workspaceRoot: string, projectName: string): Promise<LibraryArtifact[]> {
  const raw = await readText(api, workspaceRoot, WORK_WHITEBOARD_INDEX)
  if (!raw) return []
  return Object.values(parseWorkWhiteboardRegistry(raw, workspaceRoot)).map((board) => {
    const path = `${WORK_WHITEBOARD_DIR}/${board.id}`
    return {
      id: artifactId('board', workspaceRoot, path),
      kind: 'board' as const,
      title: board.title,
      workspaceRoot,
      projectName,
      path,
      ext: '',
      updatedAt: timeOf(board.updatedAt),
      whiteboardId: board.id,
      ...(board.threadId ? { sourceThreadId: board.threadId } : {})
    }
  })
}

async function scanFiles(
  api: ArtifactScanApi,
  workspaceRoot: string,
  projectName: string,
  dirs: readonly string[],
  classify: (ext: string) => LibraryArtifact['kind'] | null
): Promise<LibraryArtifact[]> {
  const listings = await Promise.all(dirs.map(async (dir) => ({ dir, files: await listFiles(api, workspaceRoot, dir) })))
  return listings.flatMap(({ dir, files }) => files.flatMap((entry) => {
    const ext = extOf(entry.name)
    const kind = classify(ext)
    if (!kind || entry.name.startsWith('~$') || entry.name.startsWith('.')) return []
    const path = joinPath(dir, entry.name)
    return [{
      id: artifactId(kind, workspaceRoot, path),
      kind,
      title: stem(entry.name),
      workspaceRoot,
      projectName,
      path,
      ext,
      updatedAt: timeOf(entry.mtimeMs),
      ...(typeof entry.size === 'number' ? { size: entry.size } : {})
    }]
  }))
}

export async function scanWorkspaceArtifacts(api: ArtifactScanApi, workspaceRoot: string): Promise<LibraryArtifact[]> {
  const projectName = projectNameForRoot(workspaceRoot)
  const groups = await Promise.all([
    scanDesigns(api, workspaceRoot, projectName),
    scanWhiteboards(api, workspaceRoot, projectName),
    scanFiles(api, workspaceRoot, projectName, OFFICE_SCAN_DIRS, officeKindForExt),
    scanFiles(api, workspaceRoot, projectName, IMAGE_SCAN_DIRS, (ext) => isImageExt(ext) ? 'image' : null)
  ])
  return groups.flat()
}

export function normalizeLibraryRoots(roots: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const root of roots) {
    const value = root?.trim().replace(/[\\/]+$/, '')
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= MAX_ROOTS) break
  }
  return result
}

export async function scanArtifactLibrary(
  api: ArtifactScanApi,
  roots: readonly (string | null | undefined)[]
): Promise<LibraryArtifact[]> {
  const groups = await Promise.all(normalizeLibraryRoots(roots).map((root) => scanWorkspaceArtifacts(api, root)))
  const byId = new Map<string, LibraryArtifact>()
  for (const artifact of groups.flat()) byId.set(artifact.id, artifact)
  return [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title))
    .slice(0, MAX_ARTIFACTS)
}

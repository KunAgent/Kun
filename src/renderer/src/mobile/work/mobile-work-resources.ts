import type { WorkspaceEntry } from '@shared/workspace-file'
import type { WriteDocumentSession, WorkWhiteboard } from '../../write/write-workspace-store-types'
import type { MobileWorkResource } from './MobileWorkHome'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'
import { writeDirnameFromPath } from '../../write/write-workspace-store-helpers'
import type { MobilePage } from '../navigation/mobile-page'

type WorkListState = {
  workspaceRoot: string
  rootDirectory: string
  entriesByDir: Record<string, WorkspaceEntry[]>
  documentsByPath: Record<string, WriteDocumentSession>
  whiteboards: Record<string, WorkWhiteboard>
}

function entryResource(state: WorkListState, entry: WorkspaceEntry): MobileWorkResource {
  const document = state.documentsByPath[entry.path]
  return {
    key: workFileResourceKey(state.workspaceRoot, entry.path),
    title: entry.name,
    detail: entry.type === 'directory' ? '文件夹' : entry.path,
    kind: entry.type === 'directory' ? 'directory' : 'document',
    status: document?.spreadsheetConflictPreview ? 'error'
      : document?.pendingAgentReview ? 'review' : document?.saveStatus ?? 'saved'
  }
}

/** Directory listing never mistakes a paper's individual files for a library entry. */
export function mobileWorkResources(state: WorkListState, directory: string, search: string): {
  resources: MobileWorkResource[]
  recent: MobileWorkResource[]
} {
  const query = search.trim().toLocaleLowerCase()
  const all = Object.values(state.entriesByDir).flat()
  const visible = query ? all.filter((entry) =>
    `${entry.name} ${entry.path}`.toLocaleLowerCase().includes(query)
  ) : state.entriesByDir[directory || state.rootDirectory] ?? []
  const boards = directory && directory !== state.rootDirectory && !query ? []
    : Object.values(state.whiteboards).filter((board) =>
      !query || `${board.title} ${board.id}`.toLocaleLowerCase().includes(query)
    ).map((board): MobileWorkResource => ({
      key: workWhiteboardResourceKey(board.id), title: board.title, detail: '白板', kind: 'whiteboard',
      status: board.phase === 'review' ? 'review' : 'saved'
    }))
  const recent = query || directory && directory !== state.rootDirectory ? []
    : all.filter((entry) => entry.type === 'file' && Boolean(state.documentsByPath[entry.path]))
      .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0)).slice(0, 5)
      .map((entry) => entryResource(state, entry))
  return { resources: [...visible.map((entry) => entryResource(state, entry)), ...boards], recent }
}

export function resolveMobileWorkEntry(state: WorkListState, key: string): WorkspaceEntry | undefined {
  return Object.values(state.entriesByDir).flat().find((entry) =>
    workFileResourceKey(state.workspaceRoot, entry.path) === key)
}

export function mobileParentFolderPage(root: string, rootDirectory: string, directory: string): MobilePage {
  const parent = writeDirnameFromPath(directory)
  return parent && parent !== rootDirectory
    ? { mode: 'work', kind: 'folder', folderKey: workFileResourceKey(root, parent) }
    : { mode: 'work', kind: 'home' }
}

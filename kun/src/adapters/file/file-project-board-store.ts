import { createHash } from 'node:crypto'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  PROJECT_BOARD_DOCUMENT_VERSION,
  ProjectBoardDocumentV1Schema,
  type ProjectBoardDocumentV1
} from '../../contracts/project-board.js'
import {
  ProjectBoardRevisionConflictError,
  type ProjectBoardDocumentRead,
  type ProjectBoardStore
} from '../../ports/project-board-store.js'
import { withFileMutationQueue } from '../tool/file-mutation-queue.js'
import { atomicWriteFile } from './atomic-write.js'
import { isPathBelowDirectory } from './path-containment.js'

type FileProjectBoardStoreOptions = {
  dataDir: string
  nowIso?: () => string
  writeFile?: (path: string, contents: string) => Promise<void>
}

export class FileProjectBoardStore implements ProjectBoardStore {
  private readonly rootDir: string
  private readonly nowIso: () => string
  private readonly writeFile: (path: string, contents: string) => Promise<void>

  constructor(options: FileProjectBoardStoreOptions) {
    this.rootDir = resolve(options.dataDir, 'project-boards')
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.writeFile = options.writeFile ?? ((path, contents) => atomicWriteFile(path, contents, {
      durable: true,
      allowDirectWriteFallback: false
    }))
  }

  async read(workspaceRoot: string): Promise<ProjectBoardDocumentRead> {
    const path = this.documentPath(workspaceRoot)
    return withFileMutationQueue(path, () => this.readUnlocked(workspaceRoot, path))
  }

  async mutate(
    workspaceRoot: string,
    expectedRevision: number,
    update: (document: ProjectBoardDocumentV1) => ProjectBoardDocumentV1
  ): Promise<ProjectBoardDocumentRead> {
    const path = this.documentPath(workspaceRoot)
    return withFileMutationQueue(path, async () => {
      const current = await this.readUnlocked(workspaceRoot, path)
      if (current.document.revision !== expectedRevision) {
        throw new ProjectBoardRevisionConflictError(expectedRevision, current.document.revision)
      }
      const now = this.nowIso()
      const candidate = ProjectBoardDocumentV1Schema.parse({
        ...update(structuredClone(current.document)),
        version: PROJECT_BOARD_DOCUMENT_VERSION,
        workspaceRoot,
        revision: current.document.revision + 1,
        createdAt: current.document.createdAt,
        updatedAt: now
      })
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
      await this.writeFile(path, JSON.stringify(candidate))
      return { document: candidate, ...(current.warning ? { warning: current.warning } : {}) }
    })
  }

  private async readUnlocked(workspaceRoot: string, path: string): Promise<ProjectBoardDocumentRead> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return { document: emptyDocument(workspaceRoot, this.nowIso()) }
      throw error
    }
    try {
      const parsed = ProjectBoardDocumentV1Schema.parse(JSON.parse(raw))
      if (parsed.workspaceRoot !== workspaceRoot) {
        throw new Error('workspace root does not match the board document identity')
      }
      return { document: parsed }
    } catch (error) {
      const suffix = this.nowIso().replace(/[^0-9]/g, '')
      const corruptPath = `${path}.corrupt-${suffix}`
      await rename(path, corruptPath)
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[kun] corrupt project board moved to ${corruptPath}: ${message}`)
      return {
        document: emptyDocument(workspaceRoot, this.nowIso()),
        warning: 'The project board data was corrupt and has been preserved for recovery.'
      }
    }
  }

  private documentPath(workspaceRoot: string): string {
    const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 24)
    const path = resolve(this.rootDir, `${hash}.json`)
    if (!isPathBelowDirectory(this.rootDir, path)) {
      throw new Error('project board path escapes the runtime data directory')
    }
    return path
  }
}

function emptyDocument(workspaceRoot: string, now: string): ProjectBoardDocumentV1 {
  return {
    version: PROJECT_BOARD_DOCUMENT_VERSION,
    workspaceRoot,
    revision: 0,
    manualCards: {},
    todoOverlays: {},
    createdAt: now,
    updatedAt: now
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code
}

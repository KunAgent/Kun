import type { ProjectBoardDocumentV1 } from '../contracts/project-board.js'

export type ProjectBoardDocumentRead = {
  document: ProjectBoardDocumentV1
  warning?: string
}

export class ProjectBoardRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(`project board revision conflict: expected ${expectedRevision}, received ${actualRevision}`)
    this.name = 'ProjectBoardRevisionConflictError'
  }
}

export interface ProjectBoardStore {
  read(workspaceRoot: string): Promise<ProjectBoardDocumentRead>
  mutate(
    workspaceRoot: string,
    expectedRevision: number,
    update: (document: ProjectBoardDocumentV1) => ProjectBoardDocumentV1
  ): Promise<ProjectBoardDocumentRead>
}

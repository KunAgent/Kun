import { ipcMain } from 'electron'
import { z } from 'zod'
import { paperEvidencePatchSchema, paperMatrixAxisSchema, paperMatrixPatchSchema } from '../../shared/paper/paper-evidence-types'
import { canonicalPath, expandHomePath } from '../services/workspace-paths'
import { resolve } from 'node:path'
import { readPaperEvidence, promotePaperEvidence, updatePaperEvidence, readPaperEvidenceMaterial, readPaperEvidenceSource } from '../services/paper/paper-evidence-service'
import { readPaperMatrices, createPaperMatrix, updatePaperMatrix } from '../services/paper/paper-matrix-service'
import { PaperEvidenceError } from '../services/paper/paper-evidence-store'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'

const path = z.string().trim().min(1).max(4096)
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const revision = z.number().int().nonnegative()
const scope = { workspaceRoot: path }

export function registerAppPaperEvidenceIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const handle = <T extends { workspaceRoot: string }>(channel: string, schema: z.ZodType<T>, action: (root: string, request: T) => Promise<unknown>) => {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, options.getMainWindow)
      const request = parseIpcPayload(channel, schema, payload)
      try {
        const root = await canonicalPath(resolve(expandHomePath(request.workspaceRoot)))
        return await action(root, request)
      } catch (error) {
        options.logError?.('paper-evidence', `${channel} failed`, error)
        return { ok: false, code: error instanceof PaperEvidenceError ? error.code : 'io',
          message: error instanceof Error ? error.message : 'Paper evidence operation failed.' }
      }
    })
  }
  handle('paper-evidence:read', z.object({ ...scope, unitDir: path.optional() }).strict(),
    (root, request) => readPaperEvidence(root, request.unitDir))
  handle('paper-evidence:material', z.object({ ...scope, unitDir: path }).strict(),
    (root, request) => readPaperEvidenceMaterial(root, request.unitDir))
  handle('paper-evidence:source', z.object({ ...scope, evidenceId: id }).strict(),
    (root, request) => readPaperEvidenceSource(root, request.evidenceId))
  handle('paper-evidence:promote', z.object({ ...scope, unitDir: path, markId: id, expectedRevision: revision }).strict(),
    (root, request) => promotePaperEvidence(root, request))
  handle('paper-evidence:update', z.object({ ...scope, evidenceId: id, expectedRevision: revision, patch: paperEvidencePatchSchema }).strict(),
    (root, request) => updatePaperEvidence(root, request))
  handle('paper-matrices:read', z.object(scope).strict(), (root) => readPaperMatrices(root))
  handle('paper-matrices:create', z.object({ ...scope, title: z.string().trim().min(1).max(200),
    unitDirs: z.array(path).min(1).max(100), axes: z.array(paperMatrixAxisSchema).min(1).max(12), expectedRevision: revision }).strict(),
    (root, { title, unitDirs, axes, expectedRevision }) => createPaperMatrix(root, { title, unitDirs, axes, expectedRevision }))
  handle('paper-matrices:update', z.object({ ...scope, matrixId: id, expectedRevision: revision, patch: paperMatrixPatchSchema }).strict(),
    (root, { matrixId, patch, expectedRevision }) => updatePaperMatrix(root, { matrixId, patch, expectedRevision }))
}

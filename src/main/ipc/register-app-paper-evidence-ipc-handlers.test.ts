import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { tmpdir } from 'node:os'
import { canonicalPath } from '../services/workspace-paths'
import { registerAppPaperEvidenceIpcHandlers } from './register-app-paper-evidence-ipc-handlers'
import { createPaperMatrix, updatePaperMatrix } from '../services/paper/paper-matrix-service'
import { promotePaperEvidence } from '../services/paper/paper-evidence-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>())
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: never) => handlers.set(channel, handler) } }))
vi.mock('./app-ipc-handler-utils', () => ({
  assertTrustedWorkbenchSender: (event: { trusted?: boolean }) => { if (!event.trusted) throw new Error('Untrusted sender') },
  parseIpcPayload: (_channel: string, schema: z.ZodType, payload: unknown) => schema.parse(payload)
}))
vi.mock('../services/paper/paper-matrix-service', () => ({
  readPaperMatrices: vi.fn(), createPaperMatrix: vi.fn(), updatePaperMatrix: vi.fn()
}))
vi.mock('../services/paper/paper-evidence-service', () => ({
  readPaperEvidence: vi.fn(), promotePaperEvidence: vi.fn(), updatePaperEvidence: vi.fn(),
  readPaperEvidenceMaterial: vi.fn(), readPaperEvidenceSource: vi.fn()
}))
const call = (channel: string, payload: unknown, event = { trusted: true }) => handlers.get(channel)!(event, payload)
beforeEach(() => { handlers.clear(); vi.clearAllMocks(); registerAppPaperEvidenceIpcHandlers({ getMainWindow: () => null } as unknown as RegisterAppIpcHandlersOptions) })
describe('paper evidence IPC boundaries', () => {
  it('requires the trusted sender before dispatching reads or mutations', async () => {
    for (const channel of handlers.keys()) await expect(call(channel, {}, { trusted: false })).rejects.toThrow('Untrusted sender')
    expect(promotePaperEvidence).not.toHaveBeenCalled()
  })
  it('validates revisions, safe mark IDs, editable-only patches, and known axes', async () => {
    await expect(call('paper-evidence:promote', { workspaceRoot: '/tmp', unitDir: 'paper', markId: '../escape', expectedRevision: 0 })).rejects.toThrow()
    await expect(call('paper-evidence:update', { workspaceRoot: '/tmp', evidenceId: 'id', expectedRevision: 0, patch: { originalQuote: 'invented' } })).rejects.toThrow()
    await expect(call('paper-matrices:create', { workspaceRoot: '/tmp', title: 'Compare', unitDirs: ['paper'], axes: ['invented'], expectedRevision: 0 })).rejects.toThrow()
    await expect(call('paper-evidence:promote', { workspaceRoot: '/tmp', unitDir: 'paper', markId: 'id', expectedRevision: -1 })).rejects.toThrow()
  })
  it('passes canonical roots and strips transport-only scope from strict matrix commands', async () => {
    vi.mocked(createPaperMatrix).mockResolvedValue({ ok: true, revision: 1, matrices: [] })
    const root = tmpdir()
    const canonicalRoot = await canonicalPath(root)
    const payload = { workspaceRoot: root, title: 'Compare', unitDirs: ['paper'], axes: ['result'], expectedRevision: 0 }
    expect(await call('paper-matrices:create', payload)).toMatchObject({ ok: true, revision: 1 })
    expect(createPaperMatrix).toHaveBeenCalledWith(canonicalRoot, { title: 'Compare', unitDirs: ['paper'], axes: ['result'], expectedRevision: 0 })
    await call('paper-matrices:update', { workspaceRoot: root, matrixId: 'id', patch: { title: 'Edited' }, expectedRevision: 1 })
    expect(updatePaperMatrix).toHaveBeenCalledWith(canonicalRoot, { matrixId: 'id', patch: { title: 'Edited' }, expectedRevision: 1 })
  })
})

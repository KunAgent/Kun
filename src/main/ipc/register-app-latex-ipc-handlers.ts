import { app, dialog, ipcMain, net } from 'electron'
import { join, basename } from 'node:path'
import { stat, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { LatexResult } from '../../shared/latex-project'
import { isLatexFilePath } from '../../shared/latex-project'
import { assertTrustedWorkbenchSender } from './app-ipc-handler-utils'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { configureLatexProject, createLatexProject, latexConfigSchema, MAX_SOURCE_BYTES, readLatexProject, readLatexSource } from '../services/latex/project'
import { LatexBuildService } from '../services/latex/build'
import { detectLatexTools } from '../services/latex/detect'
import { importLatexProject, latexSourceZip, currentLatexPdf } from '../services/latex/import-export'
import { syncLatexSource } from '../services/latex/synctex'
import { proposeLatexFix } from '../services/latex/propose-fix'
import { snapshotProject } from '../services/latex/snapshot'
import { resolveOpenTargetPath } from '../services/workspace-paths'
import { dirname } from 'node:path'
import { LatexToolchainInstaller } from '../services/latex/toolchain-install'

const path = z.string().min(1).max(4096).refine((value) => !value.includes('\0'))
const target = z.object({ workspaceRoot: path, path }).strict()
const buildId = z.string().regex(/^[\w-]{1,100}$/)
const source = z.string().max(1536 * 1024)
const edit = z.object({ file: path.refine(isLatexFilePath), before: source, after: source }).strict()

export function registerAppLatexIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const managedRoot = join(app.getPath('userData'), 'toolchains', 'latex')
  const service = new LatexBuildService(join(app.getPath('userData'), 'cache', 'latex'), managedRoot)
  const installer = new LatexToolchainInstaller(managedRoot, { fetch: (url, init) => net.fetch(url, init), onState: (state) => {
    const window = options.getMainWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('latex:toolchain-state', state)
  } })
  app.once('before-quit', () => { installer.stop(); service.stop() })
  function handle<T, R extends object>(channel: string, schema: z.ZodType<T>, fn: (value: T, event: Electron.IpcMainInvokeEvent) => Promise<R>): void {
    ipcMain.handle(channel, async (event, payload): Promise<LatexResult<R>> => {
      assertTrustedWorkbenchSender(event, options.getMainWindow)
      try { return { ok: true, ...await fn(schema.parse(payload), event) } }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) } }
    })
  }
  handle('latex:toolchain-status', z.object({ engine: z.enum(['pdflatex', 'xelatex', 'lualatex']), toolDirectory: path.or(z.literal('')).optional() }).strict(),
    async (input) => installer.status(input.engine, input.toolDirectory))
  handle('latex:install-tools', z.object({}).strict(), async () => ({ state: await installer.install() }))
  handle('latex:cancel-tool-install', z.object({ jobId: buildId }).strict(), async (input) => { installer.cancel(input.jobId); return {} })
  handle('latex:choose-tool-directory', z.object({}).strict(), async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled || !result.filePaths[0] ? { canceled: true } : { toolDirectory: result.filePaths[0] }
  })
  handle('latex:read-project', target, async (input) => ({ project: await readLatexProject(input) }))
  handle('latex:configure', target.extend({ config: latexConfigSchema }), async (input) => ({
    project: await service.serialized((await readLatexProject(input)).rootPath, () => configureLatexProject(input, input.config))
  }))
  handle('latex:create', z.object({ workspaceRoot: path, name: z.string().min(1).max(200), template: z.enum(['chinese', 'english', 'blank']), autoBuild: z.boolean() }).strict(),
    async (input) => ({ project: await createLatexProject(input, (await options.store.load()).write.latex) }))
  handle('latex:import', z.object({ workspaceRoot: path, kind: z.enum(['folder', 'zip']) }).strict(), async (input) => {
    const result = await dialog.showOpenDialog({ properties: input.kind === 'folder' ? ['openDirectory'] : ['openFile'],
      ...(input.kind === 'zip' ? { filters: [{ name: 'LaTeX ZIP', extensions: ['zip'] }] } : {}) })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return { project: await importLatexProject(input.workspaceRoot, result.filePaths[0], input.kind) }
  })
  handle('latex:read-source', target, async (input) => {
    const path = await resolveOpenTargetPath(input.path, input.workspaceRoot, { allowBasenameFallback: false })
    return { content: await readLatexSource(dirname(path), basename(path), true), truncated: (await stat(path)).size > MAX_SOURCE_BYTES }
  })
  handle('latex:save', target.extend({ edits: z.array(edit).max(50) }), async (input) => { await service.save(input, input.edits); return {} })
  handle('latex:detect-tools', target, async (input) => {
    const project = await readLatexProject(input)
    return { tools: await detectLatexTools(project.config.engine, project.config.toolDirectory, managedRoot) }
  })
  handle('latex:pick-tools', target, async (input) => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const project = await readLatexProject(input)
    return { project: await configureLatexProject(input, { ...project.config, toolDirectory: result.filePaths[0] }) }
  })
  handle('latex:build', target.extend({ buildId, sourceRevision: z.number().int().min(0) }), async (input, event) => ({
    build: await service.build(input, (text) => { if (!event.sender.isDestroyed()) event.sender.send('latex:build-log', { buildId: input.buildId, text }) })
  }))
  handle('latex:abort-build', target.extend({ buildId }), async (input) => { await service.abort(input); return {} })
  handle('latex:read-pdf', target.extend({ metadataOnly: z.boolean().optional() }), async (input) => {
    const project = await readLatexProject(input)
    return { pdf: input.metadataOnly ? null : await service.readPdf(project), currentSourceHash: await snapshotProject(project) }
  })
  handle('latex:sync', target.extend({ buildId, direction: z.enum(['forward', 'inverse']), file: path.optional(), line: z.number().int().min(1).optional(),
    page: z.number().int().min(1).optional(), x: z.number().finite().optional(), y: z.number().finite().optional() }),
    async (input) => ({ point: await syncLatexSource(service, await readLatexProject(input), input) }))
  handle('latex:propose-fix', target.extend({ providerId: z.string().max(128).optional(), model: z.string().max(512).optional(), instruction: z.string().max(8000),
    diagnostics: z.array(z.object({ level: z.enum(['error', 'warning']), message: z.string().max(2000), code: z.enum(['tex', 'missing-package', 'undefined-command', 'citation', 'overflow']), file: path.optional(), line: z.number().int().optional() })).max(200),
    files: z.array(z.object({ file: path.refine(isLatexFilePath), content: source }).strict()).max(30)
  }), async (input) => {
    const project = await readLatexProject(input)
    if (input.files.some((file) => !project.files.includes(file.file))) throw new Error('Fix context contains a file outside this project.')
    return { edits: await proposeLatexFix(await options.store.load(), input) }
  })
  handle('latex:export', target.extend({ format: z.enum(['pdf', 'source']), sourceHash: z.string().max(100).optional() }), async (input) => {
    const project = await readLatexProject(input)
    const bytes = input.format === 'pdf' ? await currentLatexPdf(service, project, input.sourceHash) : await latexSourceZip(project)
    const ext = input.format === 'pdf' ? 'pdf' : 'zip'
    const result = await dialog.showSaveDialog({ defaultPath: `${basename(project.rootPath)}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    await writeFile(result.filePath, bytes)
    return { path: result.filePath }
  })
}

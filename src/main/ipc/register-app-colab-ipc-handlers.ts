import { join } from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { COLAB_ACCELERATORS } from '../../shared/colab/colab-types'
import type { RuntimeUploadProgress, RuntimeUploadResult } from '../../shared/colab/runtime-upload'
import { resolveOpenTargetPath } from '../services/workspace-paths'
import {
  configureColabHost,
  getColabNotebookAgentRelay,
  registerColabSubsystemShutdown,
  setColabNotebookAgentRelay
} from '../colab/colab-host'
import { ColabNotebookAgentRelay } from '../colab/colab-notebook-agent-relay'
import { ColabDriveMountManager } from '../colab/colab-drive-mount'
import { ColabDriveNotebookManager } from '../colab/colab-drive-notebooks'
import { ColabPortForwardManager } from '../colab/colab-port-forward-manager'
import { isJupyterSessionId, JupyterServerManager } from '../colab/jupyter-server-manager'
import { requestColabNotebookAssist } from '../colab/colab-notebook-assist'
import { ColabNotebookKernel } from '../colab/colab-notebook-kernel'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { parseIpcPayload } from './app-ipc-handler-utils'

const ensureCliSchema = z.object({ upgrade: z.boolean().optional() }).strict().optional()
const oauthStartSchema = z
  .object({
    name: z.string().max(64).optional(),
    setAsCurrent: z.boolean().optional(),
    workspaceRoot: z.string().max(4096).optional(),
    reauthConnectionId: z.string().max(128).optional()
  })
  .strict()
const manualCodeSchema = z
  .object({
    flowId: z.string().min(1).max(128),
    code: z.string().min(1).max(2048)
  })
  .strict()
const promoteMismatchSchema = z
  .object({
    pendingTokenId: z.string().min(1).max(128),
    name: z.string().max(64).optional(),
    workspaceRoot: z.string().max(4096).optional(),
    setAsCurrent: z.boolean().optional()
  })
  .strict()
const flowIdSchema = z.object({ flowId: z.string().min(1).max(128) }).strict()
const selectWsConnSchema = z
  .object({
    workspaceRoot: z.string().max(4096),
    connectionId: z.string().min(1).max(128)
  })
  .strict()
const renameConnSchema = z
  .object({
    connectionId: z.string().min(1).max(128),
    name: z.string().min(1).max(64)
  })
  .strict()
const refreshSchema = z
  .object({ connectionId: z.string().max(128).optional() })
  .strict()
  .optional()
const openBrowserSchema = z
  .object({
    connectionId: z.string().min(1).max(128),
    sessionId: z.string().max(128).optional()
  })
  .strict()
const signOutSchema = z
  .object({
    connectionId: z.string().min(1).max(128),
    stopRunningSessions: z.boolean()
  })
  .strict()
const workspaceOnlySchema = z.object({ workspaceRoot: z.string().max(4096) }).strict()
const runConfigSchema = z
  .object({
    entryCommand: z.string().min(1).max(2048),
    accelerator: z.enum(COLAB_ACCELERATORS),
    highMem: z.boolean().optional(),
    syncPaths: z.array(z.string().max(1024)).max(128),
    outputRemoteDir: z.string().max(512),
    outputLocalDir: z.string().max(512),
    maxRuntimeHours: z.number().min(0).max(48),
    autoStop: z.boolean(),
    mountDrive: z.boolean().optional(),
    envVars: z.record(z.string().max(128), z.string().max(2048)).optional(),
    setupScript: z.string().max(4096).optional(),
    metricPattern: z.string().max(512).optional()
  })
  .strict()
const saveConfigSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    config: runConfigSchema
  })
  .strict()
const startRunSchema = z
  .object({
    workspaceRoot: z.string().max(4096),
    connectionId: z.string().min(1).max(128),
    setAsWorkspaceCurrent: z.boolean().optional(),
    entryCommand: z.string().min(1).max(2048),
    accelerator: z.enum(COLAB_ACCELERATORS),
    highMem: z.boolean().optional(),
    minVramGb: z.number().min(0).max(256).nullable().optional(),
    maxProvisionAttempts: z.number().int().min(1).max(8).optional(),
    onProvisionExhausted: z.enum(['stop_and_fail', 'keep_last']).optional(),
    syncPaths: z.array(z.string().max(1024)).max(128),
    outputRemoteDir: z.string().max(512),
    outputLocalDir: z.string().max(512),
    maxRuntimeHours: z.number().min(0).max(48),
    idleAutoStopMinutes: z.number().min(0).max(1440).optional(),
    maxSpendCu: z.number().min(0).max(10000).nullable().optional(),
    minBalanceCu: z.number().min(0).max(10000).nullable().optional(),
    autoStop: z.boolean(),
    saveWorkspaceConfig: z.boolean().optional(),
    mountDrive: z.boolean().optional(),
    envVars: z.record(z.string().max(128), z.string().max(2048)).optional(),
    setupScript: z.string().max(4096).optional(),
    terminalOnly: z.boolean().optional()
  })
  .strict()
const sessionIdSchema = z.object({ sessionId: z.string().min(1).max(128) }).strict()
const extendSessionSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    addMinutes: z.number().min(1).max(720)
  })
  .strict()
const portForwardStartSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    remotePort: z.number().int().min(1).max(65535),
    localPort: z.number().int().min(1).max(65535).optional(),
    label: z.string().max(64).optional()
  })
  .strict()
const portForwardStopSchema = z.object({ forwardId: z.string().min(1).max(128) }).strict()
const uploadSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    workspaceNotebook: z.string().min(1).max(4096).regex(/\.ipynb$/i).optional(),
    targetRemoteDir: z.string().min(1).max(1024).optional()
  })
  .strict()
const downloadSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    remotePath: z.string().max(1024).optional()
  })
  .strict()
const prepareTerminalSchema = z
  .object({
    sessionId: z.string().max(128).optional(),
    connectionId: z.string().max(128).optional(),
    workspaceRoot: z.string().max(4096).optional()
  })
  .strict()
const untrackedSchema = z
  .object({
    connectionId: z.string().min(1).max(128),
    endpoint: z.string().min(1).max(512),
    workspaceRoot: z.string().max(4096).optional()
  })
  .strict()

const notebookExecSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    execId: z.string().min(1).max(128),
    code: z.string().max(1_000_000)
  })
  .strict()
const notebookInterruptSchema = z.object({ execId: z.string().min(1).max(128) }).strict()
const notebookListSchema = z
  .object({ sessionId: z.string().min(1).max(128), path: z.string().min(1).max(1024) })
  .strict()
const pullIdSchema = z.object({ pullId: z.string().uuid() }).strict()
const drivePullStartSchema = pullIdSchema.extend({
  workspaceRoot: z.string().min(1).max(4096),
  connectionId: z.string().min(1).max(128),
  runtime: z.union([sessionIdSchema, z.object({ temporaryCpu: z.literal(true) }).strict()])
})
const driveImportSchema = pullIdSchema.extend({ remotePath: z.string().min(1).max(2048) })
const driveMountStateSchema = sessionIdSchema.extend({ probe: z.boolean().optional() })
const driveMountSchema = sessionIdSchema.extend({ forceRemount: z.boolean().optional() })
const jupyterConnectSchema = z
  .object({
    workspaceRoot: z.string().max(4096),
    serverId: z.string().max(128).optional(),
    name: z.string().max(128).optional(),
    url: z.string().max(2048).optional(),
    tokenOrPassword: z.string().max(2048).optional(),
    kernelName: z.string().max(128).optional()
  })
  .strict()
const jupyterSaveServerSchema = jupyterConnectSchema.omit({ workspaceRoot: true, kernelName: true })
const jupyterServerIdSchema = z.object({ serverId: z.string().min(1).max(128) }).strict()
const jupyterImportSchema = jupyterServerIdSchema.extend({
  workspaceRoot: z.string().min(1).max(4096), remotePath: z.string().min(1).max(2048)
})
const notebookAgentResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      notebookPath: z.string().max(4096).optional(),
      runtime: z.string().max(512).optional(),
      cells: z
        .array(
          z
            .object({
              number: z.number().int().min(1),
              kind: z.enum(['code', 'markdown']),
              status: z.enum(['ok', 'error', 'skipped', 'not_run']),
              executionCount: z.number().int().nullable(),
              output: z.string().max(20_000)
            })
            .strict()
        )
        .max(200)
        .optional(),
      variables: z
        .array(z.object({ name: z.string().max(256), typeName: z.string().max(256), summary: z.string().max(512) }).strict())
        .max(200)
        .optional()
    })
    .strict(),
  z.object({ ok: z.literal(false), message: z.string().max(4000) }).strict()
])
const notebookAgentResponseSchema = z.union([
  z.object({ requestId: z.string().min(1).max(128), ack: z.literal(true) }).strict(),
  z.object({ requestId: z.string().min(1).max(128), result: notebookAgentResultSchema }).strict()
])
const notebookAssistSchema = z
  .object({
    prompt: z.string().min(1).max(16_000),
    mode: z.enum(['insert', 'replace']),
    cells: z
      .array(
        z
          .object({
            kind: z.enum(['code', 'markdown']),
            source: z.string().max(100_000),
            output: z.string().max(32_000).optional(),
            selected: z.boolean().optional()
          })
          .strict()
      )
      .max(64)
  })
  .strict()

export function registerAppColabIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const service = configureColabHost({
    getSettings: () => options.store.load()
  })

  const uploads = new Map<string, { controller: AbortController; owner: number }>()
  const driveNotebooks = new ColabDriveNotebookManager(service)
  service.subscribe((snapshot) => {
    const win = options.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('colab:state-changed', snapshot)
    }
  })

  ipcMain.handle('colab:get-snapshot', async () => service.getSnapshot())
  ipcMain.handle('colab:ensure-cli', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:ensure-cli', ensureCliSchema, payload)
    return service.ensureCliRuntime(req)
  })
  ipcMain.handle('colab:oauth:start', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:oauth:start', oauthStartSchema, payload)
    return service.startOAuthLogin(req)
  })
  ipcMain.handle('colab:oauth:manual-code', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:oauth:manual-code', manualCodeSchema, payload)
    return service.submitManualCode(req.flowId, req.code)
  })
  ipcMain.handle('colab:oauth:promote-mismatch', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:oauth:promote-mismatch', promoteMismatchSchema, payload)
    return service.promoteMismatchedToken(req)
  })
  ipcMain.handle('colab:oauth:cancel', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:oauth:cancel', flowIdSchema, payload)
    return service.cancelOAuthLogin(req.flowId)
  })
  ipcMain.handle('colab:oauth:reopen', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:oauth:reopen', flowIdSchema, payload)
    return service.reopenOAuthUrl(req.flowId)
  })
  ipcMain.handle('colab:oauth:clear-outcome', async () => service.clearLastLoginOutcome())
  ipcMain.handle('colab:connection:select-workspace', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:connection:select-workspace', selectWsConnSchema, payload)
    return service.selectWorkspaceConnection(req.workspaceRoot, req.connectionId)
  })
  ipcMain.handle('colab:connection:rename', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:connection:rename', renameConnSchema, payload)
    return service.renameConnection(req.connectionId, req.name)
  })
  ipcMain.handle('colab:connection:refresh-balances', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:connection:refresh-balances', refreshSchema, payload)
    return service.refreshBalances(req)
  })
  ipcMain.handle('colab:connection:open-browser', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:connection:open-browser', openBrowserSchema, payload)
    return service.openBrowser(req)
  })
  ipcMain.handle('colab:connection:sign-out', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:connection:sign-out', signOutSchema, payload)
    return driveNotebooks.releaseConnection(req.connectionId, async () => service.signOutConnection(req.connectionId, req.stopRunningSessions)).then(
      (result) => 'switchedToConnectionId' in result ? result : { ...result, switchedToConnectionId: null }
    )
  })
  ipcMain.handle('colab:workspace:inspect-sync', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:workspace:inspect-sync', workspaceOnlySchema, payload)
    return service.inspectWorkspaceSync(req.workspaceRoot)
  })
  ipcMain.handle('colab:workspace:save-config', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:workspace:save-config', saveConfigSchema, payload)
    return service.saveWorkspaceConfig(req.workspaceRoot, req.config)
  })
  ipcMain.handle('colab:session:start', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:start', startRunSchema, payload)
    return service.startRun(req)
  })
  ipcMain.handle('colab:session:stop', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:stop', sessionIdSchema, payload)
    uploads.get(req.sessionId)?.controller.abort()
    return service.stopSession(req.sessionId)
  })
  ipcMain.handle('colab:session:extend', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:extend', extendSessionSchema, payload)
    return service.extendSession(req.sessionId, req.addMinutes)
  })
  ipcMain.handle('colab:session:reconnect', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:reconnect', sessionIdSchema, payload)
    return service.reconnectSession(req.sessionId)
  })
  const sendNotebookEvent = (event: import('../../shared/colab/colab-notebook-types').ColabNotebookExecEvent): void => {
    const win = options.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('colab:notebook:event', event)
  }
  const driveMount = new ColabDriveMountManager(service)
  driveMount.subscribe((state) => {
    const win = options.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('colab:drive:mount-changed', state)
  })
  const notebookKernel = new ColabNotebookKernel(service, sendNotebookEvent, driveMount)
  const jupyterManager = new JupyterServerManager({
    colabRootDir: join(app.getPath('userData'), 'colab'),
    credentials: service.credentials,
    emitNotebookEvent: sendNotebookEvent
  })
  jupyterManager.subscribe((snapshot) => {
    const win = options.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('jupyter:state-changed', snapshot)
  })
  const portForwards = new ColabPortForwardManager(service)
  portForwards.subscribe((forwards) => {
    const win = options.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('colab:port-forwards-changed', forwards)
  })
  ipcMain.handle('colab:port-forward:list', async () => portForwards.list())
  ipcMain.handle('colab:port-forward:start', async (_, payload: unknown) =>
    portForwards.startForward(
      parseIpcPayload('colab:port-forward:start', portForwardStartSchema, payload)
    )
  )
  ipcMain.handle('colab:port-forward:stop', async (_, payload: unknown) =>
    portForwards.stopForward(
      parseIpcPayload('colab:port-forward:stop', portForwardStopSchema, payload).forwardId
    )
  )
  registerColabSubsystemShutdown(async () => {
    for (const upload of uploads.values()) upload.controller.abort()
    notebookKernel.shutdown()
    driveMount.shutdown()
    portForwards.shutdown()
    await Promise.all([driveNotebooks.shutdown(), jupyterManager.shutdown()])
  })
  setColabNotebookAgentRelay(
    new ColabNotebookAgentRelay((request) => {
      const win = options.getMainWindow()
      if (!win || win.isDestroyed()) return false
      win.webContents.send('colab:notebook:agent-request', request)
      return true
    })
  )
  ipcMain.handle('colab:notebook:agent-respond', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:agent-respond', notebookAgentResponseSchema, payload)
    getColabNotebookAgentRelay()?.respond(req)
    return { ok: true }
  })

  ipcMain.handle('colab:session:upload', async ({ sender }, payload: unknown): Promise<RuntimeUploadResult> => {
    const { sessionId, workspaceNotebook, targetRemoteDir } = parseIpcPayload('colab:session:upload', uploadSchema, payload)
    if (uploads.has(sessionId)) return { ok: false, uploadedCount: 0, message: 'An upload is already in progress.' }
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    uploads.set(sessionId, { controller, owner: sender.id })
    sender.once('destroyed', abort)
    try {
      const jupyter = isJupyterSessionId(sessionId)
      const session = (jupyter ? jupyterManager : service).getSnapshotSync().sessions.find((s) => s.id === sessionId)
      if (!session) throw new Error('Runtime not connected.')
      let paths: string[]
      if (workspaceNotebook) {
        if (!session.workspaceRoot.trim()) throw new Error('No workspace connected.')
        const path = await resolveOpenTargetPath(workspaceNotebook, session.workspaceRoot, { allowBasenameFallback: false })
        if (!path.toLowerCase().endsWith('.ipynb')) throw new Error('Select a project notebook.')
        paths = [path]
      } else {
        const win = options.getMainWindow()
        const picked = win
          ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
          : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
        if (picked.canceled || !picked.filePaths.length) return { ok: true, uploadedCount: 0 }
        paths = picked.filePaths
      }
      controller.signal.throwIfAborted()
      const transfer = { signal: controller.signal, onProgress: (progress: RuntimeUploadProgress) => {
        if (!sender.isDestroyed()) sender.send('colab:session:upload-progress', { ...progress, sessionId })
      } }
      return await (jupyter ? jupyterManager.uploadFiles(sessionId, paths, transfer, targetRemoteDir) : service.uploadToSession(sessionId, paths, transfer, targetRemoteDir))
    } catch (error) {
      return controller.signal.aborted ? { ok: false, canceled: true, uploadedCount: 0 }
        : { ok: false, uploadedCount: 0, message: error instanceof Error ? error.message : 'Upload failed.' }
    } finally {
      sender.removeListener('destroyed', abort)
      uploads.delete(sessionId)
    }
  })
  ipcMain.handle('colab:session:cancel-upload', ({ sender }, payload: unknown) => {
    const { sessionId } = parseIpcPayload('colab:session:cancel-upload', sessionIdSchema, payload)
    const upload = uploads.get(sessionId)
    if (upload?.owner === sender.id) upload.controller.abort()
  })
  ipcMain.handle('colab:session:download', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:download', downloadSchema, payload)
    return isJupyterSessionId(req.sessionId)
      ? jupyterManager.downloadFile(req.sessionId, req.remotePath)
      : service.downloadFromSession(req.sessionId, req.remotePath)
  })
  ipcMain.handle('colab:session:prepare-terminal', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:prepare-terminal', prepareTerminalSchema, payload)
    return service.prepareTerminalLaunch(req)
  })
  ipcMain.handle('colab:untracked:adopt', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:untracked:adopt', untrackedSchema, payload)
    return service.adoptUntrackedSession({
      connectionId: req.connectionId,
      endpoint: req.endpoint,
      workspaceRoot: req.workspaceRoot ?? ''
    })
  })
  ipcMain.handle('colab:untracked:stop', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:untracked:stop', untrackedSchema, payload)
    return service.stopUntrackedSession({
      connectionId: req.connectionId,
      endpoint: req.endpoint
    })
  })
  ipcMain.handle('colab:notebook:execute', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:execute', notebookExecSchema, payload)
    return isJupyterSessionId(req.sessionId) ? jupyterManager.execute(req) : notebookKernel.execute(req)
  })
  ipcMain.handle('colab:notebook:interrupt', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:interrupt', notebookInterruptSchema, payload)
    return jupyterManager.hasRunningExec(req.execId)
      ? jupyterManager.interruptExec(req.execId)
      : notebookKernel.interrupt(req.execId)
  })
  ipcMain.handle('colab:notebook:restart', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:restart', sessionIdSchema, payload)
    if (isJupyterSessionId(req.sessionId)) return jupyterManager.restartKernel(req.sessionId)
    await notebookKernel
      .execute({
        sessionId: req.sessionId,
        execId: `nb-restart-${Date.now().toString(36)}`,
        code: 'import os, signal\nos.kill(os.getpid(), signal.SIGKILL)'
      })
      .catch(() => undefined)
    return { ok: true }
  })
  ipcMain.handle('colab:notebook:list-files', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:list-files', notebookListSchema, payload)
    return isJupyterSessionId(req.sessionId) ? jupyterManager.listFiles(req) : notebookKernel.listFiles(req)
  })
  ipcMain.handle('colab:notebook:variables', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:variables', sessionIdSchema, payload)
    return isJupyterSessionId(req.sessionId) ? jupyterManager.listVariables(req) : notebookKernel.listVariables(req)
  })
  ipcMain.handle('colab:drive:start-pull', async (_, payload: unknown) =>
    driveNotebooks.startPull(parseIpcPayload('colab:drive:start-pull', drivePullStartSchema, payload)))
  ipcMain.handle('colab:drive:list-notebooks', async (_, payload: unknown) =>
    driveNotebooks.listNotebooks(parseIpcPayload('colab:drive:list-notebooks', pullIdSchema, payload)))
  ipcMain.handle('colab:drive:complete-auth', async (_, payload: unknown) =>
    driveNotebooks.completeAuth(parseIpcPayload('colab:drive:complete-auth', pullIdSchema, payload)))
  ipcMain.handle('colab:drive:open-auth', async (_, payload: unknown) =>
    driveNotebooks.openAuth(parseIpcPayload('colab:drive:open-auth', pullIdSchema, payload)))
  ipcMain.handle('colab:drive:close-pull', async (_, payload: unknown) =>
    driveNotebooks.closePull(parseIpcPayload('colab:drive:close-pull', pullIdSchema, payload).pullId))
  ipcMain.handle('colab:drive:import-notebook', async (_, payload: unknown) =>
    driveNotebooks.importDriveNotebook(parseIpcPayload('colab:drive:import-notebook', driveImportSchema, payload)))
  ipcMain.handle('colab:drive:mount-state', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:drive:mount-state', driveMountStateSchema, payload)
    return driveMount.getState(req.sessionId, { probe: req.probe })
  })
  ipcMain.handle('colab:drive:mount', async (_, payload: unknown) =>
    driveMount.mount(parseIpcPayload('colab:drive:mount', driveMountSchema, payload)))
  ipcMain.handle('colab:drive:complete-mount-auth', async (_, payload: unknown) =>
    driveMount.completeMountAuth(parseIpcPayload('colab:drive:complete-mount-auth', sessionIdSchema, payload)))
  ipcMain.handle('colab:drive:open-mount-auth', async (_, payload: unknown) =>
    driveMount.openMountAuth(parseIpcPayload('colab:drive:open-mount-auth', sessionIdSchema, payload)))
  ipcMain.handle('colab:drive:cancel-mount', async (_, payload: unknown) =>
    driveMount.cancelMount(parseIpcPayload('colab:drive:cancel-mount', sessionIdSchema, payload)))
  ipcMain.handle('colab:drive:unmount', async (_, payload: unknown) =>
    driveMount.unmount(parseIpcPayload('colab:drive:unmount', sessionIdSchema, payload)))
  ipcMain.handle('jupyter:get-snapshot', async () => jupyterManager.getSnapshot())
  ipcMain.handle('jupyter:save-server', async (_, payload: unknown) =>
    jupyterManager.saveServer(parseIpcPayload('jupyter:save-server', jupyterSaveServerSchema, payload)))
  ipcMain.handle('jupyter:list-notebooks', async (_, payload: unknown) =>
    jupyterManager.listNotebooks(parseIpcPayload('jupyter:list-notebooks', jupyterServerIdSchema, payload)))
  ipcMain.handle('jupyter:import-notebook', async (_, payload: unknown) =>
    jupyterManager.importNotebook(parseIpcPayload('jupyter:import-notebook', jupyterImportSchema, payload)))
  ipcMain.handle('jupyter:connect', async (_, payload: unknown) => {
    const req = parseIpcPayload('jupyter:connect', jupyterConnectSchema, payload)
    return jupyterManager.connect(req)
  })
  ipcMain.handle('jupyter:disconnect', async (_, payload: unknown) => {
    const req = parseIpcPayload('jupyter:disconnect', sessionIdSchema, payload)
    uploads.get(req.sessionId)?.controller.abort()
    return jupyterManager.disconnect(req.sessionId)
  })
  ipcMain.handle('jupyter:remove-server', async (_, payload: unknown) => {
    const req = parseIpcPayload('jupyter:remove-server', jupyterServerIdSchema, payload)
    return jupyterManager.removeServer(req.serverId)
  })
  ipcMain.handle('jupyter:open-browser', async (_, payload: unknown) => {
    const req = parseIpcPayload('jupyter:open-browser', jupyterServerIdSchema, payload)
    return jupyterManager.openBrowser(req.serverId)
  })
  ipcMain.handle('colab:notebook:import-local', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:import-local', workspaceOnlySchema, payload)
    const win = options.getMainWindow()
    const dialogOpts = {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    return driveNotebooks.importLocalNotebooks({
      workspaceRoot: req.workspaceRoot,
      localPaths: picked.filePaths
    })
  })
  ipcMain.handle('colab:notebook:assist', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:notebook:assist', notebookAssistSchema, payload)
    const settings = await options.store.load()
    return requestColabNotebookAssist(settings, req)
  })
  ipcMain.handle('colab:untracked:ignore', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:untracked:ignore', untrackedSchema, payload)
    return service.ignoreUntrackedSession({
      connectionId: req.connectionId,
      endpoint: req.endpoint
    })
  })
}

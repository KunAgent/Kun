import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { COLAB_ACCELERATORS } from '../../shared/colab/colab-types'
import { configureColabHost } from '../colab/colab-host'
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
    syncPaths: z.array(z.string().max(1024)).max(128),
    outputRemoteDir: z.string().max(512),
    outputLocalDir: z.string().max(512),
    maxRuntimeHours: z.number().min(0).max(48),
    autoStop: z.boolean(),
    saveWorkspaceConfig: z.boolean().optional(),
    mountDrive: z.boolean().optional(),
    envVars: z.record(z.string().max(128), z.string().max(2048)).optional(),
    setupScript: z.string().max(4096).optional(),
    terminalOnly: z.boolean().optional()
  })
  .strict()
const sessionIdSchema = z.object({ sessionId: z.string().min(1).max(128) }).strict()
const uploadSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    localPaths: z.array(z.string().max(4096)).max(64).optional()
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

export function registerAppColabIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const service = configureColabHost({
    getSettings: () => options.store.load()
  })

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
    return service.signOutConnection(req.connectionId, req.stopRunningSessions)
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
    return service.stopSession(req.sessionId)
  })
  ipcMain.handle('colab:session:reconnect', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:reconnect', sessionIdSchema, payload)
    return service.reconnectSession(req.sessionId)
  })
  ipcMain.handle('colab:session:upload', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:upload', uploadSchema, payload)
    let paths = req.localPaths
    if (!paths || paths.length === 0) {
      const win = options.getMainWindow()
      const picked = win
        ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
        : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: true, uploadedCount: 0 }
      }
      paths = picked.filePaths
    }
    return service.uploadToSession(req.sessionId, paths)
  })
  ipcMain.handle('colab:session:download', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:session:download', downloadSchema, payload)
    return service.downloadFromSession(req.sessionId, req.remotePath)
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
  ipcMain.handle('colab:untracked:ignore', async (_, payload: unknown) => {
    const req = parseIpcPayload('colab:untracked:ignore', untrackedSchema, payload)
    return service.ignoreUntrackedSession({
      connectionId: req.connectionId,
      endpoint: req.endpoint
    })
  })
}

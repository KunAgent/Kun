import { StringDecoder } from 'node:string_decoder'
import type { BrowserWindow, IpcMain, WebContents } from 'electron'
import { dialog } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { RemoteSshTerminalCreateResult } from '../../shared/remote-ssh'
import { REMOTE_SSH_MAX_SESSIONS } from '../../shared/remote-ssh'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import {
  remoteSshHostIdSchema,
  remoteSshHostInputSchema,
  remoteSshHostKeyConfirmationSchema,
  remoteSshHostUpdateSchema,
  remoteSshTerminalCreateSchema,
  remoteSshTerminalResizeSchema,
  remoteSshTerminalWriteSchema
} from '../ipc/app-ipc-schemas'
import type { RemoteSshHostStore } from './host-store'
import { RemoteSshKnownHostStore } from './known-host-store'
import { ConnectionPool, RemoteSshConnectionError, remoteSshKnownHostId } from './remote-host'

type Session = {
  stream: ClientChannel
  sender: WebContents
  hostId: string
  exited: boolean
  ringBuffer: string
  stdoutDecoder: StringDecoder
  stderrDecoder: StringDecoder
}

export type RemoteSshController = {
  disposeAll: () => void
  listSessionIds: () => string[]
}

export type RegisterRemoteSshIpcOptions = {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  hosts: RemoteSshHostStore
  knownHosts: RemoteSshKnownHostStore
  logError: (category: string, message: string, detail?: unknown) => void
}

export function registerRemoteSshIpc(options: RegisterRemoteSshIpcOptions): RemoteSshController {
  const { ipcMain, getMainWindow, hosts, knownHosts, logError } = options
  const pool = new ConnectionPool(knownHosts)
  const sessions = new Map<string, Session>()
  const trusted = (event: Electron.IpcMainInvokeEvent): void =>
    assertTrustedWorkbenchSender(event, getMainWindow)

  const disposeSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId)
    if (!session) return false
    session.exited = true
    sessions.delete(sessionId)
    session.stream.close()
    return true
  }
  const disposeHostSessions = (hostId: string): void => {
    for (const [sessionId, session] of sessions) {
      if (session.hostId === hostId) disposeSession(sessionId)
    }
  }
  const disposeSender = (sender: WebContents): void => {
    for (const [sessionId, session] of sessions) {
      if (session.sender === sender) disposeSession(sessionId)
    }
  }

  ipcMain.handle('remote-ssh:hosts:list', async (event) => {
    trusted(event)
    return hosts.list()
  })
  ipcMain.handle('remote-ssh:hosts:create', async (event, payload: unknown) => {
    trusted(event)
    return hosts.create(remoteSshHostInputSchema.parse(payload))
  })
  ipcMain.handle('remote-ssh:hosts:update', async (event, payload: unknown) => {
    trusted(event)
    const request = remoteSshHostUpdateSchema.parse(payload)
    disposeHostSessions(request.id)
    pool.close(request.id)
    return hosts.update(request.id, request.host)
  })
  ipcMain.handle('remote-ssh:hosts:remove', async (event, payload: unknown) => {
    trusted(event)
    const hostId = remoteSshHostIdSchema.parse(payload)
    disposeHostSessions(hostId)
    pool.close(hostId)
    return hosts.remove(hostId)
  })
  ipcMain.handle('remote-ssh:host-key:confirm', async (event, payload: unknown) => {
    trusted(event)
    const confirmation = remoteSshHostKeyConfirmationSchema.parse(payload)
    const host = await hosts.get(confirmation.hostId)
    if (!host) throw new Error('SSH host not found.')
    await knownHosts.confirm({
      ...confirmation,
      hostId: remoteSshKnownHostId(host.hostname, host.port)
    })
    pool.close(confirmation.hostId)
    return true
  })
  ipcMain.handle('remote-ssh:host-key:reset', async (event, payload: unknown) => {
    trusted(event)
    const hostId = remoteSshHostIdSchema.parse(payload)
    const host = await hosts.get(hostId)
    if (!host) return false
    disposeHostSessions(hostId)
    pool.close(hostId)
    return knownHosts.reset(remoteSshKnownHostId(host.hostname, host.port))
  })
  ipcMain.handle('remote-ssh:disconnect', async (event, payload: unknown) => {
    trusted(event)
    const hostId = remoteSshHostIdSchema.parse(payload)
    disposeHostSessions(hostId)
    pool.close(hostId)
    return true
  })
  ipcMain.handle('remote-ssh:pick-identity-file', async (event) => {
    trusted(event)
    const parent = getMainWindow()
    const options = {
      title: 'Select SSH identity file',
      properties: ['openFile'] as ['openFile'],
      filters: [{ name: 'SSH identity files', extensions: ['pem', 'key', 'pub', '*'] }]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('remote-ssh:connect', async (event, payload: unknown) => {
    trusted(event)
    const hostId = remoteSshHostIdSchema.parse(payload)
    const host = await hosts.get(hostId)
    if (!host) return { ok: false as const, reason: 'connectionFailed' as const, message: 'SSH host not found.' }
    return pool.get(host).connect()
  })
  ipcMain.handle('remote-ssh:terminal:create', async (event, payload: unknown) => {
    trusted(event)
    const request = remoteSshTerminalCreateSchema.parse(payload)
    const existing = sessions.get(request.sessionId)
    if (existing && !existing.exited && existing.hostId === request.hostId) {
      existing.sender = event.sender
      if (existing.ringBuffer) send(existing, 'remote-ssh:terminal:data', {
        sessionId: request.sessionId,
        data: existing.ringBuffer
      })
      return { ok: true, sessionId: request.sessionId } satisfies RemoteSshTerminalCreateResult
    }
    if (existing) disposeSession(request.sessionId)
    if (sessions.size >= REMOTE_SSH_MAX_SESSIONS) {
      return { ok: false, reason: 'sessionLimit', message: 'Too many remote terminal sessions.' } satisfies RemoteSshTerminalCreateResult
    }
    const host = await hosts.get(request.hostId)
    if (!host) return connectionFailure('SSH host not found.')
    try {
      const stream = await pool.get(host).shell(request.cols, request.rows)
      const session: Session = {
        stream,
        sender: event.sender,
        hostId: host.id,
        exited: false,
        ringBuffer: '',
        stdoutDecoder: new StringDecoder('utf8'),
        stderrDecoder: new StringDecoder('utf8')
      }
      sessions.set(request.sessionId, session)
      event.sender.once('destroyed', () => disposeSender(event.sender))
      stream.on('data', (data: Buffer | string) => publishData(session, request.sessionId, data, false))
      stream.stderr.on('data', (data: Buffer | string) => publishData(session, request.sessionId, data, true))
      stream.once('close', (code?: number) => {
        const stdoutTail = session.stdoutDecoder.end()
        const stderrTail = session.stderrDecoder.end()
        if (stdoutTail) publishText(session, request.sessionId, stdoutTail)
        if (stderrTail) publishText(session, request.sessionId, stderrTail)
        session.exited = true
        sessions.delete(request.sessionId)
        send(session, 'remote-ssh:terminal:exit', {
          sessionId: request.sessionId,
          exitCode: typeof code === 'number' ? code : null
        })
      })
      return { ok: true, sessionId: request.sessionId } satisfies RemoteSshTerminalCreateResult
    } catch (error) {
      if (error instanceof RemoteSshConnectionError) return error.result
      logError('remote-ssh', 'Failed to open remote shell', { message: safeError(error) })
      return connectionFailure(safeError(error))
    }
  })
  ipcMain.handle('remote-ssh:terminal:write', async (event, payload: unknown) => {
    trusted(event)
    const request = remoteSshTerminalWriteSchema.parse(payload)
    const session = sessions.get(request.sessionId)
    if (!session || session.sender !== event.sender || session.exited) return false
    session.stream.write(request.data)
    return true
  })
  ipcMain.handle('remote-ssh:terminal:resize', async (event, payload: unknown) => {
    trusted(event)
    const request = remoteSshTerminalResizeSchema.parse(payload)
    const session = sessions.get(request.sessionId)
    if (!session || session.sender !== event.sender || session.exited) return false
    session.stream.setWindow(request.rows, request.cols, 0, 0)
    return true
  })
  ipcMain.handle('remote-ssh:terminal:dispose', async (event, payload: unknown) => {
    trusted(event)
    const sessionId = remoteSshHostIdSchema.parse(payload)
    const session = sessions.get(sessionId)
    if (!session || session.sender !== event.sender) return false
    return disposeSession(sessionId)
  })

  return {
    listSessionIds: () => [...sessions.keys()],
    disposeAll: () => {
      for (const sessionId of [...sessions.keys()]) disposeSession(sessionId)
      pool.closeAll()
    }
  }
}

function publishData(session: Session, sessionId: string, data: Buffer | string, stderr: boolean): void {
  const text = typeof data === 'string'
    ? data
    : (stderr ? session.stderrDecoder : session.stdoutDecoder).write(data)
  if (text) publishText(session, sessionId, text)
}

function publishText(session: Session, sessionId: string, text: string): void {
  session.ringBuffer += text
  if (session.ringBuffer.length > 64 * 1024) session.ringBuffer = session.ringBuffer.slice(-64 * 1024)
  send(session, 'remote-ssh:terminal:data', { sessionId, data: text })
}

function send(session: Session, channel: string, payload: unknown): void {
  if (!session.sender.isDestroyed()) session.sender.send(channel, payload)
}
function connectionFailure(message: string): RemoteSshTerminalCreateResult {
  return { ok: false, reason: 'connectionFailed', message }
}
function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
}

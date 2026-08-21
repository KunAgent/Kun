import type {
  RemoteSshHost,
  RemoteSshHostKeyConfirmation,
  RemoteSshTerminalCreateResult
} from '@shared/remote-ssh'
import type {
  TerminalCreatePayload,
  TerminalCreateResult,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalResizePayload,
  TerminalWritePayload
} from '@shared/terminal'

export type TerminalTarget =
  | { kind: 'local' }
  | { kind: 'ssh'; hostId: string; hostName: string }

export type TerminalBackend = {
  create: (payload: TerminalCreatePayload) => Promise<TerminalCreateResult | RemoteSshTerminalCreateResult>
  write: (payload: TerminalWritePayload) => Promise<boolean>
  resize: (payload: TerminalResizePayload) => Promise<boolean>
  dispose: (sessionId: string) => Promise<boolean>
  onData: (handler: (payload: TerminalDataPayload) => void) => () => void
  onExit: (handler: (payload: TerminalExitPayload) => void) => () => void
}

export function terminalBackend(target: TerminalTarget): TerminalBackend {
  if (target.kind === 'local') {
    return {
      create: window.kunGui.createTerminal,
      write: window.kunGui.writeToTerminal,
      resize: window.kunGui.resizeTerminal,
      dispose: window.kunGui.disposeTerminal,
      onData: window.kunGui.onTerminalData,
      onExit: window.kunGui.onTerminalExit
    }
  }
  return {
    create: (payload) => window.kunGui.createRemoteSshTerminal({
      sessionId: payload.sessionId,
      hostId: target.hostId,
      cols: payload.cols,
      rows: payload.rows
    }),
    write: window.kunGui.writeToRemoteSshTerminal,
    resize: window.kunGui.resizeRemoteSshTerminal,
    dispose: window.kunGui.disposeRemoteSshTerminal,
    onData: window.kunGui.onRemoteSshTerminalData,
    onExit: window.kunGui.onRemoteSshTerminalExit
  }
}

export async function connectWithHostKeyConfirmation(
  hostId: string,
  confirm: (host: RemoteSshHost, confirmation: RemoteSshHostKeyConfirmation) => boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const hosts = await window.kunGui.listRemoteSshHosts()
  const host = hosts.find((candidate) => candidate.id === hostId)
  if (!host) return { ok: false, message: 'SSH server not found.' }
  let result = await window.kunGui.connectRemoteSshHost(hostId)
  if (!result.ok && result.reason === 'hostKeyConfirmationRequired') {
    if (!confirm(host, result)) return { ok: false, message: 'SSH host key was not trusted.' }
    await window.kunGui.confirmRemoteSshHostKey(result)
    result = await window.kunGui.connectRemoteSshHost(hostId)
  }
  return result.ok
    ? { ok: true }
    : { ok: false, message: result.reason === 'connectionFailed' ? result.message : 'SSH connection failed.' }
}

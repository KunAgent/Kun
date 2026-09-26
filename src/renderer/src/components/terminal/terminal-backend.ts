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
  /** `cwd` overrides the workspace root (e.g. a task worktree opened for review). */
  | { kind: 'local'; cwd?: string }
  | { kind: 'ssh'; hostId: string; hostName: string }
  /**
   * ADE terminal agent (docs/ade/05 §6.1): a harness CLI registered with kun
   * as an execution unit and launched inside a local PTY.
   */
  | {
      kind: 'agent'
      harnessId: string
      title: string
      task?: string
      cwd?: string
      taskWorkspaceId?: string
      parentThreadId?: string
      workspaceKind?: 'worktree' | 'local' | 'directory'
    }

/**
 * Extra `terminal:create` fields a target contributes. Agent targets carry
 * the execution-unit request; SSH keeps its own create surface.
 */
export function terminalTargetCreateExtras(
  target: TerminalTarget,
  workspaceRoot?: string
): Pick<TerminalCreatePayload, 'cwd' | 'agent'> {
  if (target.kind === 'agent') {
    return {
      cwd: target.cwd ?? workspaceRoot,
      agent: {
        harnessId: target.harnessId,
        title: target.title,
        ...(target.task ? { task: target.task } : {}),
        ...(target.taskWorkspaceId ? { taskWorkspaceId: target.taskWorkspaceId } : {}),
        ...(target.parentThreadId ? { parentThreadId: target.parentThreadId } : {}),
        ...(target.workspaceKind ? { workspaceKind: target.workspaceKind } : {})
      }
    }
  }
  if (target.kind === 'local') return { cwd: target.cwd ?? workspaceRoot }
  return {}
}

export type TerminalBackend = {
  create: (payload: TerminalCreatePayload) => Promise<TerminalCreateResult | RemoteSshTerminalCreateResult>
  write: (payload: TerminalWritePayload) => Promise<boolean>
  resize: (payload: TerminalResizePayload) => Promise<boolean>
  dispose: (sessionId: string) => Promise<boolean>
  onData: (handler: (payload: TerminalDataPayload) => void) => () => void
  onExit: (handler: (payload: TerminalExitPayload) => void) => () => void
}

export function terminalBackend(target: TerminalTarget): TerminalBackend {
  if (target.kind === 'local' || target.kind === 'agent') {
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

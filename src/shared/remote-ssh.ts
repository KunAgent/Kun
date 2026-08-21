export const REMOTE_SSH_DEFAULT_PORT = 22
export const REMOTE_SSH_MAX_HOSTS = 100
export const REMOTE_SSH_MAX_SESSIONS = 8
export const REMOTE_SSH_MAX_WRITE_BYTES = 1_000_000
export const REMOTE_SSH_MAX_SESSION_ID_LENGTH = 256
export const REMOTE_SSH_MAX_LABEL_LENGTH = 120
export const REMOTE_SSH_MAX_HOSTNAME_LENGTH = 253
export const REMOTE_SSH_MAX_USERNAME_LENGTH = 128
export const REMOTE_SSH_MAX_PATH_LENGTH = 4_096

export type RemoteSshAuth =
  | { type: 'agent' }
  | { type: 'identityFile'; identityFile: string }

export type RemoteSshHostInput = {
  label: string
  hostname: string
  port?: number
  username: string
  auth: RemoteSshAuth
}

export type RemoteSshHost = {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  auth: RemoteSshAuth
  createdAt: string
  updatedAt: string
}

export type RemoteSshHostKeyConfirmation = {
  hostId: string
  fingerprint: string
  key: string
}

export type RemoteSshConnectResult =
  | { ok: true; hostId: string }
  | ({ ok: false; reason: 'hostKeyConfirmationRequired' } & RemoteSshHostKeyConfirmation)
  | { ok: false; reason: 'hostKeyChanged'; message: string }
  | { ok: false; reason: 'connectionFailed'; message: string }

export type RemoteSshTerminalCreatePayload = {
  sessionId: string
  hostId: string
  cols?: number
  rows?: number
}

export type RemoteSshTerminalWritePayload = { sessionId: string; data: string }
export type RemoteSshTerminalResizePayload = { sessionId: string; cols: number; rows: number }
export type RemoteSshTerminalDataPayload = { sessionId: string; data: string }
export type RemoteSshTerminalExitPayload = { sessionId: string; exitCode: number | null }
export type RemoteSshApi = {
  resetRemoteSshHostKey: (hostId: string) => Promise<boolean>
  disconnectRemoteSshHost: (hostId: string) => Promise<boolean>
  pickRemoteSshIdentityFile: () => Promise<string | null>
  connectRemoteSshHost: (hostId: string) => Promise<RemoteSshConnectResult>
  listRemoteSshHosts: () => Promise<RemoteSshHost[]>
  createRemoteSshHost: (host: RemoteSshHostInput) => Promise<RemoteSshHost>
  updateRemoteSshHost: (id: string, host: RemoteSshHostInput) => Promise<RemoteSshHost>
  removeRemoteSshHost: (hostId: string) => Promise<boolean>
  confirmRemoteSshHostKey: (confirmation: RemoteSshHostKeyConfirmation) => Promise<boolean>
  createRemoteSshTerminal: (payload: RemoteSshTerminalCreatePayload) => Promise<RemoteSshTerminalCreateResult>
  writeToRemoteSshTerminal: (payload: RemoteSshTerminalWritePayload) => Promise<boolean>
  resizeRemoteSshTerminal: (payload: RemoteSshTerminalResizePayload) => Promise<boolean>
  disposeRemoteSshTerminal: (sessionId: string) => Promise<boolean>
  onRemoteSshTerminalData: (handler: (payload: RemoteSshTerminalDataPayload) => void) => () => void
  onRemoteSshTerminalExit: (handler: (payload: RemoteSshTerminalExitPayload) => void) => () => void
}

export type RemoteSshTerminalCreateResult =
  | { ok: true; sessionId: string }
  | ({ ok: false; reason: 'hostKeyConfirmationRequired' } & RemoteSshHostKeyConfirmation)
  | { ok: false; reason: 'hostKeyChanged' | 'connectionFailed' | 'sessionLimit'; message: string }

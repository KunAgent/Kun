import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { Client, type ClientChannel, type ConnectConfig, type HostVerifier } from 'ssh2'
import type { RemoteSshConnectResult, RemoteSshHost as RemoteSshHostConfig } from '../../shared/remote-ssh'
import { RemoteSshKnownHostStore, sshHostKeyFingerprint } from './known-host-store'

type PendingHostKey = { fingerprint: string; key: string }
type RejectedHostKey = { kind: 'unknown'; pending: PendingHostKey } | { kind: 'changed'; fingerprint: string }

export function remoteSshKnownHostId(hostname: string, port: number): string {
  return `${hostname.toLowerCase()}:${port}`
}

export class RemoteHost {
  private client: Client | null = null
  private connecting: Promise<RemoteSshConnectResult> | null = null

  constructor(
    readonly config: RemoteSshHostConfig,
    private readonly knownHosts: RemoteSshKnownHostStore
  ) {}

  connect(): Promise<RemoteSshConnectResult> {
    if (this.client) return Promise.resolve({ ok: true, hostId: this.config.id })
    if (this.connecting) return this.connecting
    this.connecting = this.open().finally(() => { this.connecting = null })
    return this.connecting
  }

  async shell(cols: number, rows: number): Promise<ClientChannel> {
    const result = await this.connect()
    if (!result.ok) throw new RemoteSshConnectionError(result)
    const client = this.client
    if (!client) throw new Error('SSH client disconnected before opening a shell.')
    return await new Promise<ClientChannel>((resolveShell, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
        if (error) reject(error)
        else resolveShell(stream)
      })
    })
  }

  close(): void {
    this.client?.end()
    this.client = null
  }

  private async open(): Promise<RemoteSshConnectResult> {
    const client = new Client()
    let rejectedKey: RejectedHostKey | undefined
    const connectConfig = await this.connectConfig(async (key) => {
      const state = await this.knownHosts.state(
        remoteSshKnownHostId(this.config.hostname, this.config.port),
        key
      )
      if (state === 'unknown') {
        rejectedKey = {
          kind: 'unknown',
          pending: { fingerprint: sshHostKeyFingerprint(key), key: key.toString('base64') }
        }
      } else if (state === 'mismatch') {
        rejectedKey = { kind: 'changed', fingerprint: sshHostKeyFingerprint(key) }
      }
      return state === 'match'
    })

    return await new Promise<RemoteSshConnectResult>((resolveConnection) => {
      let settled = false
      const finish = (result: RemoteSshConnectResult): void => {
        if (settled) return
        settled = true
        if (!result.ok) client.end()
        resolveConnection(result)
      }
      client.once('ready', () => {
        this.client = client
        client.once('close', () => { if (this.client === client) this.client = null })
        finish({ ok: true, hostId: this.config.id })
      })
      client.once('error', (error) => {
        if (rejectedKey?.kind === 'unknown') {
          finish({
            ok: false,
            reason: 'hostKeyConfirmationRequired',
            hostId: this.config.id,
            ...rejectedKey.pending
          })
        } else if (rejectedKey?.kind === 'changed') {
          finish({
            ok: false,
            reason: 'hostKeyChanged',
            message: `SSH host key changed (${rejectedKey.fingerprint}). Connection refused.`
          })
        } else {
          finish({ ok: false, reason: 'connectionFailed', message: safeError(error) })
        }
      })
      try {
        client.connect(connectConfig)
      } catch (error) {
        finish({ ok: false, reason: 'connectionFailed', message: safeError(error) })
      }
    })
  }

  private async connectConfig(
    verify: (key: Buffer) => Promise<boolean>
  ): Promise<ConnectConfig> {
    const hostVerifier: HostVerifier = (key, callback) => {
      void verify(key).then(callback, () => callback(false))
    }
    const config: ConnectConfig = {
      host: this.config.hostname,
      port: this.config.port,
      username: this.config.username,
      readyTimeout: 15_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostVerifier
    }
    if (this.config.auth.type === 'agent') {
      const agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : '')
      if (!agent) throw new Error('SSH agent is not available (SSH_AUTH_SOCK is unset).')
      config.agent = agent
    } else {
      const path = expandHome(this.config.auth.identityFile)
      config.privateKey = await readFile(path)
    }
    return config
  }
}

export class RemoteSshConnectionError extends Error {
  constructor(readonly result: Exclude<RemoteSshConnectResult, { ok: true }>) {
    super(result.reason === 'hostKeyConfirmationRequired'
      ? 'SSH host key confirmation required.'
      : result.message)
  }
}

export class ConnectionPool {
  private readonly hosts = new Map<string, RemoteHost>()

  constructor(private readonly knownHosts: RemoteSshKnownHostStore) {}

  get(config: RemoteSshHostConfig): RemoteHost {
    const existing = this.hosts.get(config.id)
    if (existing && existing.config.updatedAt === config.updatedAt) return existing
    existing?.close()
    const host = new RemoteHost(config, this.knownHosts)
    this.hosts.set(config.id, host)
    return host
  }

  close(hostId: string): void {
    this.hosts.get(hostId)?.close()
    this.hosts.delete(hostId)
  }

  closeAll(): void {
    for (const host of this.hosts.values()) host.close()
    this.hosts.clear()
  }
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return resolve(homedir(), path.slice(2))
  return resolve(path)
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 1_000)
}

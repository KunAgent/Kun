import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Read-only rendezvous for external agents: `~/.kun/gateway.json` says where
 * Kun's local model gateway listens. It never contains a credential; a client
 * confirms the endpoint with `GET /api/hello` before using it, so a stale
 * file from a crashed process is harmless.
 */
export type GatewayDiscoveryRecord = {
  name: 'kun'
  version: string
  pid: number
  instanceId: string
  baseUrl: string
  /** OpenAI-compatible base (`…/v1`). */
  v1: string
  /** Anthropic-compatible base (root). */
  anthropic: string
  hello: string
  updatedAt: string
}

export function gatewayDiscoveryFilePath(): string {
  return process.env.KUN_GATEWAY_DISCOVERY_FILE?.trim() || join(homedir(), '.kun', 'gateway.json')
}

export async function publishGatewayDiscovery(input: { baseUrl: string; version: string; instanceId: string }): Promise<string> {
  const file = gatewayDiscoveryFilePath()
  const base = input.baseUrl.replace(/\/+$/, '')
  const record: GatewayDiscoveryRecord = {
    name: 'kun', version: input.version, pid: process.pid, instanceId: input.instanceId,
    baseUrl: base, v1: `${base}/v1`, anthropic: base, hello: `${base}/api/hello`, updatedAt: new Date().toISOString()
  }
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  // Holds no secrets, but only this user's agents need it.
  await writeFile(temp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, file)
  return file
}

/** Removes the file only while it still names this process incarnation. */
export async function removeGatewayDiscovery(instanceId: string): Promise<void> {
  const file = gatewayDiscoveryFilePath()
  try {
    const current = JSON.parse(await readFile(file, 'utf8')) as Partial<GatewayDiscoveryRecord>
    if (current.instanceId === instanceId) await rm(file, { force: true })
  } catch {
    // Missing or foreign files are left alone.
  }
}

/** Reads the record currently at the discovery path, or null when absent or unreadable. */
export async function readGatewayDiscovery(): Promise<Partial<GatewayDiscoveryRecord> | null> {
  try {
    const value = JSON.parse(await readFile(gatewayDiscoveryFilePath(), 'utf8')) as unknown
    return value && typeof value === 'object' ? value as Partial<GatewayDiscoveryRecord> : null
  } catch {
    return null
  }
}

/**
 * Whether another Kun named by the file still serves its gateway: its process
 * exists and its hello endpoint answers with the same instance. A reused pid
 * or a hung process does not count, so a crashed owner never blocks us.
 */
export async function gatewayDiscoveryOwnerLive(record: Partial<GatewayDiscoveryRecord>): Promise<boolean> {
  if (typeof record.pid !== 'number' || !Number.isInteger(record.pid) || record.pid <= 0) return false
  try { process.kill(record.pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false }
  if (typeof record.hello !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//.test(record.hello)) return false
  try {
    const response = await fetch(record.hello, { signal: AbortSignal.timeout(1_500) })
    const body = await response.json() as { name?: unknown; instanceId?: unknown }
    // Builds before instance ids were reported are trusted by name alone.
    return response.ok && body.name === 'kun' && (body.instanceId === undefined || body.instanceId === record.instanceId)
  } catch {
    return false
  }
}

export type GatewayDiscoveryOwner = 'self' | 'other' | 'none'
export type GatewayDiscoveryStatus = {
  allowed: boolean
  advertised: boolean
  path: string
  owner: GatewayDiscoveryOwner
  /** Another live Kun holds the file; this one takes over when it quits. */
  other?: { baseUrl?: string; pid?: number }
}

const OWNER_RECHECK_MS = 30_000

/**
 * Keeps the discovery file in line with the user's setting while the runtime
 * runs. Each pass reads the file back: it is republished when missing or left
 * by an instance that is gone, removed when the setting is turned off, and
 * left alone while another live Kun holds it. That Kun keeps it until it
 * quits, and this one republishes within one pass after.
 */
export class GatewayDiscoveryPublisher {
  private published = false
  private owner: GatewayDiscoveryOwner = 'none'
  private other?: { baseUrl?: string; pid?: number }
  private otherChecked?: { instanceId: string; at: number; live: boolean }
  private running: Promise<void> = Promise.resolve()

  constructor(private readonly input: { baseUrl: string; version: string; instanceId: string },
    private readonly wanted: () => boolean, private readonly allowed = true,
    private readonly options: { ownerLive?: (record: Partial<GatewayDiscoveryRecord>) => Promise<boolean>; now?: () => number } = {}) {}

  get instanceId(): string { return this.input.instanceId }

  status(): GatewayDiscoveryStatus {
    return { allowed: this.allowed, advertised: this.published, path: gatewayDiscoveryFilePath(), owner: this.owner,
      ...(this.owner === 'other' && this.other ? { other: this.other } : {}) }
  }

  /** Publishes, keeps, yields or removes the file to match the setting. Calls are serialized. */
  reconcile(): Promise<void> {
    this.running = this.running.then(() => this.pass()).catch((error) => { console.warn('[kun] gateway discovery update failed:', error) })
    return this.running
  }

  private async pass(): Promise<void> {
    const want = this.allowed && this.wanted()
    const current = await readGatewayDiscovery()
    const mine = current?.instanceId === this.input.instanceId
    if (!want) {
      if (mine) await removeGatewayDiscovery(this.input.instanceId)
      this.published = false
      this.owner = current && !mine ? 'other' : 'none'
      this.other = current && !mine ? { baseUrl: current.baseUrl, pid: current.pid } : undefined
      return
    }
    if (mine) { this.published = true; this.owner = 'self'; this.other = undefined; return }
    if (current && typeof current.instanceId === 'string' && await this.otherLive(current)) {
      this.published = false
      this.owner = 'other'
      this.other = { baseUrl: current.baseUrl, pid: current.pid }
      return
    }
    await publishGatewayDiscovery(this.input)
    this.published = true
    this.owner = 'self'
    this.other = undefined
  }

  private async otherLive(record: Partial<GatewayDiscoveryRecord>): Promise<boolean> {
    const now = this.options.now?.() ?? Date.now()
    const cached = this.otherChecked
    if (cached && cached.instanceId === record.instanceId && now - cached.at < OWNER_RECHECK_MS) return cached.live
    const live = await (this.options.ownerLive ?? gatewayDiscoveryOwnerLive)(record)
    this.otherChecked = { instanceId: String(record.instanceId), at: now, live }
    return live
  }

  async stop(): Promise<void> {
    await this.running
    if (this.published) { await removeGatewayDiscovery(this.input.instanceId); this.published = false }
  }
}

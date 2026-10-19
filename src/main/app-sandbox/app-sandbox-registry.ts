import { randomBytes } from 'node:crypto'
import {
  APP_SANDBOX_GEN_UI_PARTITION,
  APP_SANDBOX_GESTURE_WINDOW_MS,
  APP_SANDBOX_MAX_INSTANCES,
  appSandboxGenUiGuestUrl,
  appSandboxMcpGuestUrl,
  appSandboxMcpPartition,
  appSandboxShellUrl,
  type AppSandboxKind
} from '../../shared/app-sandbox'

export type AppSandboxRecord = {
  instanceId: string
  nonce: string
  kind: AppSandboxKind
  ownerWebContentsId: number
  threadId: string
  partition: string
  shellUrl: string
  guestUrl: string
  /** Complete guest document, including the injected host prelude. */
  html: string
  csp: string
  /** MCP App only. */
  serverId?: string
  serverHost?: string
  resourceUri?: string
  guestWebContentsId?: number
  lastGestureAt?: number
  createdAt: number
  /** Relative assets already read for this page. */
  assetCache: Map<string, { body: Uint8Array; mimeType: string }>
}

export type AppSandboxRecordInput = {
  kind: AppSandboxKind
  ownerWebContentsId: number
  threadId: string
  html: string
  csp: string
  serverId?: string
  serverHost?: string
  resourceUri?: string
}

export class AppSandboxCapacityError extends Error {
  readonly code = 'APP_SANDBOX_CAPACITY'
  constructor() {
    super('Too many interactive pages are open. Close some cards and try again.')
  }
}

/**
 * In-memory registry of live sandbox instances. Identity is bound by Main:
 * the owner WebContents that requested the page, a random instance id used in
 * URLs, and a secret nonce delivered only through guest launch arguments.
 */
export class AppSandboxRegistry {
  private readonly records = new Map<string, AppSandboxRecord>()

  constructor(private readonly now: () => number = Date.now) {}

  create(input: AppSandboxRecordInput): AppSandboxRecord {
    if (this.records.size >= APP_SANDBOX_MAX_INSTANCES) this.evictOldestUnattached()
    if (this.records.size >= APP_SANDBOX_MAX_INSTANCES) throw new AppSandboxCapacityError()
    const instanceId = randomBytes(16).toString('hex')
    const nonce = randomBytes(24).toString('hex')
    const mcp = input.kind === 'mcp-app'
    if (mcp && !input.serverHost) throw new Error('MCP App instances need a server host')
    const record: AppSandboxRecord = {
      instanceId,
      nonce,
      kind: input.kind,
      ownerWebContentsId: input.ownerWebContentsId,
      threadId: input.threadId,
      partition: mcp ? appSandboxMcpPartition(input.serverHost!) : APP_SANDBOX_GEN_UI_PARTITION,
      shellUrl: appSandboxShellUrl(instanceId),
      guestUrl: mcp
        ? appSandboxMcpGuestUrl(input.serverHost!, instanceId)
        : appSandboxGenUiGuestUrl(instanceId),
      html: input.html,
      csp: input.csp,
      ...(input.serverId ? { serverId: input.serverId } : {}),
      ...(input.serverHost ? { serverHost: input.serverHost } : {}),
      ...(input.resourceUri ? { resourceUri: input.resourceUri } : {}),
      createdAt: this.now(),
      assetCache: new Map()
    }
    this.records.set(instanceId, record)
    return record
  }

  get(instanceId: string): AppSandboxRecord | undefined {
    return this.records.get(instanceId)
  }

  /** The guest proves its identity with the nonce Main put on its command line. */
  bindGuest(instanceId: string, nonce: string, guestWebContentsId: number): AppSandboxRecord | undefined {
    const record = this.records.get(instanceId)
    if (!record || record.nonce !== nonce) return undefined
    if (record.guestWebContentsId !== undefined && record.guestWebContentsId !== guestWebContentsId) {
      return undefined
    }
    record.guestWebContentsId = guestWebContentsId
    return record
  }

  findByGuest(guestWebContentsId: number): AppSandboxRecord | undefined {
    for (const record of this.records.values()) {
      if (record.guestWebContentsId === guestWebContentsId) return record
    }
    return undefined
  }

  recordGesture(guestWebContentsId: number): void {
    const record = this.findByGuest(guestWebContentsId)
    if (record) record.lastGestureAt = this.now()
  }

  /** A gesture authorizes exactly one sensitive action inside its window. */
  consumeGesture(instanceId: string): boolean {
    const record = this.records.get(instanceId)
    if (!record?.lastGestureAt) return false
    const fresh = this.now() - record.lastGestureAt <= APP_SANDBOX_GESTURE_WINDOW_MS
    record.lastGestureAt = undefined
    return fresh
  }

  dispose(instanceId: string): AppSandboxRecord | undefined {
    const record = this.records.get(instanceId)
    if (record) this.records.delete(instanceId)
    return record
  }

  disposeOwner(ownerWebContentsId: number): AppSandboxRecord[] {
    const removed: AppSandboxRecord[] = []
    for (const record of [...this.records.values()]) {
      if (record.ownerWebContentsId !== ownerWebContentsId) continue
      this.records.delete(record.instanceId)
      removed.push(record)
    }
    return removed
  }

  size(): number {
    return this.records.size
  }

  private evictOldestUnattached(): void {
    const stale = [...this.records.values()]
      .filter((record) => record.guestWebContentsId === undefined && this.now() - record.createdAt > 60_000)
      .sort((left, right) => left.createdAt - right.createdAt)[0]
    if (stale) this.records.delete(stale.instanceId)
  }
}

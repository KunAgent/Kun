import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import {
  HostMessageSchema,
  LocaleSchema,
  NotificationOptionsSchema,
  ThemeSchema,
  type HostMessage,
  type JsonValue,
  type Locale,
  type NotificationOptions,
  type Theme
} from '@kun/extension-api'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'

export const DEFAULT_EXTENSION_VIEW_SESSION_TTL_MS = 2 * 60 * 60_000
export const DEFAULT_EXTENSION_VIEW_EVENT_LIMIT = 256
export const DEFAULT_EXTENSION_VIEW_EVENT_BYTES = 512 * 1024
export const DEFAULT_EXTENSION_VIEW_MESSAGE_RATE = 120
export const DEFAULT_EXTENSION_VIEW_IN_FLIGHT_LIMIT = 16
export const DEFAULT_EXTENSION_NOTIFICATION_TTL_MS = 45_000
export const DEFAULT_EXTENSION_NOTIFICATION_LIMIT = 64
export const DEFAULT_EXTENSION_NOTIFICATION_PER_EXTENSION_LIMIT = 8
export const DEFAULT_EXTENSION_WORKBENCH_LEASE_MS = 15_000

const MAX_SINGLE_EVENT_BYTES = 256 * 1024

export type ExtensionViewSessionTarget = {
  extensionId: string
  extensionVersion: string
  contributionId: string
  localContributionId: string
  entry: string
  activationEvent: string
  workspaceRoot?: string
  grantedPermissions: readonly string[]
  workspaceTrusted: boolean
}

export type ExtensionViewSessionProjection = {
  sessionId: string
  contributionId: string
  extensionId: string
  extensionVersion: string
  src: string
  partition: string
  workspaceRoot?: string
  createdAt: string
  expiresAt: string
}

export type CreatedExtensionViewSession = ExtensionViewSessionProjection & {
  /** Returned once to trusted Electron Main; the service stores only its digest. */
  nonce: string
}

export type ExtensionViewSessionLifecycleEvent = {
  state: 'created' | 'disposed'
  session: ExtensionViewSessionProjection
}

export type ExtensionViewSessionEvent = {
  sequence: number
  timestamp: string
  type: 'session' | 'message' | 'notification' | 'bridge' | 'overflow'
  payload: JsonValue
}

export type ExtensionViewSessionReplay = {
  events: ExtensionViewSessionEvent[]
  nextCursor: number
  hasMore: boolean
  cursorExpired: boolean
  oldestAvailableCursor: number
}

type StoredEvent = ExtensionViewSessionEvent & { bytes: number }

type StoredSession = {
  projection: ExtensionViewSessionProjection
  target: ExtensionViewSessionTarget
  nonceDigest: Buffer
  nextSequence: number
  events: StoredEvent[]
  retainedBytes: number
  listeners: Set<(event: ExtensionViewSessionEvent) => void>
  requestWindowStartedAt: number
  requestCount: number
  inFlight: number
  operations: Map<string, AbortController>
  disposed: boolean
}

export type ExtensionWorkbenchNotification = {
  notificationId: string
  extensionId: string
  extensionVersion: string
  sourceId: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'error'
  actions: Array<{ id: string; title: string }>
  createdAt: string
  expiresAt: string
}

type PendingWorkbenchNotification = {
  projection: ExtensionWorkbenchNotification
  workspaceIds: readonly string[]
  resolve: (actionId: string | undefined) => void
  timer: NodeJS.Timeout
  signal?: AbortSignal
  abortListener?: () => void
}

type ExtensionViewPublishScope =
  | { workspaceRoots: readonly string[] }
  | { workspaceKey: string }

export type ExtensionViewSessionServiceOptions = {
  now?: () => Date
  ttlMs?: number
  maxSessions?: number
  maxEvents?: number
  maxEventBytes?: number
  maxRequestsPerMinute?: number
  maxInFlight?: number
  notificationTtlMs?: number
  maxNotifications?: number
  maxNotificationsPerExtension?: number
  workbenchLeaseMs?: number
}

export class ExtensionViewSessionError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'unauthorized'
      | 'rate_limited'
      | 'session_limit'
      | 'payload_too_large',
    message: string
  ) {
    super(message)
  }
}

/**
 * Runtime-owned, non-persistent Webview session registry.
 *
 * The runtime bearer token is never stored here. A random per-view nonce is
 * issued to trusted Main and retained only as a SHA-256 digest. All projections
 * and events are deliberately non-secret and bounded.
 */
export class ExtensionViewSessionService {
  private readonly sessions = new Map<string, StoredSession>()
  private readonly disposeListeners = new Set<(sessionId: string) => void>()
  private readonly lifecycleListeners = new Set<(
    event: ExtensionViewSessionLifecycleEvent
  ) => void>()
  private readonly now: () => Date
  private readonly ttlMs: number
  private readonly maxSessions: number
  private readonly maxEvents: number
  private readonly maxEventBytes: number
  private readonly maxRequestsPerMinute: number
  private readonly maxInFlight: number
  private readonly notificationTtlMs: number
  private readonly maxNotifications: number
  private readonly maxNotificationsPerExtension: number
  private readonly workbenchLeaseMs: number
  private readonly notifications = new Map<string, PendingWorkbenchNotification>()
  private workbenchLeaseExpiresAt = 0
  private workbenchLeaseTimer?: NodeJS.Timeout
  private workbenchTheme: Theme = ThemeSchema.parse({
    kind: 'dark',
    tokens: {},
    zoomFactor: 1,
    reducedMotion: false
  })
  private workbenchLocale: Locale = LocaleSchema.parse({
    language: 'en',
    direction: 'ltr',
    messages: {}
  })

  constructor(options: ExtensionViewSessionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.ttlMs = boundedInteger(options.ttlMs, DEFAULT_EXTENSION_VIEW_SESSION_TTL_MS, 1_000)
    this.maxSessions = boundedInteger(options.maxSessions, 128, 1)
    this.maxEvents = boundedInteger(options.maxEvents, DEFAULT_EXTENSION_VIEW_EVENT_LIMIT, 1)
    this.maxEventBytes = boundedInteger(options.maxEventBytes, DEFAULT_EXTENSION_VIEW_EVENT_BYTES, 1_024)
    this.maxRequestsPerMinute = boundedInteger(
      options.maxRequestsPerMinute,
      DEFAULT_EXTENSION_VIEW_MESSAGE_RATE,
      1
    )
    this.maxInFlight = boundedInteger(options.maxInFlight, DEFAULT_EXTENSION_VIEW_IN_FLIGHT_LIMIT, 1)
    this.notificationTtlMs = boundedInteger(
      options.notificationTtlMs,
      DEFAULT_EXTENSION_NOTIFICATION_TTL_MS,
      1_000
    )
    this.maxNotifications = boundedInteger(
      options.maxNotifications,
      DEFAULT_EXTENSION_NOTIFICATION_LIMIT,
      1
    )
    this.maxNotificationsPerExtension = boundedInteger(
      options.maxNotificationsPerExtension,
      DEFAULT_EXTENSION_NOTIFICATION_PER_EXTENSION_LIMIT,
      1
    )
    this.workbenchLeaseMs = boundedInteger(
      options.workbenchLeaseMs,
      DEFAULT_EXTENSION_WORKBENCH_LEASE_MS,
      1_000
    )
  }

  create(targetInput: ExtensionViewSessionTarget): CreatedExtensionViewSession {
    this.pruneExpired()
    if (this.sessions.size >= this.maxSessions) {
      throw new ExtensionViewSessionError('session_limit', 'Extension view session limit reached')
    }
    const target = cloneTarget(targetInput)
    const sessionId = `view_${randomUUID()}`
    const nonce = randomBytes(32).toString('base64url')
    const now = this.now()
    const projection: ExtensionViewSessionProjection = {
      sessionId,
      contributionId: target.contributionId,
      extensionId: target.extensionId,
      extensionVersion: target.extensionVersion,
      src: extensionResourceUrl(target.extensionId, target.entry),
      partition: extensionPartition(target.extensionId),
      ...(target.workspaceRoot ? { workspaceRoot: target.workspaceRoot } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString()
    }
    const session: StoredSession = {
      projection,
      target,
      nonceDigest: digestNonce(nonce),
      nextSequence: 1,
      events: [],
      retainedBytes: 0,
      listeners: new Set(),
      requestWindowStartedAt: now.getTime(),
      requestCount: 0,
      inFlight: 0,
      operations: new Map(),
      disposed: false
    }
    this.sessions.set(sessionId, session)
    this.append(session, 'session', {
      state: 'ready',
      contributionId: target.contributionId,
      extensionVersion: target.extensionVersion
    })
    this.emitLifecycle('created', projection)
    return { ...structuredClone(projection), nonce }
  }

  authenticate(sessionId: string, nonce: string): ExtensionViewSessionProjection {
    const session = this.requireLive(sessionId)
    const actual = digestNonce(nonce)
    if (!timingSafeEqual(actual, session.nonceDigest)) {
      throw new ExtensionViewSessionError('unauthorized', 'Extension view session authentication failed')
    }
    return structuredClone(session.projection)
  }

  principal(sessionId: string): ExtensionPrincipal {
    const session = this.requireLive(sessionId)
    return {
      extensionId: session.target.extensionId,
      extensionVersion: session.target.extensionVersion,
      permissions: [...session.target.grantedPermissions],
      workspaceRoots: session.target.workspaceRoot ? [session.target.workspaceRoot] : [],
      workspaceTrusted: session.target.workspaceTrusted,
      viewSessionId: session.projection.sessionId,
      viewContributionId: session.target.contributionId
    }
  }

  target(sessionId: string): ExtensionViewSessionTarget {
    return cloneTarget(this.requireLive(sessionId).target)
  }

  beginRequest(sessionId: string): () => void {
    const session = this.requireLive(sessionId)
    const now = this.now().getTime()
    if (now - session.requestWindowStartedAt >= 60_000) {
      session.requestWindowStartedAt = now
      session.requestCount = 0
    }
    if (session.requestCount >= this.maxRequestsPerMinute || session.inFlight >= this.maxInFlight) {
      throw new ExtensionViewSessionError('rate_limited', 'Extension view session request limit reached')
    }
    session.requestCount += 1
    session.inFlight += 1
    let released = false
    return () => {
      if (released) return
      released = true
      session.inFlight = Math.max(0, session.inFlight - 1)
    }
  }

  beginOperation(sessionId: string, requestId: string): {
    signal: AbortSignal
    finish(): void
  } {
    const release = this.beginRequest(sessionId)
    const session = this.requireLive(sessionId)
    if (session.operations.has(requestId)) {
      release()
      throw new ExtensionViewSessionError('rate_limited', 'Duplicate extension view request ID')
    }
    const controller = new AbortController()
    session.operations.set(requestId, controller)
    let finished = false
    return {
      signal: controller.signal,
      finish: () => {
        if (finished) return
        finished = true
        if (session.operations.get(requestId) === controller) session.operations.delete(requestId)
        release()
      }
    }
  }

  cancelOperation(sessionId: string, requestId: string): boolean {
    const session = this.requireLive(sessionId)
    const controller = session.operations.get(requestId)
    if (!controller) return false
    controller.abort()
    return true
  }

  publishMessage(
    extensionId: string,
    messageInput: unknown,
    options?: { workspaceRoots: readonly string[] }
  ): number {
    const message = HostMessageSchema.parse(messageInput)
    return this.publish(extensionId, 'message', message, options)
  }

  /** Trusted workbench HostMessage addressed to one exact View Session. */
  publishHostMessage(sessionId: string, messageInput: unknown): void {
    const session = this.requireLive(sessionId)
    const message = HostMessageSchema.parse(messageInput)
    this.append(session, 'message', message)
  }

  setWorkbenchEnvironment(input: { theme: Theme; locale: Locale }): {
    themeChanged: boolean
    localeChanged: boolean
  } {
    const theme = ThemeSchema.parse(input.theme)
    const locale = LocaleSchema.parse(input.locale)
    const themeChanged = JSON.stringify(theme) !== JSON.stringify(this.workbenchTheme)
    const localeChanged = JSON.stringify(locale) !== JSON.stringify(this.workbenchLocale)
    this.workbenchTheme = theme
    this.workbenchLocale = locale
    this.touchWorkbench()
    return { themeChanged, localeChanged }
  }

  /** Refreshes the trusted Main workbench lease without exposing a bearer token to guests. */
  touchWorkbench(): void {
    this.workbenchLeaseExpiresAt = this.now().getTime() + this.workbenchLeaseMs
    if (this.workbenchLeaseTimer) clearTimeout(this.workbenchLeaseTimer)
    this.workbenchLeaseTimer = setTimeout(() => this.expireWorkbenchLease(), this.workbenchLeaseMs)
    this.workbenchLeaseTimer.unref?.()
  }

  disconnectWorkbench(): void {
    this.workbenchLeaseExpiresAt = 0
    if (this.workbenchLeaseTimer) clearTimeout(this.workbenchLeaseTimer)
    this.workbenchLeaseTimer = undefined
    for (const notificationId of [...this.notifications.keys()]) {
      this.settleNotification(notificationId, undefined)
    }
  }

  workbenchEnvironment(): { theme: Theme; locale: Locale } {
    return {
      theme: structuredClone(this.workbenchTheme),
      locale: structuredClone(this.workbenchLocale)
    }
  }

  publishNotification(
    principal: Pick<ExtensionPrincipal, 'extensionId' | 'extensionVersion'> &
      Partial<Pick<ExtensionPrincipal, 'workspaceRoots'>>,
    notificationInput: unknown,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined)
    if (!this.hasLiveWorkbenchLease()) return Promise.resolve(undefined)
    this.pruneExpiredNotifications()
    const notification = NotificationOptionsSchema.parse(notificationInput)
    const extensionCount = [...this.notifications.values()].filter(
      ({ projection }) => projection.extensionId === principal.extensionId
    ).length
    if (
      this.notifications.size >= this.maxNotifications ||
      extensionCount >= this.maxNotificationsPerExtension
    ) {
      throw new ExtensionViewSessionError(
        'rate_limited',
        'Extension workbench notification limit reached'
      )
    }
    const notificationId = `notification_${randomUUID()}`
    const createdAt = this.now()
    const projection: ExtensionWorkbenchNotification = {
      notificationId,
      extensionId: principal.extensionId,
      extensionVersion: principal.extensionVersion,
      sourceId: notification.id,
      title: notification.title,
      message: notification.message,
      severity: notification.severity,
      actions: notification.actions.map((action) => ({ ...action })),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.notificationTtlMs).toISOString()
    }
    return new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(
        () => this.settleNotification(notificationId, undefined),
        this.notificationTtlMs
      )
      timer.unref?.()
      const abortListener = signal
        ? () => this.settleNotification(notificationId, undefined)
        : undefined
      this.notifications.set(notificationId, {
        projection,
        workspaceIds: (principal.workspaceRoots ?? []).map(extensionWorkspaceKey),
        resolve,
        timer,
        ...(signal ? { signal } : {}),
        ...(abortListener ? { abortListener } : {})
      })
      if (signal && abortListener) {
        signal.addEventListener('abort', abortListener, { once: true })
        if (signal.aborted) abortListener()
      }
    })
  }

  listWorkbenchNotifications(): ExtensionWorkbenchNotification[] {
    this.pruneExpiredNotifications()
    return [...this.notifications.values()]
      .map(({ projection }) => structuredClone(projection))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  respondWorkbenchNotification(notificationId: string, actionId?: string): boolean {
    this.pruneExpiredNotifications()
    const pending = this.notifications.get(notificationId)
    if (!pending) return false
    if (actionId !== undefined && !pending.projection.actions.some((action) => action.id === actionId)) {
      throw new ExtensionViewSessionError(
        'unauthorized',
        'Extension notification action is not available'
      )
    }
    return this.settleNotification(notificationId, actionId)
  }

  publish(
    extensionId: string,
    type: ExtensionViewSessionEvent['type'],
    payload: JsonValue,
    options?: ExtensionViewPublishScope
  ): number {
    this.pruneExpired()
    let delivered = 0
    for (const session of this.sessions.values()) {
      if (session.target.extensionId !== extensionId || session.disposed) continue
      if (
        options !== undefined &&
        !('workspaceKey' in options
          ? viewSessionMatchesWorkspaceKey(session.target, options.workspaceKey)
          : viewSessionMatchesWorkspace(session.target, options.workspaceRoots))
      ) continue
      this.append(session, type, payload)
      delivered += 1
    }
    return delivered
  }

  /**
   * Publish a public SDK notification to exactly one sender-bound Webview.
   * The session identity comes from the authenticated principal rather than
   * extension-controlled request data.
   */
  publishBridgeNotification(input: {
    principal: ExtensionPrincipal
    method: string
    params: JsonValue
  }): void {
    const sessionId = input.principal.viewSessionId
    if (!sessionId) {
      throw new ExtensionViewSessionError('unauthorized', 'A sender-bound View Session is required')
    }
    const session = this.requireLive(sessionId)
    if (
      session.target.extensionId !== input.principal.extensionId ||
      session.target.extensionVersion !== input.principal.extensionVersion ||
      (input.principal.viewContributionId !== undefined &&
        session.target.contributionId !== input.principal.viewContributionId)
    ) {
      throw new ExtensionViewSessionError('unauthorized', 'Extension view principal does not own this session')
    }
    this.append(session, 'bridge', {
      method: input.method,
      params: structuredClone(input.params)
    })
  }

  onDidDispose(listener: (sessionId: string) => void): () => void {
    this.disposeListeners.add(listener)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.disposeListeners.delete(listener)
    }
  }

  /**
   * Synchronous ownership signal used by the runtime to retain/release the
   * extension Host before asynchronous View activation or teardown can race.
   */
  onDidLifecycle(listener: (event: ExtensionViewSessionLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.lifecycleListeners.delete(listener)
    }
  }

  replay(sessionId: string, cursor: number, limit: number): ExtensionViewSessionReplay {
    const session = this.requireLive(sessionId)
    const oldestSequence = session.events[0]?.sequence ?? session.nextSequence
    const oldestAvailableCursor = Math.max(0, oldestSequence - 1)
    const cursorExpired = cursor < oldestAvailableCursor
    const effectiveCursor = cursorExpired ? oldestAvailableCursor : cursor
    const available = session.events.filter((event) => event.sequence > effectiveCursor)
    const selected = available.slice(0, limit).map(stripStoredEvent)
    return {
      events: selected,
      nextCursor: selected.at(-1)?.sequence ?? effectiveCursor,
      hasMore: available.length > selected.length,
      cursorExpired,
      oldestAvailableCursor
    }
  }

  subscribe(sessionId: string, listener: (event: ExtensionViewSessionEvent) => void): () => void {
    const session = this.requireLive(sessionId)
    session.listeners.add(listener)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      session.listeners.delete(listener)
    }
  }

  disposeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.disposed = true
    for (const controller of session.operations.values()) controller.abort()
    session.operations.clear()
    session.listeners.clear()
    session.events.length = 0
    session.retainedBytes = 0
    this.sessions.delete(sessionId)
    for (const listener of this.disposeListeners) {
      try {
        listener(sessionId)
      } catch {
        // A cleanup listener cannot prevent disposal of the authenticated session.
      }
    }
    this.emitLifecycle('disposed', session.projection)
    return true
  }

  disposeExtension(extensionId: string): number {
    const ids = [...this.sessions]
      .filter(([, session]) => session.target.extensionId === extensionId)
      .map(([sessionId]) => sessionId)
    for (const sessionId of ids) this.disposeSession(sessionId)
    for (const [notificationId, pending] of this.notifications) {
      if (pending.projection.extensionId === extensionId) {
        this.settleNotification(notificationId, undefined)
      }
    }
    return ids.length
  }

  /** Dispose only Views and prompts admitted for one extension workspace. */
  disposeExtensionWorkspace(extensionId: string, workspaceId: string): number {
    const ids = [...this.sessions]
      .filter(([, session]) =>
        session.target.extensionId === extensionId &&
        session.target.workspaceRoot !== undefined &&
        extensionWorkspaceKey(session.target.workspaceRoot) === workspaceId)
      .map(([sessionId]) => sessionId)
    for (const sessionId of ids) this.disposeSession(sessionId)
    for (const [notificationId, pending] of this.notifications) {
      if (
        pending.projection.extensionId === extensionId &&
        pending.workspaceIds.includes(workspaceId)
      ) this.settleNotification(notificationId, undefined)
    }
    return ids.length
  }

  disposeAll(): void {
    this.disconnectWorkbench()
    for (const sessionId of [...this.sessions.keys()]) this.disposeSession(sessionId)
  }

  /** Adapter for ExtensionHostBroker.onUiRequest. */
  onUiRequest = async (input: {
    principal: ExtensionPrincipal
    method: string
    params: JsonValue
    signal?: AbortSignal
  }): Promise<JsonValue | undefined> => {
    if (input.method === 'ui.getTheme') return structuredClone(this.workbenchTheme)
    if (input.method === 'ui.getLocale') return structuredClone(this.workbenchLocale)
    if (input.method === 'ui.postMessage') {
      this.publishMessage(input.principal.extensionId, input.params, {
        workspaceRoots: input.principal.workspaceRoots
      })
      return null
    }
    if (input.method === 'ui.showNotification') {
      const value = await this.publishNotification(input.principal, input.params, input.signal)
      return value === undefined ? {} : { value }
    }
    return undefined
  }

  private append(
    session: StoredSession,
    type: ExtensionViewSessionEvent['type'],
    payload: HostMessage | NotificationOptions | JsonValue
  ): void {
    const event: ExtensionViewSessionEvent = {
      sequence: session.nextSequence,
      timestamp: this.now().toISOString(),
      type,
      payload: structuredClone(payload) as JsonValue
    }
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
    if (bytes > MAX_SINGLE_EVENT_BYTES || bytes > this.maxEventBytes) {
      throw new ExtensionViewSessionError('payload_too_large', 'Extension view event is too large')
    }
    session.nextSequence += 1
    session.events.push({ ...event, bytes })
    session.retainedBytes += bytes
    while (session.events.length > this.maxEvents || session.retainedBytes > this.maxEventBytes) {
      const removed = session.events.shift()
      if (!removed) break
      session.retainedBytes -= removed.bytes
    }
    for (const listener of session.listeners) {
      try {
        listener(structuredClone(event))
      } catch {
        // A failed guest listener cannot affect another session or the host.
      }
    }
  }

  private requireLive(sessionId: string): StoredSession {
    this.pruneExpired()
    const session = this.sessions.get(sessionId)
    if (!session || session.disposed) {
      throw new ExtensionViewSessionError('not_found', 'Extension view session was not found')
    }
    return session
  }

  private pruneExpired(): void {
    const now = this.now().getTime()
    for (const [sessionId, session] of this.sessions) {
      if (Date.parse(session.projection.expiresAt) <= now) this.disposeSession(sessionId)
    }
  }

  private pruneExpiredNotifications(): void {
    const now = this.now().getTime()
    for (const [notificationId, pending] of this.notifications) {
      if (Date.parse(pending.projection.expiresAt) <= now) {
        this.settleNotification(notificationId, undefined)
      }
    }
  }

  private hasLiveWorkbenchLease(): boolean {
    if (this.workbenchLeaseExpiresAt > this.now().getTime()) return true
    this.disconnectWorkbench()
    return false
  }

  private expireWorkbenchLease(): void {
    const remainingMs = this.workbenchLeaseExpiresAt - this.now().getTime()
    if (remainingMs > 0) {
      this.workbenchLeaseTimer = setTimeout(() => this.expireWorkbenchLease(), remainingMs)
      this.workbenchLeaseTimer.unref?.()
      return
    }
    this.disconnectWorkbench()
  }

  private settleNotification(notificationId: string, actionId: string | undefined): boolean {
    const pending = this.notifications.get(notificationId)
    if (!pending) return false
    this.notifications.delete(notificationId)
    clearTimeout(pending.timer)
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener)
    }
    pending.resolve(actionId)
    return true
  }

  private emitLifecycle(
    state: ExtensionViewSessionLifecycleEvent['state'],
    projection: ExtensionViewSessionProjection
  ): void {
    const event: ExtensionViewSessionLifecycleEvent = {
      state,
      session: structuredClone(projection)
    }
    for (const listener of this.lifecycleListeners) {
      try {
        listener(structuredClone(event))
      } catch {
        // Lifecycle observation must never affect View ownership or cleanup.
      }
    }
  }
}

function viewSessionMatchesWorkspace(
  target: ExtensionViewSessionTarget,
  workspaceRoots: readonly string[]
): boolean {
  const normalizedRoots = new Set(workspaceRoots.map((root) => resolve(root)))
  if (target.workspaceRoot === undefined) return normalizedRoots.size === 0
  return normalizedRoots.has(resolve(target.workspaceRoot))
}

function viewSessionMatchesWorkspaceKey(
  target: ExtensionViewSessionTarget,
  workspaceKey: string
): boolean {
  if (target.workspaceRoot === undefined) return false
  try {
    return extensionWorkspaceKey(target.workspaceRoot) === workspaceKey
  } catch {
    // A malformed legacy target must fail closed without blocking peers.
    return false
  }
}

function digestNonce(nonce: string): Buffer {
  return createHash('sha256').update(nonce).digest()
}

function extensionPartition(extensionId: string): string {
  const digest = createHash('sha256').update(extensionId).digest('hex').slice(0, 24)
  // No `persist:` prefix: Webview browser storage is non-persistent by default.
  return `kun-extension-${digest}`
}

function extensionResourceUrl(extensionId: string, entry: string): string {
  return `kun-extension://${extensionId}/${entry.split('/').map(encodeURIComponent).join('/')}`
}

function cloneTarget(target: ExtensionViewSessionTarget): ExtensionViewSessionTarget {
  return {
    ...structuredClone(target),
    grantedPermissions: [...target.grantedPermissions]
  }
}

function stripStoredEvent(event: StoredEvent): ExtensionViewSessionEvent {
  const { bytes: _bytes, ...projection } = event
  return structuredClone(projection)
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined) return fallback
  return Math.max(minimum, Math.floor(value))
}

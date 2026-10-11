import {
  dialog,
  webContents
} from 'electron'
import {
  join
} from 'node:path'
import type {
  ExtensionNotificationSnapshot
} from '../../shared/extension-ipc'
import {
  EXTENSION_ID_PATTERN
} from '../../shared/extension-ipc'
import {
  extensionNotificationSnapshotResponseSchema
} from './app-ipc-schemas/extensions'
import {
  NativeDialogCoordinator
} from '../native-dialog-coordinator'
import type { RegisterExtensionIpcHandlersOptions } from './extension-ipc-handler-options'
import { isRecord, safeJsonParse } from './extension-ipc-common'

const EXTENSION_PUMP_MAX_BACKOFF_MS = 30_000
const EXTENSION_PUMP_LOG_REMINDER_MS = 30_000
/** Empty polls kept at the base cadence before the idle stretch starts. */
const EXTENSION_PUMP_IDLE_GRACE_POLLS = 4
/** Upper bound for the idle cadence; any pending request snaps back to base. */
export const EXTENSION_PUMP_MAX_IDLE_DELAY_MS = 4_000

function createExtensionPumpBackoff(
  intervalMs: number,
  logFailure: (message: string) => void
): {
  delayMs(): number
  fail(error: unknown): void
  reset(): void
  idle(): void
  active(): void
} {
  const baseDelayMs = Math.max(250, intervalMs)
  let consecutiveFailures = 0
  let consecutiveIdlePolls = 0
  let lastFailureMessage = ''
  let lastLoggedAt = 0
  return {
    delayMs: () => {
      if (consecutiveFailures > 0) {
        return Math.min(
          EXTENSION_PUMP_MAX_BACKOFF_MS,
          baseDelayMs * (2 ** Math.min(consecutiveFailures, 8))
        )
      }
      // Each poll is a Runtime round trip; an empty queue for several polls
      // in a row stretches the cadence so an idle desktop stops polling twice a
      // second, while a live request immediately returns to the base cadence.
      const stretch = Math.max(0, consecutiveIdlePolls - EXTENSION_PUMP_IDLE_GRACE_POLLS)
      if (stretch === 0) return baseDelayMs
      return Math.max(baseDelayMs, Math.min(
        EXTENSION_PUMP_MAX_IDLE_DELAY_MS,
        baseDelayMs * (2 ** Math.min(stretch, 8))
      ))
    },
    idle: () => { consecutiveIdlePolls += 1 },
    active: () => { consecutiveIdlePolls = 0 },
    fail: (error) => {
      consecutiveFailures += 1
      const message = error instanceof Error ? error.message : String(error)
      const now = Date.now()
      if (
        message !== lastFailureMessage ||
        lastLoggedAt === 0 ||
        now - lastLoggedAt >= EXTENSION_PUMP_LOG_REMINDER_MS
      ) {
        logFailure(message)
        lastFailureMessage = message
        lastLoggedAt = now
      }
    },
    reset: () => {
      consecutiveFailures = 0
      lastFailureMessage = ''
      lastLoggedAt = 0
    }
  }
}

export function startExtensionSecretRevealConsentPump(
  options: RegisterExtensionIpcHandlersOptions,
  intervalMs = 750
): () => void {
  let disposed = false
  let polling = false
  let timer: NodeJS.Timeout | undefined
  const handled = new Set<string>()
  const pendingDecisions = new Map<string, 'allow' | 'deny'>()
  const nativeDialogs = options.nativeDialogs ?? new NativeDialogCoordinator()
  const backoff = createExtensionPumpBackoff(intervalMs, (message) => {
    options.logError?.('extension-account', 'Secret reveal consent pump failed.', { message })
  })

  const schedule = (): void => {
    if (disposed) return
    timer = setTimeout(() => void poll(), backoff.delayMs())
    timer.unref?.()
  }
  const poll = async (): Promise<void> => {
    if (disposed || polling) return
    polling = true
    try {
      const parent = options.getMainWindow()
      if (!parent || parent.isDestroyed()) return
      const result = await options.runtimeRequest('/v1/extensions/secret-reveal-requests', 'GET')
      if (!result.ok) {
        backoff.fail(new Error(`runtime request failed with HTTP ${result.status}`))
        return
      }
      backoff.reset()
      const payload = safeJsonParse(result.body)
      if (!isRecord(payload) || !Array.isArray(payload.requests)) return
      const request = payload.requests.find((candidate) => {
        if (!isRecord(candidate)) return false
        return typeof candidate.id === 'string' && !handled.has(candidate.id)
      })
      if (!isRecord(request)) {
        backoff.idle()
        return
      }
      backoff.active()
      const requestId = typeof request.id === 'string' ? request.id : ''
      const extensionId = typeof request.extensionId === 'string' ? request.extensionId : ''
      const extensionVersion = typeof request.extensionVersion === 'string'
        ? request.extensionVersion
        : ''
      const accountId = typeof request.accountId === 'string' ? request.accountId : ''
      const operation = typeof request.operation === 'string' ? request.operation : ''
      if (
        !/^secret_reveal_[0-9a-f-]{36}$/i.test(requestId) ||
        !EXTENSION_ID_PATTERN.test(extensionId) ||
        !extensionVersion ||
        !accountId ||
        !operation
      ) return
      let decision = pendingDecisions.get(requestId)
      if (!decision) {
        const confirmation = await nativeDialogs.run(parent.webContents, async () => {
          if (parent.isDestroyed()) {
            throw new Error('Secret reveal confirmation window is unavailable.')
          }
          return dialog.showMessageBox(parent, {
            type: 'warning',
            title: 'Reveal provider secret to extension',
            message: `${extensionId} ${extensionVersion} requests raw credential access.`,
            detail: [
              `Account: ${accountId.slice(0, 256)}`,
              `Operation: ${operation.slice(0, 256)}`,
              'The secret will be returned only to this extension\'s Node host for this single request. Webviews and content scripts cannot access it.'
            ].join('\n\n'),
            buttons: ['Deny', 'Allow once'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
            normalizeAccessKeys: true
          })
        })
        decision = confirmation.response === 1 ? 'allow' : 'deny'
        pendingDecisions.set(requestId, decision)
      }
      const decisionResult = await options.runtimeRequest(
        `/v1/extensions/secret-reveal-requests/${encodeURIComponent(requestId)}/decision`,
        'POST',
        JSON.stringify({ decision })
      )
      if (decisionResult.ok || decisionResult.status === 404) {
        pendingDecisions.delete(requestId)
        handled.add(requestId)
      }
    } catch (error) {
      backoff.fail(error)
    } finally {
      polling = false
      schedule()
    }
  }
  void poll()
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
  }
}

/**
 * Polls the runtime-owned pending notification table and projects a validated
 * snapshot into the trusted workbench. Re-sending snapshots is intentional:
 * renderer reloads cannot strand a pending extension request.
 */
export function startExtensionNotificationPump(
  options: RegisterExtensionIpcHandlersOptions,
  intervalMs = 500
): () => void {
  let disposed = false
  let polling = false
  let timer: NodeJS.Timeout | undefined
  let hadNotifications = false
  const backoff = createExtensionPumpBackoff(intervalMs, (message) => {
    options.logError?.('extension-notification', 'Extension notification pump failed.', { message })
  })
  const schedule = (): void => {
    if (disposed) return
    timer = setTimeout(() => void poll(), backoff.delayMs())
    timer.unref?.()
  }
  const poll = async (): Promise<void> => {
    if (disposed || polling) return
    polling = true
    try {
      const parent = options.getMainWindow()
      if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed()) return
      const result = await options.runtimeRequest(
        '/v1/extensions/workbench/notifications',
        'GET'
      )
      if (!result.ok) {
        backoff.fail(new Error(`runtime request failed with HTTP ${result.status}`))
        return
      }
      backoff.reset()
      const parsed = extensionNotificationSnapshotResponseSchema.safeParse(safeJsonParse(result.body))
      if (!parsed.success) {
        options.logError?.('extension-notification', 'Kun returned an invalid notification snapshot.', {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        })
        return
      }
      const payload: ExtensionNotificationSnapshot = {
        notifications: parsed.data.notifications
      }
      if (payload.notifications.length === 0) backoff.idle()
      else backoff.active()
      if (payload.notifications.length === 0 && !hadNotifications) return
      hadNotifications = payload.notifications.length > 0
      parent.webContents.send('extension:notifications', payload)
    } catch (error) {
      backoff.fail(error)
    } finally {
      polling = false
      schedule()
    }
  }
  void poll()
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    void options.runtimeRequest(
      '/v1/extensions/workbench/presence',
      'DELETE'
    ).catch(() => undefined)
  }
}

import type { ManagerOwnershipLostReason } from './runtime-manager-heartbeat.js'
import { settleCleanupBeforeDeadline } from '../server/runtime-factory-cleanup.js'
import { redactSecretText } from '../config/secret-redaction.js'

export type ServeShutdownReason = ManagerOwnershipLostReason
  | { code: 'process_signal'; signal: 'SIGTERM' | 'SIGINT' }
  | { code: 'runtime_shutdown_requested' }
  | { code: 'client_owner_disconnected' | 'client_owner_stop_requested' }

/** Record the first shutdown cause before cleanup can stall or reject. */
export function createServeShutdownHandler(input: {
  identity: { flavor: string; instanceId: string; pid: number }
  close(): Promise<void>
  timeoutMs: number
  log(line: string): void
}): { request(reason: ServeShutdownReason): void; completed: Promise<void> } {
  let stopping = false
  let finish!: () => void
  const completed = new Promise<void>((resolve) => { finish = resolve })
  return {
    completed,
    request(reason) {
      if (stopping) return
      stopping = true
      const detail = JSON.stringify({ ...input.identity, ...reason })
      input.log(`kun serve: shutdown requested ${detail}`)
      void settleCleanupBeforeDeadline(input.close, input.timeoutMs).then((closed) => {
        input.log(closed
          ? `kun serve: shutdown completed ${detail}`
          : `kun serve: graceful shutdown exceeded ${input.timeoutMs}ms; forcing process exit ${detail}`)
      }).catch((error: unknown) => {
        const message = redactSecretText(error instanceof Error ? error.message : String(error)).slice(0, 1_024)
        input.log(`kun serve: shutdown cleanup failed ${detail} ${JSON.stringify({ message })}`)
      }).finally(finish)
    }
  }
}

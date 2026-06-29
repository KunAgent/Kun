import process from 'node:process'
import { ServeExitCode } from './serve.js'
import type { KunServeHandle } from '../server/runtime-factory.js'

/**
 * Serve mode runs unattended under the GUI. The two failure modes are
 * deliberately handled differently:
 *
 * - `uncaughtException` left the stack unwound mid-operation, so the process
 *   state is genuinely unsafe. Report it on stderr (the GUI captures the tail),
 *   attempt a bounded graceful close, then exit non-zero so the GUI supervisor
 *   can restart a fresh process.
 * - `unhandledRejection` does NOT corrupt the process — Node keeps running. A
 *   stray background rejection (e.g. a streamable-http MCP server dropping its
 *   connection while a reconnect promise is in flight) is fully recoverable, so
 *   tearing the whole runtime down and blanking the GUI for it is the wrong
 *   trade (#639). Log it for the stderr tail and stay up; the MCP layer already
 *   reports the server unavailable and reconnects on the next request.
 */
export function installServeCrashHandlers(getHandle: () => KunServeHandle | null): void {
  let crashing = false
  const crash = (kind: string, error: unknown): void => {
    if (crashing) return
    crashing = true
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`kun serve: ${kind}: ${detail}\n`)
    const finish = (): void => process.exit(ServeExitCode.runtime)
    const handle = getHandle()
    if (!handle) {
      finish()
      return
    }
    const deadline = setTimeout(finish, 3000)
    deadline.unref()
    void handle
      .close()
      .catch(() => undefined)
      .finally(finish)
  }
  process.on('uncaughtException', (error) => crash('uncaughtException', error))
  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    process.stderr.write(`kun serve: unhandledRejection (non-fatal, runtime stays up): ${detail}\n`)
  })
}

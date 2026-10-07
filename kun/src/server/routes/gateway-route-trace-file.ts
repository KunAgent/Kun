import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { GatewayRouteTrace } from '../../contracts/gateway-route-trace.js'

const SAVE_DELAY_MS = 1_000

/**
 * Finished route traces kept on disk so the Gateway page still shows recent
 * requests after a restart. A trace holds model ids, agent and key names and
 * timings; prompts never enter it. Writes are debounced and atomic.
 */
export class GatewayRouteTraceFile {
  private timer?: ReturnType<typeof setTimeout>
  private latest?: GatewayRouteTrace[]
  private writing: Promise<void> = Promise.resolve()

  constructor(readonly path: string, private readonly limit: number) {}

  /** Finished traces from the last run, oldest first; empty when the file is missing or unreadable. */
  load(): GatewayRouteTrace[] {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as { traces?: unknown }
      const traces = Array.isArray(value.traces) ? value.traces.filter(isFinishedTrace) : []
      return traces.sort((a, b) => a.seq - b.seq).slice(-this.limit)
    } catch {
      return []
    }
  }

  save(traces: GatewayRouteTrace[]): void {
    this.latest = traces
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, SAVE_DELAY_MS)
    this.timer.unref?.()
  }

  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    const traces = this.latest
    this.latest = undefined
    if (!traces) return this.writing
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temp = `${this.path}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify({ schemaVersion: 1, traces }) + '\n', { mode: 0o600 })
      await rename(temp, this.path)
    }).catch((error) => { console.warn('[kun] gateway route traces could not be saved:', error) })
    return this.writing
  }
}

function isFinishedTrace(value: unknown): value is GatewayRouteTrace {
  if (!value || typeof value !== 'object') return false
  const trace = value as Partial<GatewayRouteTrace>
  return trace.done === true && typeof trace.seq === 'number' && Number.isSafeInteger(trace.seq) && trace.seq > 0 &&
    typeof trace.requestId === 'string' && typeof trace.asked === 'string' && typeof trace.startedAt === 'string' && Array.isArray(trace.tries)
}

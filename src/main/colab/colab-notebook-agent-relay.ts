import { randomUUID } from 'node:crypto'
import type {
  ColabNotebookAgentRequest,
  ColabNotebookAgentResponse,
  ColabNotebookAgentResult
} from '../../shared/colab/colab-notebook-types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type ColabNotebookAgentRequestInput = DistributiveOmit<ColabNotebookAgentRequest, 'requestId'>

export type ColabNotebookAgentPoll =
  | { status: 'running'; requestId: string }
  | { status: 'done'; requestId: string; result: ColabNotebookAgentResult }

type PendingRequest = {
  acked: boolean
  result: ColabNotebookAgentResult | null
  waiters: Set<() => void>
  ackTimer: ReturnType<typeof setTimeout> | null
  expireTimer: ReturnType<typeof setTimeout>
}

const ACK_TIMEOUT_MS = 6_000
const RESULT_RETENTION_MS = 6 * 60 * 60 * 1000

/**
 * Relays Kun notebook tool calls to the renderer, which owns the open notebook,
 * its cell outputs and the active kernel session. Long cell runs are exposed as
 * long-polls so a single bridge HTTP request never outlives its timeout.
 */
export class ColabNotebookAgentRelay {
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly sendToRenderer: (request: ColabNotebookAgentRequest) => boolean) {}

  start(input: ColabNotebookAgentRequestInput): string {
    const requestId = `nbreq-${randomUUID()}`
    const entry: PendingRequest = {
      acked: false,
      result: null,
      waiters: new Set(),
      ackTimer: null,
      expireTimer: setTimeout(() => this.pending.delete(requestId), RESULT_RETENTION_MS)
    }
    entry.expireTimer.unref?.()
    this.pending.set(requestId, entry)
    const delivered = this.sendToRenderer({ ...input, requestId } as ColabNotebookAgentRequest)
    if (!delivered) {
      this.settle(requestId, { ok: false, message: 'Kun window is not available.' })
      return requestId
    }
    entry.ackTimer = setTimeout(() => {
      if (!entry.acked) {
        this.settle(requestId, {
          ok: false,
          message: 'The Colab notebook page is not open. Ask the user to open Colab in Kun and select the notebook.'
        })
      }
    }, ACK_TIMEOUT_MS)
    entry.ackTimer.unref?.()
    return requestId
  }

  respond(response: ColabNotebookAgentResponse): void {
    const entry = this.pending.get(response.requestId)
    if (!entry) return
    if ('ack' in response) {
      entry.acked = true
      if (entry.ackTimer) clearTimeout(entry.ackTimer)
      entry.ackTimer = null
      return
    }
    entry.acked = true
    this.settle(response.requestId, response.result)
  }

  async wait(requestId: string, timeoutMs: number): Promise<ColabNotebookAgentPoll | null> {
    const entry = this.pending.get(requestId)
    if (!entry) return null
    if (!entry.result) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, timeoutMs)
        function done(): void {
          clearTimeout(timer)
          entry?.waiters.delete(done)
          resolve()
        }
        entry.waiters.add(done)
      })
    }
    if (!entry.result) return { status: 'running', requestId }
    // A delivered result is not needed again; keep memory bounded.
    clearTimeout(entry.expireTimer)
    this.pending.delete(requestId)
    return { status: 'done', requestId, result: entry.result }
  }

  private settle(requestId: string, result: ColabNotebookAgentResult): void {
    const entry = this.pending.get(requestId)
    if (!entry || entry.result) return
    if (entry.ackTimer) clearTimeout(entry.ackTimer)
    entry.ackTimer = null
    entry.result = result
    for (const waiter of [...entry.waiters]) waiter()
  }

  shutdown(): void {
    for (const [requestId] of this.pending) {
      this.settle(requestId, { ok: false, message: 'Kun is shutting down.' })
    }
    for (const entry of this.pending.values()) clearTimeout(entry.expireTimer)
    this.pending.clear()
  }
}

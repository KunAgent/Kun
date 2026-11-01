import { createHash } from 'node:crypto'
import {
  MANAGER_MUTATION_REPLAY_MAX_WINDOW_MS,
  type ManagerMutationReplay
} from '../contracts/manager-request-replay.js'
import { jsonResponse, type JsonResponse } from '../server/response.js'

type Entry = {
  fingerprint: string
  expiresAt: number
  pending?: Promise<JsonResponse>
  response?: JsonResponse
  bytes: number
}

/** Same-generation RPC deduplication; never evict an unexpired request to admit another. */
export class ManagerMutationReplayCache {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  private nextPruneAt = 0

  constructor(
    private readonly instanceId: string,
    private readonly limits = { entries: 32_768, bytes: 16 * 1024 * 1024 },
    private readonly now: () => number = Date.now
  ) {}

  execute(
    replay: ManagerMutationReplay | undefined,
    payload: unknown,
    run: () => Promise<JsonResponse>
  ): Promise<JsonResponse> {
    if (!replay) return run()
    const now = this.now()
    if (replay.managerInstanceId !== this.instanceId) {
      return Promise.resolve(failure('manager_generation_changed', 409))
    }
    if (replay.expiresAt <= now || replay.expiresAt - now > MANAGER_MUTATION_REPLAY_MAX_WINDOW_MS) {
      return Promise.resolve(failure('mutation_replay_expired', 409))
    }
    this.prune(now)
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const existing = this.entries.get(replay.requestId)
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.expiresAt !== replay.expiresAt) {
        return Promise.resolve(failure('mutation_replay_conflict', 409))
      }
      return existing.pending ?? Promise.resolve(existing.response ?? failure('mutation_result_unavailable', 503))
    }
    if (this.entries.size >= this.limits.entries || this.bytes >= this.limits.bytes) {
      return Promise.resolve(failure('mutation_replay_capacity', 503))
    }
    const entry: Entry = { fingerprint, expiresAt: replay.expiresAt, bytes: 0 }
    this.entries.set(replay.requestId, entry)
    entry.pending = Promise.resolve().then(run).then((response) => {
      const bytes = Buffer.byteLength(response.body)
      // Retain a tombstone if the result is too large. A retry may fail, but
      // must never repeat a mutation whose acknowledgement was lost.
      if (this.bytes + bytes <= this.limits.bytes) {
        entry.response = response
        entry.bytes = bytes
        this.bytes += bytes
      }
      return response
    }).catch((error: unknown) => {
      // Even an unsuccessful operation may have partially committed.
      entry.response = failure('mutation_result_unavailable', 503)
      throw error
    }).finally(() => { entry.pending = undefined })
    return entry.pending
  }

  private prune(now: number): void {
    // Streaming turns issue many small RPCs. Scanning the whole retry window
    // for every token would itself monopolize the Manager control loop.
    if (now < this.nextPruneAt) return
    this.nextPruneAt = now + 1_000
    for (const [key, entry] of this.entries) {
      if (entry.pending || entry.expiresAt > now) continue
      this.entries.delete(key)
      this.bytes -= entry.bytes
    }
  }
}

function failure(code: string, status: number): JsonResponse {
  return jsonResponse({ code, message: 'Manager mutation acknowledgement is unavailable; mutation was not replayed.' }, status)
}

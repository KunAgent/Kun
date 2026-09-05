import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readPersistedManagerState,
  writePersistedManagerState
} from '../manager/service-manager-state-persistence.js'
import { ManagerStateWriteQueue } from '../manager/service-manager-state-write-queue.js'
import type { ServiceManagerState } from '../manager/service-manager-state.js'

export type ManagerLeaseRenewalBenchmarkResult = {
  activeTurns: number
  renewals: number
  /** Mean renewal handler latency including persistence wait, in ms. */
  renewMeanMs: number
  renewP50Ms: number
  renewP95Ms: number
  renewMaxMs: number
  /** Durable snapshot writes performed during the renewal phase. */
  durableWrites: number
  durableWriteMeanMs: number
  durableWriteP95Ms: number
  durableWriteMaxMs: number
  /** Total bytes written across durable snapshot writes. */
  durableWriteBytes: number
}

const DEFAULT_TURN_COUNTS = [1, 32, 64, 128, 256]
const RENEWAL_ROUNDS = 5

/**
 * Measures the lease-renewal durability path with the same coalescing policy
 * used by startServiceManager: every mutation enqueues the latest snapshot,
 * an in-flight durable write coalesces later mutations into one trailing
 * write, and renewal responses only wait for the trailing edge of the TTL
 * safe window. Run via the CLI entry; not part of unit tests.
 */
export async function runManagerLeaseRenewalBenchmark(
  turnCounts?: readonly number[]
): Promise<ManagerLeaseRenewalBenchmarkResult[]> {
  const counts = turnCounts && turnCounts.length > 0 ? [...turnCounts] : DEFAULT_TURN_COUNTS
  const results: ManagerLeaseRenewalBenchmarkResult[] = []
  for (const activeTurns of counts) {
    results.push(await benchmarkTurnCount(activeTurns))
  }
  return results
}

async function benchmarkTurnCount(activeTurns: number): Promise<ManagerLeaseRenewalBenchmarkResult> {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-lease-renewal-bench-'))
  try {
    const statePath = join(root, 'manager-state.json')
    const state = await readPersistedManagerState(statePath)
    // Runtime slots are one-per-flavor; a single runtime owns all active turns.
    state.register(registration('runtime-0'))
    const writeDurations: number[] = []
    let durableWriteBytes = 0
    const queue = new ManagerStateWriteQueue(statePath, {
      writer: async (path, snapshot) => {
        const startedAt = performance.now()
        durableWriteBytes += JSON.stringify(snapshot).length
        await writePersistedManagerState(path, snapshot)
        writeDurations.push(performance.now() - startedAt)
      }
    })
    state.onMutation(() => {
      queue.enqueue(state.durableSnapshot())
    })

    const leases = []
    for (let index = 0; index < activeTurns; index += 1) {
      leases.push(state.acquireLease({
        threadId: `thread-${index}`,
        turnId: `turn-${index}`,
        ownerFlavor: 'production',
        ownerInstanceId: 'runtime-0'
      }))
    }
    await queue.flush()
    const renewalLatencies: number[] = []
    let renewals = 0
    const writesBeforeRenewals = writeDurations.length
    const bytesBeforeRenewals = durableWriteBytes
    for (let round = 0; round < RENEWAL_ROUNDS; round += 1) {
      const startedAt = performance.now()
      for (const lease of leases) {
        renewLeaseOnce(state, lease)
        // Renewals never await the snapshot chain inside the safe TTL window;
        // the write cost is reported separately via durableWrite* metrics.
      }
      renewalLatencies.push((performance.now() - startedAt) / activeTurns)
      renewals += activeTurns
    }
    await queue.flush()
    const renewalWriteDurations = writeDurations.slice(writesBeforeRenewals)
    return {
      activeTurns,
      renewals,
      renewMeanMs: mean(renewalLatencies),
      renewP50Ms: percentile(renewalLatencies, 0.5),
      renewP95Ms: percentile(renewalLatencies, 0.95),
      renewMaxMs: Math.max(...renewalLatencies),
      durableWrites: renewalWriteDurations.length,
      durableWriteMeanMs: mean(renewalWriteDurations),
      durableWriteP95Ms: percentile(renewalWriteDurations, 0.95),
      durableWriteMaxMs: renewalWriteDurations.length > 0 ? Math.max(...renewalWriteDurations) : 0,
      durableWriteBytes: durableWriteBytes - bytesBeforeRenewals
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function registration(instanceId: string) {
  return {
    flavor: 'production' as const,
    instanceId,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: '127.0.0.1',
    port: 1,
    baseUrl: 'http://127.0.0.1:1',
    runtimeToken: 'token'
  }
}

function renewLeaseOnce(
  state: ServiceManagerState,
  lease: {
    threadId: string
    turnId: string
    ownerFlavor: 'production' | 'development'
    ownerInstanceId: string
    fencingToken: number
  }
): void {
  const renewed = state.renewLease(lease)
  if (!renewed) throw new Error(`benchmark lease renewal lost for ${lease.threadId}`)
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))]!
}

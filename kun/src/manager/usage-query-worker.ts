import { parentPort, workerData } from 'node:worker_threads'
import type { SessionUsageAggregateResponse } from '../contracts/usage-query.js'
import {
  runUsageAggregateQuery,
  type UsageQueryWorkerInput
} from './usage-query-runner.js'

type WorkerOutput =
  | { ok: true; result: SessionUsageAggregateResponse }
  | { ok: false; error: string }

try {
  const result = runUsageAggregateQuery(workerData as UsageQueryWorkerInput)
  parentPort?.postMessage({ ok: true, result } satisfies WorkerOutput)
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  } satisfies WorkerOutput)
}

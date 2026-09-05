#!/usr/bin/env node
import { runManagerLeaseRenewalBenchmark } from '../benchmark/manager-lease-renewal.js'

const counts = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((value) => Number.parseInt(value, 10)).filter((value) => value > 0)
  : undefined
const results = await runManagerLeaseRenewalBenchmark(counts)
for (const result of results) {
  process.stdout.write(`${JSON.stringify({
    ...result,
    renewMeanMs: round(result.renewMeanMs),
    renewP50Ms: round(result.renewP50Ms),
    renewP95Ms: round(result.renewP95Ms),
    renewMaxMs: round(result.renewMaxMs),
    durableWriteMeanMs: round(result.durableWriteMeanMs),
    durableWriteP95Ms: round(result.durableWriteP95Ms),
    durableWriteMaxMs: round(result.durableWriteMaxMs)
  })}\n`)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

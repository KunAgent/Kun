#!/usr/bin/env node
import { runItemIndexPaginationBenchmark } from '../benchmark/item-index-pagination.js'

const counts = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((value) => Number.parseInt(value, 10)).filter((value) => value > 0)
  : undefined
const results = await runItemIndexPaginationBenchmark(counts)
for (const result of results) {
  process.stdout.write(`${JSON.stringify({
    ...result,
    coldMs: round(result.coldMs),
    hotTotalMs: round(result.hotTotalMs),
    hotP50Ms: round(result.hotP50Ms),
    hotP95Ms: round(result.hotP95Ms),
    appendMs: round(result.appendMs),
    postAppendPageMs: round(result.postAppendPageMs),
    rebuildMs: round(result.rebuildMs),
    postReplacementPageMs: round(result.postReplacementPageMs)
  })}\n`)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  compareReplayReports,
  evaluateReplayBudget,
  formatReplayReportMarkdown,
  runReplaySuite,
  type ReplayReport
} from '../benchmark/replay-benchmark.js'
import { DEFAULT_SERVE_PORT } from './cli-options.js'

const DEFAULT_RUNTIME_URL = `http://127.0.0.1:${DEFAULT_SERVE_PORT}`

type CliOptions = {
  suitePath?: string
  baseUrl: string
  workspace: string
  outputPath?: string
  summaryPath?: string
  baselinePath?: string
  budgetPath?: string
  repeat: number
  concurrency: number
  tag?: string
  keepThreads: boolean
  failOnRegression: boolean
  failOnBudget: boolean
  help: boolean
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  printUsage()
  process.exit(0)
}
if (!options.suitePath) {
  printUsage()
  process.exit(2)
}

const suitePath = resolve(options.suitePath)
const suite = JSON.parse(await readFile(suitePath, 'utf8')) as unknown
const report = await runReplaySuite(suite, {
  baseUrl: options.baseUrl,
  token: process.env.KUN_RUNTIME_TOKEN,
  workspace: options.workspace,
  repeat: options.repeat,
  concurrency: options.concurrency,
  ...(options.tag ? { tag: options.tag } : {}),
  keepThreads: options.keepThreads,
  onProgress: (completed, total, run) => {
    const ttft = run.metrics.ttftMs === null ? 'n/a' : `${Math.round(run.metrics.ttftMs)}ms`
    console.error(
      `[${completed}/${total}] ${run.id} ${run.status} ` +
      `ttft=${ttft} total=${Math.round(run.metrics.totalMs)}ms tokens=${run.metrics.totalTokens}`
    )
  }
})

if (options.baselinePath) {
  const baseline = JSON.parse(await readFile(resolve(options.baselinePath), 'utf8')) as ReplayReport
  report.comparison = compareReplayReports(report, baseline)
}
if (options.budgetPath) {
  const budget = JSON.parse(await readFile(resolve(options.budgetPath), 'utf8')) as unknown
  report.budget = evaluateReplayBudget(report, budget)
}

printSummary(report)
if (options.outputPath) {
  const outputPath = resolve(options.outputPath)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.error(`Replay report written to ${outputPath}`)
} else {
  console.log(JSON.stringify(report, null, 2))
}
if (options.summaryPath) {
  const summaryPath = resolve(options.summaryPath)
  await mkdir(dirname(summaryPath), { recursive: true })
  await writeFile(summaryPath, formatReplayReportMarkdown(report), 'utf8')
  console.error(`Replay summary written to ${summaryPath}`)
}

if (options.failOnRegression && report.comparison?.regressions.length) {
  process.exitCode = 1
}
if (options.failOnBudget && report.budget && !report.budget.passed) {
  process.exitCode = 1
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: process.env.KUN_RUNTIME_URL ?? DEFAULT_RUNTIME_URL,
    workspace: resolve(process.env.INIT_CWD ?? process.cwd()),
    repeat: 1,
    concurrency: 1,
    keepThreads: false,
    failOnRegression: false,
    failOnBudget: false,
    help: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--suite':
        options.suitePath = requiredValue(args, ++index, arg)
        break
      case '--base-url':
        options.baseUrl = requiredValue(args, ++index, arg)
        break
      case '--workspace':
        options.workspace = resolve(requiredValue(args, ++index, arg))
        break
      case '--output':
        options.outputPath = requiredValue(args, ++index, arg)
        break
      case '--summary-output':
        options.summaryPath = requiredValue(args, ++index, arg)
        break
      case '--baseline':
        options.baselinePath = requiredValue(args, ++index, arg)
        break
      case '--budget':
        options.budgetPath = requiredValue(args, ++index, arg)
        break
      case '--tag':
        options.tag = requiredValue(args, ++index, arg)
        break
      case '--repeat':
        options.repeat = positiveInteger(requiredValue(args, ++index, arg), arg)
        break
      case '--concurrency':
        options.concurrency = positiveInteger(requiredValue(args, ++index, arg), arg)
        break
      case '--keep-threads':
        options.keepThreads = true
        break
      case '--fail-on-regression':
        options.failOnRegression = true
        break
      case '--fail-on-budget':
        options.failOnBudget = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`unknown replay option: ${arg}`)
    }
  }
  return options
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function printUsage(): void {
  console.log('Usage:')
  console.log('  npm --prefix kun run benchmark:replay -- --suite <file> [options]')
  console.log('')
  console.log('Options:')
  console.log(`  --base-url <url>          Kun runtime URL (or KUN_RUNTIME_URL, default ${DEFAULT_RUNTIME_URL})`)
  console.log('  --workspace <path>        Workspace for replay tasks')
  console.log('  --tag <tag>               Run only tasks with this tag')
  console.log('  --repeat <n>              Repeat each selected task (default 1)')
  console.log('  --concurrency <n>         Parallel tasks, capped at 8 (default 1)')
  console.log('  --baseline <report.json>  Compare against an earlier report')
  console.log('  --budget <budget.json>    Evaluate explicit CI budget thresholds')
  console.log('  --output <report.json>    Write the full machine-readable report')
  console.log('  --summary-output <file>   Write a Markdown summary report')
  console.log('  --keep-threads            Keep generated replay threads')
  console.log('  --fail-on-regression      Exit 1 when comparison thresholds regress')
  console.log('  --fail-on-budget          Exit 1 when explicit budget thresholds fail')
  console.log('')
  console.log('Authentication: set KUN_RUNTIME_TOKEN; it is intentionally not accepted as a CLI flag.')
}

function printSummary(report: ReplayReport): void {
  const summary = report.summary
  console.error('')
  console.error(`Replay suite: ${report.suite.name}`)
  console.error(`Success: ${summary.passed}/${summary.runCount} (${formatRate(summary.successRate)})`)
  console.error(`TTFT p50/p95: ${formatMs(summary.ttftP50Ms)} / ${formatMs(summary.ttftP95Ms)}`)
  console.error(`Total p50/p95: ${formatMs(summary.totalP50Ms)} / ${formatMs(summary.totalP95Ms)}`)
  console.error(`SSE delay p95: ${formatMs(summary.sseDelayP95Ms)}`)
  console.error(`Tokens: ${summary.promptTokens} input + ${summary.completionTokens} output`)
  console.error(`Cache hit: ${formatRate(summary.cacheHitRate)}`)
  console.error(`Cost: $${summary.costUsd.toFixed(6)}`)
  console.error(`Peak RSS: ${summary.peakRssBytes === null ? 'n/a' : formatBytes(summary.peakRssBytes)}`)
  if (report.comparison) {
    console.error(`Regressions: ${report.comparison.regressions.length}`)
    for (const regression of report.comparison.regressions) console.error(`  - ${regression}`)
  }
  if (report.budget) {
    console.error(`Budget gate: ${report.budget.passed ? 'passed' : 'failed'}`)
    for (const violation of report.budget.violations) console.error(`  - ${violation.message}`)
  }
}

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value)}ms`
}

function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

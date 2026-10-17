#!/usr/bin/env node
/**
 * Fast Context retrieval benchmark.
 *
 * Compares the legacy single-pass grep (one rg walk, first 30 rows in path
 * order) with the current ranked Fast Context grep on real cases, reporting
 * where the expected file lands in the visible results and how much CPU the
 * search cost. Requires a built runtime: `npm --prefix kun run build`.
 *
 *   node kun/scripts/fast-context-benchmark.mjs [--workspace <dir>] [--cases <file>] [--repeat <n>] [--json]
 *
 * CPU is measured per case by running it in a worker under `/usr/bin/time -p`:
 * Node reaps its rg/git children, so their CPU is folded into the worker's
 * totals. A per-mode baseline (Node start-up, plus warm indexes for the ranked
 * mode) is subtracted. Without `/usr/bin/time` only wall time is reported.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const kunRoot = resolve(here, '..')
const VISIBLE_ROWS = 30
const LEGACY_EXCLUDED = ['.git', '.cache', '.next', '.turbo', '.venv', '.yarn', '__pycache__', 'bower_components', 'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'vendor']

function parseArgs(argv) {
  const options = {
    workspace: resolve(kunRoot, '..'),
    cases: join(kunRoot, 'benchmarks', 'fast-context-retrieval.json'),
    repeat: 1,
    json: false,
    worker: null,
    mode: null,
    caseId: null,
    dataDir: null
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const next = () => argv[++index]
    if (value === '--workspace') options.workspace = resolve(next())
    else if (value === '--cases') options.cases = resolve(next())
    else if (value === '--repeat') options.repeat = Math.max(1, Number(next()) || 1)
    else if (value === '--json') options.json = true
    else if (value === '--worker') options.worker = true
    else if (value === '--mode') options.mode = next()
    else if (value === '--case') options.caseId = next()
    else if (value === '--data-dir') options.dataDir = next()
    else throw new Error(`unknown argument: ${value}`)
  }
  return options
}

function loadCases(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed.cases)) throw new Error(`${path} has no cases`)
  return parsed.cases
}

async function runtime() {
  const dist = (path) => pathToFileURL(join(kunRoot, 'dist', path)).href
  if (!existsSync(join(kunRoot, 'dist', 'adapters', 'tool', 'fast-context-grep.js'))) {
    throw new Error('kun/dist is missing or stale; run `npm --prefix kun run build` first')
  }
  const [search, utils, types, bounds, ranking, fileIndex, symbols] = await Promise.all([
    import(dist('adapters/tool/builtin-search-tools.js')),
    import(dist('adapters/tool/builtin-tool-utils.js')),
    import(dist('adapters/tool/builtin-tool-types.js')),
    import(dist('adapters/tool/fast-context-search-bounds.js')),
    import(dist('adapters/tool/fast-context-ranking.js')),
    import(dist('adapters/tool/fast-context-file-index.js')),
    import(dist('adapters/tool/fast-context-symbol-index.js'))
  ])
  const fastBounds = bounds.fastContextSearchBounds({ fastContext: true })
  const rg = utils.resolveRipgrepExecutable({ candidates: types.RG_EXECUTABLE_CANDIDATES, allowPathFallback: false })
  return { search, utils, ranking, fileIndex, symbols, fastBounds, rg }
}

async function warmIndexes(rt, workspace, dataDir) {
  const started = performance.now()
  const index = await rt.fileIndex.getFastContextFileIndex(workspace, { rg: rt.rg, capture: rt.utils.spawnCapture, bounds: rt.fastBounds })
  await rt.symbols.warmFastContextSymbolIndex(workspace, { rg: rt.rg, capture: rt.utils.spawnCapture, bounds: rt.fastBounds, dataDir })
  const lookup = rt.symbols.peekFastContextSymbolIndex(workspace)
  return { files: index?.files.length ?? 0, definitions: lookup?.size ?? 0, wallMs: performance.now() - started }
}

function rankOf(paths, expect) {
  const index = paths.findIndex((path) => path === expect)
  return index >= 0 && index < VISIBLE_ROWS ? index + 1 : null
}

async function legacyCase(rt, workspace, entry) {
  const args = [
    '--hidden', '--line-number', '--with-filename', '--color', 'never', '--sort', 'path',
    '--max-count', String(VISIBLE_ROWS + 1), '--max-columns', '300',
    ...LEGACY_EXCLUDED.flatMap((name) => ['-g', `!${name}/**`, '-g', `!**/${name}/**`]),
    entry.pattern, workspace
  ]
  const started = performance.now()
  const result = await rt.utils.spawnCapture(rt.rg, args, { cwd: workspace, maxOutputBytes: 512 * 1024, timeoutMs: 8_000 })
  const wallMs = performance.now() - started
  const paths = result.stdout.split('\n').filter(Boolean).slice(0, VISIBLE_ROWS + 1).map((row) => {
    const match = /^(.*?):(\d+):/.exec(row)
    return match ? match[1].replace(`${workspace}/`, '') : ''
  })
  return { rank: rankOf(paths, entry.expect), rows: Math.min(paths.length, VISIBLE_ROWS), wallMs, timedOut: result.timedOut }
}

async function rankedCase(rt, workspace, entry) {
  const tool = rt.search.createGrepLocalTool()
  const context = {
    workspace,
    threadId: 'bench',
    turnId: 'bench',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'deny',
    fastContext: true,
    fastContextRun: {
      hintPaths: entry.hintPaths ?? [],
      queryTerms: rt.ranking.fastContextQueryTerms([entry.task ?? '']),
      timedOutCommands: 0
    }
  }
  const started = performance.now()
  const result = await tool.execute({ pattern: entry.pattern, ...(entry.path ? { path: entry.path } : {}), ...(entry.glob ? { glob: entry.glob } : {}) }, context)
  const wallMs = performance.now() - started
  const output = result.output ?? {}
  const paths = Array.isArray(output.matches) ? output.matches.map((match) => match.relative_path) : []
  return {
    rank: rankOf(paths, entry.expect),
    rows: paths.length,
    wallMs,
    timedOut: output.command_timed_out === true,
    scope: output.scope ?? output.code ?? null,
    candidateFiles: output.candidate_files ?? null
  }
}

async function worker(options) {
  const rt = await runtime()
  if (!rt.rg) throw new Error('packaged ripgrep was not found; install kun dependencies first')
  const cases = loadCases(options.cases)
  let payload = {}
  if (options.mode === 'setup') {
    payload = await warmIndexes(rt, options.workspace, options.dataDir)
  } else if (options.mode === 'warm') {
    await warmIndexes(rt, options.workspace, options.dataDir)
  } else if (options.mode === 'legacy' || options.mode === 'ranked') {
    const entry = cases.find((candidate) => candidate.id === options.caseId)
    if (!entry) throw new Error(`unknown case ${options.caseId}`)
    if (options.mode === 'ranked') await warmIndexes(rt, options.workspace, options.dataDir)
    payload = options.mode === 'legacy' ? await legacyCase(rt, options.workspace, entry) : await rankedCase(rt, options.workspace, entry)
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const timeBinary = process.platform !== 'win32' && existsSync('/usr/bin/time') ? '/usr/bin/time' : null

function spawnWorker(options, mode, caseId) {
  const args = [fileURLToPath(import.meta.url), '--worker', '--mode', mode, '--workspace', options.workspace, '--cases', options.cases, '--data-dir', options.dataDir, ...(caseId ? ['--case', caseId] : [])]
  const command = timeBinary ? [timeBinary, '-p', process.execPath, ...args] : [process.execPath, ...args]
  const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`worker ${mode} ${caseId ?? ''} failed:\n${result.stderr}`)
  const lines = result.stdout.trim().split('\n')
  const payload = JSON.parse(lines[lines.length - 1])
  let cpuMs = null
  if (timeBinary) {
    const user = /^user\s+([\d.]+)/m.exec(result.stderr)
    const sys = /^sys\s+([\d.]+)/m.exec(result.stderr)
    if (user && sys) cpuMs = (Number(user[1]) + Number(sys[1])) * 1000
  }
  return { payload, cpuMs }
}

function median(values) {
  const sorted = values.filter((value) => typeof value === 'number').sort((left, right) => left - right)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
}

function baseline(options, mode) {
  return median(Array.from({ length: 3 }, () => spawnWorker(options, mode, null).cpuMs))
}

function format(value, digits = 0) {
  return value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.worker) return worker(options)
  const cases = loadCases(options.cases)
  options.dataDir = mkdtempSync(join(tmpdir(), 'kun-fast-context-bench-'))
  try {
    const setup = spawnWorker(options, 'setup', null)
    const legacyBase = baseline(options, 'noop')
    const rankedBase = baseline(options, 'warm')
    const rows = []
    for (const entry of cases) {
      const legacyRuns = Array.from({ length: options.repeat }, () => spawnWorker(options, 'legacy', entry.id))
      const rankedRuns = Array.from({ length: options.repeat }, () => spawnWorker(options, 'ranked', entry.id))
      const cpu = (runs, base) => {
        const value = median(runs.map((run) => run.cpuMs))
        return value === null || base === null ? null : Math.max(0, value - base)
      }
      rows.push({
        id: entry.id,
        expect: entry.expect,
        legacy: { ...legacyRuns[0].payload, wallMs: median(legacyRuns.map((run) => run.payload.wallMs)), cpuMs: cpu(legacyRuns, legacyBase) },
        ranked: { ...rankedRuns[0].payload, wallMs: median(rankedRuns.map((run) => run.payload.wallMs)), cpuMs: cpu(rankedRuns, rankedBase) }
      })
    }
    const summarize = (key) => ({
      top1: rows.filter((row) => row[key].rank === 1).length,
      top5: rows.filter((row) => row[key].rank !== null && row[key].rank <= 5).length,
      visible: rows.filter((row) => row[key].rank !== null).length,
      cpuMs: rows.reduce((sum, row) => sum + (row[key].cpuMs ?? 0), 0),
      wallMs: rows.reduce((sum, row) => sum + (row[key].wallMs ?? 0), 0)
    })
    const report = { workspace: options.workspace, index: setup.payload, indexBuildCpuMs: setup.cpuMs, cases: rows, legacy: summarize('legacy'), ranked: summarize('ranked') }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }
    console.log(`Workspace: ${options.workspace}`)
    console.log(`Indexes: ${setup.payload.files} files, ${setup.payload.definitions} definitions, built in ${format(setup.payload.wallMs)} ms wall / ${format(setup.cpuMs)} ms CPU (one-time, persisted)`)
    console.log('')
    console.log('| case | legacy rank | ranked rank | ranked scope | legacy CPU ms | ranked CPU ms | legacy wall ms | ranked wall ms |')
    console.log('|---|---|---|---|---|---|---|---|')
    for (const row of rows) {
      console.log(`| ${row.id} | ${row.legacy.rank ?? 'miss'} | ${row.ranked.rank ?? 'miss'} | ${row.ranked.scope ?? ''} | ${format(row.legacy.cpuMs)} | ${format(row.ranked.cpuMs)} | ${format(row.legacy.wallMs)} | ${format(row.ranked.wallMs)} |`)
    }
    for (const key of ['legacy', 'ranked']) {
      const total = report[key]
      console.log(`${key}: top-1 ${total.top1}/${rows.length}, top-5 ${total.top5}/${rows.length}, visible ${total.visible}/${rows.length}, CPU ${format(total.cpuMs)} ms, wall ${format(total.wallMs)} ms`)
    }
  } finally {
    rmSync(options.dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

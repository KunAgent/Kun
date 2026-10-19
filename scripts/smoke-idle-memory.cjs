#!/usr/bin/env node
'use strict'

// Idle memory budget smoke. Launches the built desktop app (out/ + kun/dist)
// against a disposable profile, leaves it idle, then checks the regressions
// behind the 2026-10 idle-memory investigation:
// Main polling the Manager/Runtime, Agent CLIs spawned by readiness probes,
// extra Electron-as-Node helpers, and the process-tree memory footprint.
//
//   node scripts/smoke-idle-memory.cjs [--idle-seconds 90] [--max-footprint-mb 1400]
//     [--evidence <dir>] [--timeout-ms 180000] [--repository <checkout>] [--report-only]
//     [--stack <request substring>]   (records Main call stacks for matching requests)
//     [--profile-seed <dir>]          (copied into the disposable ~/.kun/data first, e.g.
//                                      a Registry, model catalogs and rooms from a large profile)
//
// The app starts twice on the same disposable profile: the first start seeds
// the caches a real profile already has (MCP catalogs, readiness proofs), the
// second start is measured. `--repository` measures another built checkout
// (for example a baseline) with this script; `--report-only` skips budgets.
// Run `npm run build` first. Nothing outside the temporary profile is touched.

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const { startDirectModel } = require('./smoke-direct-model.cjs')
const { makeTreeWritable } = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent,
  desktopUserDataCandidates, platformDesktopArguments, stopIsolatedServiceManager,
  stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const {
  availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree
} = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

/** External Agent CLIs that readiness probes used to spawn while idle. */
const AGENT_CLI_PATTERN = /(?:^|\/)(?:claude|codex|agy|devin|opencode|cursor-agent)(?:\s|$)/u

function processTree(rootPid) {
  const rows = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' })
    .split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [pid, ppid, rss, ...command] = line.split(/\s+/u)
      return { pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss), command: command.join(' ') }
    })
  const children = new Map()
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  const tree = []
  const queue = rows.filter((row) => row.pid === rootPid)
  while (queue.length) {
    const row = queue.shift()
    tree.push({ ...row, kind: processKind(row.command), footprintMb: footprintMb(row.pid) })
    queue.push(...(children.get(row.pid) ?? []))
  }
  return tree
}

function processKind(command) {
  if (/^kun(?:-dv)?-service-manager\b/u.test(command)) return 'service-manager'
  if (/^kun(?:-dv)?-runtime\b/u.test(command)) return 'runtime'
  if (command.includes('KUN_PROCESS_STACK_OWNER_PID')) return 'process-guard'
  if (command.includes('claw-schedule-mcp-node-entry')) return 'schedule-mcp'
  if (command.includes('--type=renderer')) return 'renderer'
  if (command.includes('--type=gpu-process')) return 'gpu'
  if (command.includes('--type=utility')) return 'utility'
  if (AGENT_CLI_PATTERN.test(command)) return 'agent-cli'
  return 'other'
}

/** macOS phys_footprint (what Activity Monitor reports); RSS elsewhere. */
function footprintMb(pid) {
  if (process.platform !== 'darwin') return undefined
  try {
    const output = execFileSync('/usr/bin/footprint', ['-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const match = /Footprint:\s+([\d.]+)\s+(KB|MB|GB)/u.exec(output)
    if (!match) return undefined
    const value = Number(match[1])
    return match[2] === 'GB' ? value * 1024 : match[2] === 'KB' ? value / 1024 : value
  } catch {
    return undefined
  }
}

function summarize(tree) {
  const byKind = {}
  let rssMb = 0
  let footprint = 0
  for (const row of tree) {
    const entry = byKind[row.kind] ??= { count: 0, rssMb: 0, footprintMb: 0 }
    entry.count += 1
    entry.rssMb += row.rssKb / 1024
    entry.footprintMb += row.footprintMb ?? row.rssKb / 1024
    rssMb += row.rssKb / 1024
    footprint += row.footprintMb ?? row.rssKb / 1024
  }
  return { processes: tree.length, rssMb: Math.round(rssMb), footprintMb: Math.round(footprint), byKind }
}

async function installFetchCounter(application, stackNeedle) {
  await application.evaluate((_electron, needle) => {
    const original = globalThis.fetch
    const stats = {}
    const stacks = {}
    globalThis.__kunIdleFetch = { original, stats, stacks, startedAt: Date.now() }
    globalThis.fetch = async function countedFetch(input, init) {
      const url = typeof input === 'string' ? input : input?.url ?? String(input)
      let key = url
      try {
        const parsed = new URL(url)
        key = `${String(init?.method || 'GET').toUpperCase()} ${parsed.pathname}${parsed.searchParams.has('ifNoneMatch') ? '?conditional' : ''}`
        if (parsed.pathname.includes('/atomic-json/') && typeof init?.body === 'string') {
          const path = JSON.parse(init.body).path
          if (typeof path === 'string') key += ` ${path.split('/').slice(-2).join('/')}`
        }
      } catch { /* keep the raw URL */ }
      stats[key] = (stats[key] ?? 0) + 1
      if (needle && key.includes(needle)) {
        Error.stackTraceLimit = 60; const stack = (new Error().stack ?? '').split('\n').slice(2, 40).map((line) => line.trim()).join(' < ')
        stacks[stack] = (stacks[stack] ?? 0) + 1
      }
      return original.call(this, input, init)
    }
  }, stackNeedle)
}

async function readFetchCounter(application) {
  return application.evaluate(() => {
    const state = globalThis.__kunIdleFetch
    if (!state) return { minutes: 0, perMinute: {} }
    globalThis.fetch = state.original
    const minutes = Math.max(1 / 60, (Date.now() - state.startedAt) / 60_000)
    const perMinute = Object.fromEntries(Object.entries(state.stats)
      .map(([key, count]) => [key, Math.round((count / minutes) * 10) / 10]))
    return { minutes: Math.round(minutes * 100) / 100, perMinute,
      ...(Object.keys(state.stacks).length ? { stacks: state.stacks } : {}) }
  })
}

function budgetFailures(report, limits) {
  const failures = []
  const rate = (predicate) => Object.entries(report.mainFetch.perMinute)
    .filter(([key]) => predicate(key)).reduce((sum, [, value]) => sum + value, 0)
  const fullSettingsReads = rate((key) => key === 'GET /v1/documents/settings')
  if (fullSettingsReads > limits.fullSettingsReadsPerMinute) {
    failures.push(`Main re-read the full settings document ${fullSettingsReads}/min (budget ${limits.fullSettingsReadsPerMinute})`)
  }
  const healthProbes = rate((key) => key === 'GET /health' || key === 'GET /v1/runtime/info')
  if (healthProbes > limits.healthProbesPerMinute) {
    failures.push(`Main probed Runtime health ${healthProbes}/min (budget ${limits.healthProbesPerMinute})`)
  }
  const final = report.samples.at(-1)
  const agentClis = final.byKind['agent-cli']?.count ?? 0
  if (agentClis > 0) failures.push(`${agentClis} external Agent CLI process(es) are running while idle`)
  const helpers = ['service-manager', 'runtime', 'process-guard', 'schedule-mcp']
    .reduce((sum, kind) => sum + (final.byKind[kind]?.count ?? 0), 0)
  if (helpers > limits.nodeHelpers) failures.push(`${helpers} Electron-as-Node helpers are running (budget ${limits.nodeHelpers})`)
  if (final.footprintMb > limits.maxFootprintMb) {
    failures.push(`Process tree footprint ${final.footprintMb} MB exceeds ${limits.maxFootprintMb} MB`)
  }
  return failures
}

async function launchApplication(context) {
  const application = await _electron.launch({
    executablePath: context.electronExecutable,
    args: [`--user-data-dir=${context.userData}`, '--no-first-run', '--disable-background-networking',
      '--disable-component-update', '--disable-default-apps', ...platformDesktopArguments(process.platform), context.repositoryRoot],
    cwd: context.repositoryRoot, env: context.environment, chromiumSandbox: true, timeout: context.timeoutMs
  })
  const page = await findWorkbenchWindow(application, context.timeoutMs)
  await page.locator('[data-workspace-mode-trigger]').first().waitFor({ timeout: context.timeoutMs })
  return application
}

async function closeApplication(context, application) {
  const electronProcess = application.process()
  await withTimeout(application.close(), 5000, 'closing Electron').catch(() => undefined)
  await terminateProcessTree(electronProcess, process.platform, { timeoutMs: 15_000, detached: process.platform !== 'win32' })
    .catch(() => undefined)
  await stopIsolatedSharedRuntime(context.repositoryRoot, context.profile).catch(() => undefined)
  await stopIsolatedServiceManager(context.home, context.profile).catch(() => undefined)
  releaseChildProcessHandles(electronProcess)
}

async function main() {
  const repositoryRoot = resolve(argumentValue('--repository') ?? resolve(__dirname, '..'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 180_000)
  const idleSeconds = positiveIntegerArgument('--idle-seconds', 90)
  const limits = {
    maxFootprintMb: positiveIntegerArgument('--max-footprint-mb', 1400),
    nodeHelpers: positiveIntegerArgument('--max-node-helpers', 3),
    fullSettingsReadsPerMinute: 6,
    healthProbesPerMinute: 24
  }
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'idle-memory-smoke'))
  const electronPathFile = join(repositoryRoot, 'node_modules', 'electron', 'path.txt')
  assert(existsSync(electronPathFile), 'Electron binary is not installed')
  const electronExecutable = join(repositoryRoot, 'node_modules', 'electron', 'dist', (await readFile(electronPathFile, 'utf8')).trim())
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'kun-idle-memory-smoke-')))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'idle-memory-'))
  let application, electronProcess, modelFixture, report, primaryError
  try {
    await Promise.all([home, profile, userData, appData, localAppData, temporaryDirectory, evidenceRoot]
      .map((directory) => mkdir(directory, { recursive: true })))
    const profileSeed = argumentValue('--profile-seed')
    if (profileSeed) await cp(resolve(profileSeed), profile, { recursive: true })
    const environment = createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory })
    modelFixture = await startDirectModel({ real: false })
    const settings = { ...desktopSmokeSettings(await availablePort(), workspaceRoot, profile), initialSetupCompleted: true }
    settings.agents.kun.baseUrl = modelFixture.baseUrl
    settings.agents.kun.apiKey = 'idle-memory-offline-fixture'
    settings.agents.kun.model = modelFixture.snapshot().model
    settings.claw = { im: { enabled: false, port: await availablePort() } }
    settings.schedule = { internal: { port: await availablePort() } }
    const serialized = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({ platform: process.platform, home, appData, explicitUserData: userData })
      .map(async (directory) => {
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'kun-settings.json'), serialized)
      }))
    const context = { electronExecutable, userData, repositoryRoot, environment, timeoutMs, profile, home }
    // Seed start: populate the caches a returning user's profile already has.
    const seed = await launchApplication(context)
    await new Promise((settle) => setTimeout(settle, 15_000))
    await closeApplication(context, seed)
    application = await launchApplication(context)
    electronProcess = application.process()
    await installFetchCounter(application, argumentValue('--stack'))
    const samples = []
    const deadline = Date.now() + idleSeconds * 1000
    while (Date.now() < deadline) {
      await new Promise((settle) => setTimeout(settle, Math.min(15_000, Math.max(0, deadline - Date.now()))))
      samples.push({ at: new Date().toISOString(), ...summarize(processTree(electronProcess.pid)) })
    }
    const finalTree = processTree(electronProcess.pid)
    samples.push({ at: new Date().toISOString(), ...summarize(finalTree) })
    report = {
      idleSeconds,
      mainFetch: await readFetchCounter(application),
      samples,
      processes: finalTree.map(({ pid, kind, rssKb, footprintMb: footprint }) =>
        ({ pid, kind, rssMb: Math.round(rssKb / 1024), footprintMb: footprint === undefined ? undefined : Math.round(footprint) }))
    }
    report.repository = repositoryRoot
    report.failures = process.argv.includes('--report-only') ? [] : budgetFailures(report, limits)
    report.limits = limits
    await writeFile(join(evidenceRoot, 'idle-memory-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    primaryError = error
  } finally {
    modelFixture?.release?.()
    const cleanupErrors = []
    const cleanup = async (operation) => {
      try { await withTimeout(operation, 20_000, 'cleaning idle memory smoke') } catch (error) { cleanupErrors.push(error.message) }
    }
    if (application) await withTimeout(application.close(), 5000, 'closing Electron').catch(() => undefined)
    if (electronProcess) await cleanup(terminateProcessTree(electronProcess, process.platform, { timeoutMs: 15_000, detached: process.platform !== 'win32' }))
    await cleanup(stopIsolatedSharedRuntime(repositoryRoot, profile))
    await cleanup(stopIsolatedServiceManager(home, profile))
    releaseChildProcessHandles(electronProcess)
    if (modelFixture) await cleanup(modelFixture.close())
    await cleanup(Promise.all([makeTreeWritable(temporaryRoot), makeTreeWritable(workspaceRoot)]))
    await cleanup(Promise.all([temporaryRoot, workspaceRoot]
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }))))
    if (cleanupErrors.length) primaryError = new Error(`${primaryError?.stack ?? ''}\nCleanup failures: ${cleanupErrors.join('; ')}`)
  }
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.failures.length) {
    process.stderr.write(`Idle memory budget exceeded:\n- ${report.failures.join('\n- ')}\n`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})

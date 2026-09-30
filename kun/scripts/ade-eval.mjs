#!/usr/bin/env node
/**
 * P3-16 manager evaluation (docs/ade/impl/p3-review-followup.md): runs the
 * fixed corpus in ade-eval-tasks.mjs twice per task — once on a plain Kun
 * thread ("single") and once on an ADE manager thread that may delegate to
 * workers — and compares success, tokens, wall time, and the number of
 * user-side interventions (approvals, question answers, workspace merges).
 *
 * Same credential rules as ade-e2e: real providers only on development
 * machines or nightly jobs; results append as JSONL with --out and print a
 * markdown table for the follow-up doc's §4.
 *
 * Usage:
 *   node scripts/ade-eval.mjs --api-key-file <f> [--config c] [--only t01,t07]
 *     [--mode single|ade|both] [--timeout s] [--out results.jsonl] [--keep]
 *   node scripts/ade-eval.mjs --url http://127.0.0.1:PORT --token T ...
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createClient, fail, makeWorkspace, sleep, spawnServe
} from './ade-e2e-client.mjs'
import { EVAL_TASKS } from './ade-eval-tasks.mjs'

// ---------- args ----------
const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!a.startsWith('--')) usage(`unexpected arg: ${a}`)
  const key = a.slice(2)
  if (key === 'keep') { args.keep = true; continue }
  const value = process.argv[++i]
  if (value === undefined) usage(`missing value for ${a}`)
  args[key] = value
}
if (process.argv.includes('--help') || process.argv.includes('-h')) usage()
function usage(msg) {
  if (msg) console.error(`ade-eval: ${msg}`)
  console.error('Usage: node scripts/ade-eval.mjs [--url base [--token t]] [--config f] [--data-dir d] [--api-key-file f] [--provider p] [--model m] [--only id,id] [--mode single|ade|both] [--timeout s] [--out file.jsonl] [--keep]')
  process.exit(msg ? 2 : 0)
}

const TIMEOUT_MS = Number(args.timeout ?? 480) * 1000
const MODE = args.mode ?? 'both'
const ONLY = args.only ? new Set(args.only.split(',').map((s) => s.trim())) : null
const TASKS = EVAL_TASKS.filter((t) => !ONLY || ONLY.has(t.id))
const ENV_BLOCKED = /credential|unauthorized|401|403|ENOTFOUND|EAI_AGAIN|rate.?limit|insufficient|quota|timed out|not installed|not allowed/i

const cleanupDirs = []
const results = []
let serveProc = null
let api, followThread, createThread, startTurn, watchWorkerApprovals, settleEvent

const ctx = { version: 'unknown', kunRoute: null, adeManager: false }

// ---------- infra ----------
async function preflight() {
  const health = await api('/health')
  if (health.status !== 200) fail(`serve unhealthy: GET /health -> ${health.status}`)
  await api('/v1/model-gateway/credential/ensure', { method: 'POST', body: {} })
  const info = await api('/v1/runtime/info')
  ctx.version = String(info.json?.version ?? info.json?.buildId ?? 'unknown').slice(0, 12)
  const probe = await api('/v1/teams/by-manager/ade-eval-probe')
  ctx.adeManager = probe.status === 404
  const connections = await api('/v1/model-connections')
  const providers = connections.json?.providers ?? []
  const usable = (p) => (p.kind ?? 'http') === 'http' && p.configured &&
    p.credentialStatus !== 'missing' && (p.models?.length || p.selectedModel)
  const picked = args.provider
    ? providers.find((p) => p.id === args.provider)
    : providers.find((p) => p.id === 'default' && usable(p)) ?? providers.find(usable)
  const model = args.model ?? picked?.selectedModel ?? picked?.models?.[0]
  ctx.kunRoute = picked && model ? { providerId: picked.id, model } : null
  if (!ctx.kunRoute) fail('no usable HTTP model connection for kun turns (pass --provider/--model)')
}

/** Fresh git repo with the task fixture committed on top of the baseline. */
function seedWorkspace(task) {
  const ws = makeWorkspace({}, cleanupDirs)
  for (const [rel, content] of Object.entries(task.files ?? {})) {
    const p = join(ws, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  execFileSync('git', ['add', '-A'], { cwd: ws, stdio: 'pipe' })
  execFileSync('git', ['-c', 'user.email=ade-eval@local', '-c', 'user.name=ade-eval',
    'commit', '-qm', `fixture ${task.id}`, '--allow-empty'], { cwd: ws, stdio: 'pipe' })
  return ws
}

function verify(ws, run) {
  try {
    execFileSync('/bin/sh', ['-c', run], { cwd: ws, stdio: 'pipe', timeout: 30_000 })
    return true
  } catch { return false }
}

/** Total tokens recorded for one thread (small retry for accounting lag). */
async function usageFor(threadId) {
  for (let i = 0; i < 5; i++) {
    const res = await api(`/v1/usage?group_by=thread&thread_id=${threadId}`)
    const buckets = res.json?.buckets ?? res.json?.rows ?? []
    const total = buckets.reduce((n, b) => n + (b.total_tokens ?? b.totalTokens ?? 0), 0)
    if (total > 0 || i === 4) return total
    await sleep(400)
  }
  return 0
}

function record(task, mode, row) {
  const out = {
    date: new Date().toISOString().slice(0, 10), version: ctx.version,
    task: task.id, kind: task.kind, mode, ...row
  }
  results.push(out)
  if (args.out) appendFileSync(args.out, JSON.stringify(out) + '\n')
  console.log(`[${task.id}/${mode}] ${row.success ? 'success' : 'FAIL'} | ` +
    `tokens=${row.tokens ?? '-'} wall=${Math.round((row.wallMs ?? 0) / 1000)}s ` +
    `interventions=${row.interventions ?? 0} ${row.notes?.join('; ') ?? ''}`)
  return out
}

// ---------- mode drivers ----------
async function runSingle(task) {
  const ws = seedWorkspace(task)
  const notes = []
  const made = await createThread({
    title: `ade-eval ${task.id} single`, workspace: ws,
    model: ctx.kunRoute.model, providerId: ctx.kunRoute.providerId
  })
  if (!made.ok) {
    return record(task, 'single', { success: false, blocked: ENV_BLOCKED.test(made.error), notes: [`createThread ${made.status}: ${made.error?.slice(0, 200)}`] })
  }
  const feed = followThread(made.thread.id)
  const watch = watchWorkerApprovals([made.thread.id])
  const t0 = Date.now()
  const turn = await startTurn(made.thread.id, { prompt: task.prompt })
  if (!turn.ok) {
    watch.close(); feed.close()
    return record(task, 'single', { success: false, blocked: ENV_BLOCKED.test(turn.error), notes: [`startTurn ${turn.status}: ${turn.error?.slice(0, 200)}`] })
  }
  const settle = await feed.wait(settleEvent(turn.turnId), TIMEOUT_MS)
  await watch.flush()
  watch.close(); feed.close()
  const wallMs = Date.now() - t0
  const turnOk = settle?.kind === 'turn_completed'
  if (!settle) notes.push(`no settle in ${TIMEOUT_MS / 1000}s`)
  else if (!turnOk) notes.push(`turn ${settle.kind}: ${String(settle.message ?? '').slice(0, 160)}`)
  const verified = verify(ws, task.verify.run)
  const tokens = await usageFor(made.thread.id)
  return record(task, 'single', {
    success: turnOk && verified, verified, turnOk, tokens, wallMs,
    interventions: watch.approved.size,
    approvalErrors: watch.errors.length ? watch.errors.join('; ').slice(0, 160) : undefined,
    notes
  })
}

async function runAde(task) {
  const ws = seedWorkspace(task)
  const notes = []
  const made = await createThread({
    title: `ade-eval ${task.id} manager`, workspace: ws,
    model: ctx.kunRoute.model, providerId: ctx.kunRoute.providerId,
    harnessId: 'kun', workspaceMode: 'ade'
  })
  if (!made.ok) {
    return record(task, 'ade', { success: false, blocked: ENV_BLOCKED.test(made.error), notes: [`createThread ${made.status}: ${made.error?.slice(0, 200)}`] })
  }
  const managerId = made.thread.id
  const feed = followThread(managerId)
  const watches = new Map()
  const mgrWatch = watchWorkerApprovals([managerId])
  const answeredQ = new Set()
  let interventions = 0
  const t0 = Date.now()
  const turn = await startTurn(managerId, { prompt: task.prompt, harnessId: 'kun' })
  if (!turn.ok) {
    mgrWatch.close(); feed.close()
    return record(task, 'ade', { success: false, blocked: ENV_BLOCKED.test(turn.error), notes: [`startTurn ${turn.status}: ${turn.error?.slice(0, 200)}`] })
  }

  const deadline = t0 + TIMEOUT_MS * 2
  let overview = null
  let stablePolls = 0
  while (Date.now() < deadline) {
    const res = await api(`/v1/teams/by-manager/${managerId}`)
    if (res.status === 200) overview = res.json
    for (const w of overview?.team?.workers ?? []) {
      if (!watches.has(w.workerId)) watches.set(w.workerId, watchWorkerApprovals([w.workerId]))
    }
    for (const q of (overview?.questions ?? []).filter((x) => x.state === 'open' && !answeredQ.has(x.questionId))) {
      await api(`/v1/teams/questions/${q.questionId}/answer`,
        { method: 'POST', body: { answer: task.answer ?? 'Proceed with your best judgment.' } })
      answeredQ.add(q.questionId); interventions++
    }
    // Termination: every manager turn that started has settled (worker
    // notices wake follow-up turns), every dispatch is terminal, and no open
    // question remains — stable across a few polls so a just-enqueued wake
    // turn is not missed at cutoff.
    const started = new Set(feed.events.filter((e) => e.kind === 'turn_started').map((e) => e.turnId))
    const settled = new Set(feed.events.filter((e) =>
      ['turn_completed', 'turn_failed', 'turn_aborted'].includes(e.kind)).map((e) => e.turnId))
    const running = [...started].filter((id) => id && !settled.has(id))
    const dispatches = overview?.dispatches ?? []
    const allTerminal = dispatches.every((d) => ['completed', 'failed', 'cancelled'].includes(d.state))
    const openQ = (overview?.questions ?? []).some((q) => q.state === 'open')
    if (started.size && running.length === 0 && allTerminal && !openQ) {
      stablePolls++
      if (stablePolls >= 5) break
    } else stablePolls = 0
    await sleep(2_000)
  }
  const wallMs = Date.now() - t0
  await mgrWatch.flush(); mgrWatch.close()
  for (const w of watches.values()) { await w.flush(); w.close() }
  feed.close()
  interventions += mgrWatch.approved.size +
    [...watches.values()].reduce((n, w) => n + w.approved.size, 0)

  const workers = overview?.team?.workers ?? []
  const dispatches = overview?.dispatches ?? []
  const failed = dispatches.filter((d) => d.state === 'failed' || d.state === 'cancelled')
  notes.push(`workers=${workers.length} dispatches=${dispatches.length}` +
    (failed.length ? ` failed=${failed.length}` : ''))
  // P4-16: parallel-shaped tasks carry an advisory worker floor; flag when
  // the manager serially self-served work meant to be delegated.
  if (task.expect?.minWorkers && workers.length < task.expect.minWorkers) {
    notes.push(`under-dispatched: workers=${workers.length} < expected ${task.expect.minWorkers}`)
  }

  // The user's lane (09 §7): merge each worker's task workspace back, then
  // verify the manager workspace — the same final state a single-Kun run
  // produces. A worker that finished in its own tree but cannot merge is a
  // distinct outcome from the work itself failing.
  let integrated = 0, mergeBlocked = 0
  for (const w of workers) {
    if (!w.taskWorkspaceId) continue
    const rec = await api(`/v1/task-workspaces/${w.taskWorkspaceId}`)
    const state = rec.json?.state ?? rec.json?.workspace?.state
    if (!['ready', 'captured', 'conflict'].includes(state)) { notes.push(`tws ${w.taskWorkspaceId} state=${state ?? '?'}`); continue }
    const pre = rec.json?.path ?? rec.json?.workspace?.path
    const verifiedInTws = pre ? verify(pre, task.verify.run) : false
    const ir = await api(`/v1/task-workspaces/${w.taskWorkspaceId}/integrate`, { method: 'POST', body: {} })
    interventions++
    if (ir.status === 200 && ir.json?.ok !== false) integrated++
    else { mergeBlocked++; notes.push(`integrate ${w.taskWorkspaceId}: ${ir.status} ${String(ir.json?.userReport ?? ir.text ?? '').slice(0, 120)}`) }
    if (verifiedInTws && ir.status !== 200) notes.push('worked in tws but merge refused')
  }
  const managerTurns = feed.events.filter((e) => e.kind === 'turn_started').map((e) => e.turnId)
  const settledKinds = new Map(feed.events.filter((e) =>
    ['turn_completed', 'turn_failed', 'turn_aborted'].includes(e.kind)).map((e) => [e.turnId, e.kind]))
  const turnOk = managerTurns.length > 0 && managerTurns.every((id) => settledKinds.get(id) === 'turn_completed')
  const verified = verify(ws, task.verify.run)
  const teamTokens = overview?.usage?.totalTokens
  const tokens = (typeof teamTokens === 'number' ? teamTokens : 0) + await usageFor(managerId)
  return record(task, 'ade', {
    success: verified && failed.length === 0, verified, turnOk, tokens, wallMs,
    workers: workers.length, dispatches: dispatches.length,
    integrated, mergeBlocked,
    interventions, questionsAnswered: answeredQ.size,
    notes
  })
}

// ---------- run ----------
try {
  let base, token
  if (args.url) {
    base = args.url.replace(/\/$/, '')
    token = args.token ?? process.env.KUN_RUNTIME_TOKEN ?? ''
  } else {
    const spawned = await spawnServe(args)
    base = spawned.base
    token = spawned.token
    serveProc = spawned.proc
    cleanupDirs.push(...spawned.cleanupDirs)
  }
  ;({ api, followThread, createThread, startTurn, watchWorkerApprovals, settleEvent } =
    createClient({ base, token, settleMs: TIMEOUT_MS }))
  await preflight()
  console.log(`kun ${ctx.version} on ${base} | manager=${ctx.kunRoute.providerId}/${ctx.kunRoute.model} | ade-manager=${ctx.adeManager} | tasks=${TASKS.length} mode=${MODE}`)
  for (const task of TASKS) {
    for (const mode of MODE === 'both' ? ['single', 'ade'] : [MODE]) {
      if (mode === 'ade' && !ctx.adeManager) { console.log(`[${task.id}/ade] skip: ade manager runtime unavailable`); continue }
      try {
        await (mode === 'single' ? runSingle(task) : runAde(task))
      } catch (error) {
        record(task, mode, { success: false, notes: [`exception: ${String(error?.message ?? error).slice(0, 240)}`] })
      }
    }
  }
} finally {
  if (serveProc) {
    serveProc.kill('SIGTERM')
    for (let i = 0; i < 40 && serveProc.exitCode === null; i++) await sleep(250)
  }
  if (!args.keep) {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    }
  }
}

// ---------- report ----------
const byMode = (m) => results.filter((r) => r.mode === m)
for (const mode of MODE === 'both' ? ['single', 'ade'] : [MODE]) {
  const rows = byMode(mode)
  if (!rows.length) continue
  const ok = rows.filter((r) => r.success).length
  const sum = (k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
  console.log(`\n${mode}: ${ok}/${rows.length} success | tokens=${sum('tokens')} | ` +
    `wall=${Math.round(sum('wallMs') / 1000)}s | interventions=${sum('interventions')}`)
}
if (MODE === 'both' && byMode('single').length && byMode('ade').length) {
  console.log('\nper-task comparison (single -> ade):')
  for (const t of TASKS) {
    const s = results.find((r) => r.task === t.id && r.mode === 'single')
    const a = results.find((r) => r.task === t.id && r.mode === 'ade')
    if (!s || !a) continue
    const ratio = s.tokens && a.tokens ? (a.tokens / s.tokens).toFixed(2) : '-'
    console.log(`  ${t.id}: ${s.success ? 'ok' : 'fail'} -> ${a.success ? 'ok' : 'fail'} | ` +
      `tokens ${s.tokens} -> ${a.tokens} (x${ratio}) | wall ${Math.round((s.wallMs ?? 0) / 1000)}s -> ${Math.round((a.wallMs ?? 0) / 1000)}s | ` +
      `intv ${s.interventions} -> ${a.interventions}`)
  }
}
const today = new Date().toISOString().slice(0, 10)
console.log('\n--- paste into p3-review-followup.md §4 ---')
for (const r of results) {
  const note = (r.notes ?? []).join('; ').replace(/\|/g, '/')
  console.log(`| ${today} | kun ${ctx.version} | P3-16 ${r.task} ${r.mode} | ${r.success ? '通过' : '失败'} | tokens=${r.tokens ?? '-'} wall=${Math.round((r.wallMs ?? 0) / 1000)}s intv=${r.interventions ?? 0} ${r.workers !== undefined ? `workers=${r.workers} ` : ''}${note} |`)
}
process.exit(results.some((r) => r.success === false && !r.blocked) ? 1 : 0)

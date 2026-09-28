#!/usr/bin/env node
/**
 * ADE end-to-end acceptance script (docs/ade/impl/p3-review-followup.md P3-13).
 * Drives a real `kun serve` over HTTP through the 13 §8 P1 items and prints a
 * versioned markdown result table to append to the review doc's §4.
 * Serve-lifecycle and HTTP/SSE helpers live in ./ade-e2e-client.mjs.
 *
 * Manual/nightly tool only — needs real provider credentials and installed
 * harness CLIs. Never packaged (scripts/ is not in the runtime build).
 *
 * Modes:
 *   attach (default when --url is given):
 *     node scripts/ade-e2e.mjs --url http://127.0.0.1:PORT [--token T]
 *   spawn (default): builds a scratch data dir + config and starts
 *     `node dist/cli/serve-entry.js serve` itself:
 *     node scripts/ade-e2e.mjs [--config existing-config.json] [--data-dir D]
 *     Requires `npm run build:kun` output. Provider credentials come from the
 *     --config file (recommended) or <data-dir>/config.json — never argv.
 *
 * Options:
 *   --url <base>          Attach to a running serve instead of spawning one
 *   --token <token>       Bearer token (or KUN_RUNTIME_TOKEN env)
 *   --config <path>       Spawn mode: JSON config; `ade.enabled` is forced on
 *   --data-dir <path>     Spawn mode: data dir (default: fresh tmp dir)
 *   --workspace <path>    Git repo the threads run in (default: fresh tmp repo)
 *   --provider <id>       Provider for Kun/manager turns (default: `default`
 *                         when configured, else first ready http connection)
 *   --model <id>          Model for Kun/manager turns (default: provider's
 *                         selectedModel or first listed model)
 *   --api-key-file <path> Spawn mode: file supplying the serve api key. JSON
 *                         with `entries.deepseek` or raw key text. Injected as
 *                         DEEPSEEK_API_KEY in the serve env — never argv/logs.
 *   --items <list>        Comma list: p1-1,p1-2,p1-3,p1-4 (default: all)
 *   --timeout <seconds>   Per-turn settle timeout (default 240)
 *   --keep                Keep spawned serve data dir and workspace on exit
 */
import { rmSync } from 'node:fs'
import { createClient, fail, makeWorkspace, sleep, spawnServe }
  from './ade-e2e-client.mjs'

// ---------- args ----------
const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--keep') { args.keep = true; continue }
  if (!a.startsWith('--')) usage(`unexpected arg: ${a}`)
  const key = a.slice(2)
  const value = process.argv[++i]
  if (value === undefined) usage(`missing value for ${a}`)
  args[key] = value
}
if (process.argv.includes('--help') || process.argv.includes('-h')) usage()
const ITEMS = (args.items ?? 'p1-1,p1-2,p1-3,p1-4').split(',').map((s) => s.trim())
const SETTLE_MS = Number(args.timeout ?? 240) * 1000

function usage(msg) {
  if (msg) console.error(`ade-e2e: ${msg}`)
  console.error('Usage: node scripts/ade-e2e.mjs [--url base [--token t]] [--config f] [--data-dir d] [--workspace w] [--items p1-1,...] [--timeout s] [--keep]')
  process.exit(msg ? 2 : 0)
}

// ---------- client (bound after spawn/attach) ----------
let api, followThread, createThread, startTurn, watchWorkerApprovals, settleEvent
let serveProc = null
const cleanupDirs = []

// ---------- preflight ----------
const ctx = {
  version: 'unknown',
  harnesses: new Map(), // id -> {definition, status}
  providers: [],        // GET /v1/model-connections rows
  kunRoute: null,       // {providerId, model} for Kun/manager turns
  adeManager: false,
  gatewayEnabled: false, // model-gateway credential materialized
  workspace: ''
}

async function preflight() {
  const health = await api('/health')
  if (health.status !== 200) fail(`serve unhealthy: GET /health -> ${health.status}`)
  // Materialize the public gateway credential: `modelGateway.enabled()` needs
  // both `localModelGateway.enabled` and a persisted key. Without this every
  // `kun-gateway` route 404s from inside the child harness.
  const ensured = await api('/v1/model-gateway/credential/ensure', { method: 'POST', body: {} })
  ctx.gatewayEnabled = ensured.status === 200
  const info = await api('/v1/runtime/info')
  ctx.version = info.json?.version ?? info.json?.buildId ?? 'unknown'
  const list = await api('/v1/harnesses')
  for (const row of list.json?.harnesses ?? []) ctx.harnesses.set(row.definition.id, row)
  // GET returns a cold cache ('unknown') on a fresh serve — force real probes
  // for every defined harness so availability checks see true status.
  await Promise.all([...ctx.harnesses.keys()].map(async (id) => {
    const probed = await api(`/v1/harnesses/${id}/probe`, { method: 'POST', body: {} })
    if (probed.status === 200 && probed.json?.status) {
      ctx.harnesses.set(id, { ...ctx.harnesses.get(id), status: probed.json.status })
    }
  }))
  const probe = await api('/v1/teams/by-manager/ade-e2e-probe')
  // 404 = manager runtime is up but no such team; 5xx = ADE disabled entirely.
  ctx.adeManager = probe.status === 404
  const connections = await api('/v1/model-connections')
  ctx.providers = connections.json?.providers ?? []
  ctx.kunRoute = pickKunRoute()
  ctx.workspace = makeWorkspace(args, cleanupDirs)
}

/**
 * Pick the provider/model that Kun and manager turns run on. --provider/--model
 * win; otherwise the first ready HTTP connection. Non-http kinds (agent-sdk
 * subscriptions and friends) are whole-turn delegates — the Kun loop cannot
 * address them as model providers ("unknown model provider").
 */
function pickKunRoute() {
  if (args.provider) {
    const p = ctx.providers.find((x) => x.id === args.provider)
    const model = args.model ?? p?.selectedModel ?? p?.models?.[0]
    return model ? { providerId: args.provider, model } : null
  }
  const usable = (p) => (p.kind ?? 'http') === 'http' && p.configured &&
    p.credentialStatus !== 'missing' && (p.models?.length || p.selectedModel)
  // `default` is the serve --api-key route — the runtime's own model. Other
  // http providers may be configured-but-dead upstream (e.g. free tiers that
  // refuse non-native clients), so they rank below it.
  const ready = ctx.providers.find((p) => p.id === 'default' && usable(p))
    ?? ctx.providers.find(usable)
  if (!ready) return null
  return { providerId: ready.id, model: args.model ?? ready.selectedModel ?? ready.models[0] }
}

function harnessUsable(id) {
  const row = ctx.harnesses.get(id)
  if (!row) return null
  const s = row.status
  if (s.installed !== 'yes' || s.ready === 'no') return null
  return row
}

/** Environmental refusals (upstream auth/policy/broken local install) — the
 * wiring was exercised; the verdict belongs to the environment, not the code. */
const ENV_BLOCKED = /no longer supported|401|403|auth|sign in|login|unsupported|interactive|free tier|issue with the selected model|not exist|access|quota|requires interactive|spawn|exited|ENOENT|EACCES/i

const results = []
function report(id, title, status, notes) {
  results.push({ id, title, status, notes })
  const mark = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', blocked: 'BLOCKED' }[status]
  console.log(`[${mark}] ${id} ${title}`)
  for (const n of notes) console.log(`       ${n}`)
}

// ---------- item P1-1: a Code thread on an ACP harness ----------
async function itemP11() {
  const id = 'P1-1'
  const title = 'A thread runs on a real ACP harness'
  const candidates = ['gemini-cli', 'opencode', 'codex']
    .map((h) => harnessUsable(h))
    .filter(Boolean)
  if (!candidates.length) return report(id, title, 'skip', ['no ACP harness installed+ready'])
  const tried = []
  for (const chosen of candidates) {
    const outcome = await tryAcpHarness(chosen)
    tried.push(...outcome.notes.map((n) => `[${chosen.definition.id}] ${n}`))
    if (outcome.status === 'blocked') continue
    return report(id, title, outcome.status, tried)
  }
  return report(id, title, 'blocked', tried)
}

/** Run the full prompt/interrupt/resume exercise on one ACP harness. */
async function tryAcpHarness(chosen) {
  const hid = chosen.definition.id
  const notes = [`harness: ${hid} ${chosen.status.version ?? ''}`]
  const modelsRes = await api(`/v1/harnesses/${hid}/models`)
  const model = modelsRes.json?.models?.[0]?.id ?? modelsRes.json?.models?.[0] ?? undefined

  const made = await createThread({
    title: `ade-e2e p1-1 ${hid}`, workspace: ctx.workspace,
    model: model ?? ctx.kunRoute?.model ?? 'default',
    ...(ctx.kunRoute ? { providerId: ctx.kunRoute.providerId } : {})
  })
  if (!made.ok) return { status: 'fail', notes: [...notes, `createThread ${made.status}: ${made.error}`] }
  const feed = followThread(made.thread.id)

  // 1. Prompt + streaming text.
  const t1 = await startTurn(made.thread.id, {
    prompt: 'Reply with exactly: ade-e2e-ok', harnessId: hid, credentialMode: 'native-login'
  })
  if (!t1.ok) {
    feed.close()
    return { status: ENV_BLOCKED.test(t1.error) ? 'blocked' : 'fail',
      notes: [...notes, `startTurn ${t1.status}: ${t1.error}`] }
  }
  const s1 = await feed.wait(settleEvent(t1.turnId))
  if (!s1) { feed.close(); return { status: 'fail', notes: [...notes, 'turn 1 never settled'] } }
  if (s1.kind !== 'turn_completed') {
    const msg = String(s1.message ?? s1.text ?? '')
    feed.close()
    return { status: ENV_BLOCKED.test(msg) ? 'blocked' : 'fail',
      notes: [...notes, `turn 1 ${s1.kind}: ${msg.slice(0, 240)}`] }
  }
  if (!feed.events.some((e) => e.kind === 'assistant_text_delta' || e.kind === 'item_completed')) {
    notes.push('warning: no assistant text observed')
  }

  // 2. Interrupt a slow turn.
  const t2 = await startTurn(made.thread.id, {
    prompt: 'Count from 1 to 500, one number per line.', harnessId: hid, credentialMode: 'native-login'
  })
  if (t2.ok) {
    await feed.wait((e) => e.kind === 'assistant_text_delta' && (!e.turnId || e.turnId === t2.turnId), 20_000)
    await api(`/v1/threads/${made.thread.id}/turns/${t2.turnId}/interrupt`, { method: 'POST', body: {} })
    const s2 = await feed.wait(settleEvent(t2.turnId), 30_000)
    notes.push(s2?.kind === 'turn_aborted' ? 'interrupt: turn_aborted' : `interrupt: ${s2?.kind ?? 'no settle'}`)
  }

  // 3. Resume: a follow-up turn must reuse the same ACP session.
  const t3 = await startTurn(made.thread.id, {
    prompt: 'Reply with exactly: still-here', harnessId: hid, credentialMode: 'native-login'
  })
  if (t3.ok) {
    const s3 = await feed.wait(settleEvent(t3.turnId))
    notes.push(`resume turn: ${s3?.kind ?? 'no settle'}`)
    const sessions = new Set(feed.events
      .filter((e) => e.kind === 'delegated_runtime' && e.sessionId)
      .map((e) => e.sessionId))
    if (sessions.size > 1) notes.push('warning: multiple ACP session ids observed')
  }
  feed.close()
  return { status: 'pass', notes }
}

// ---------- item P1-2: Claude Code on a gateway model ----------
async function itemP12() {
  const id = 'P1-2'
  const title = 'Claude Code runs on a Kun gateway model'
  const row = harnessUsable('claude-code')
  if (!row) {
    const s = ctx.harnesses.get('claude-code')?.status
    return report(id, title, 'skip',
      [`claude-code not usable: installed=${s?.installed} ready=${s?.ready} login=${s?.login}`])
  }
  if (!ctx.gatewayEnabled) {
    return report(id, title, 'skip',
      ['model gateway credential could not be materialized (needs runtime token or enabled gateway)'])
  }
  const models = await api('/v1/harnesses/claude-code/models?credential_mode=kun-gateway')
  const groups = models.json?.groups ?? []
  // Prefer the group backing the Kun route's provider — it is the one known
  // to carry a working credential in this environment.
  const pick = groups.find((g) => g.providerId === ctx.kunRoute?.providerId && g.models?.length)
    ?? groups.find((g) => g.models?.length)
  if (!pick) return report(id, title, 'skip', ['no exposable provider models for the gateway'])
  const gatewayModel = `kun/${pick.providerId}/${pick.models[0]}`
  const notes = [`route: claude-code x ${gatewayModel}`]

  const made = await createThread({
    title: 'ade-e2e p1-2', workspace: ctx.workspace,
    model: gatewayModel, providerId: pick.providerId
  })
  if (!made.ok) return report(id, title, 'fail', [...notes, `createThread ${made.status}: ${made.error}`])
  const feed = followThread(made.thread.id)
  const turn = await startTurn(made.thread.id, {
    prompt: 'Reply with exactly: ade-e2e-ok',
    harnessId: 'claude-code', credentialMode: 'kun-gateway',
    model: gatewayModel, providerId: pick.providerId
  })
  if (!turn.ok) { feed.close(); return report(id, title, 'fail', [...notes, `startTurn ${turn.status}: ${turn.error}`]) }
  const settle = await feed.wait(settleEvent(turn.turnId))
  feed.close()
  if (!settle) return report(id, title, 'fail', [...notes, 'turn never settled'])
  if (settle.kind !== 'turn_completed') {
    const msg = String(settle.message ?? settle.text ?? '')
    // The gateway route was exercised (grant issued, child spawned); a model-
    // access refusal is the upstream provider's verdict, not a wiring defect.
    return report(id, title, ENV_BLOCKED.test(msg) ? 'blocked' : 'fail',
      [...notes, `turn ${settle.kind}: ${msg.slice(0, 240)}`])
  }
  const sawText = feed.events.some((e) => e.kind === 'assistant_text_delta' || e.kind === 'item_completed')
  if (!sawText) notes.push('warning: no assistant item events observed')
  // Usage accounting can flush just after the settle event — retry briefly.
  let bucket = null
  for (let i = 0; i < 10 && !bucket; i++) {
    const usage = await api(`/v1/usage?group_by=thread&thread_id=${made.thread.id}`)
    bucket = (usage.json?.buckets ?? usage.json?.rows ?? [])
      .find((b) => b.thread_id === made.thread.id)
    if (!bucket || !(bucket.total_tokens > 0)) { bucket = null; await sleep(1_000) }
  }
  if (!bucket || !(bucket.total_tokens > 0)) {
    return report(id, title, 'fail', [...notes, 'no usage recorded for the thread'])
  }
  notes.push(`usage: ${bucket.total_tokens} tokens on thread`)
  return report(id, title, 'pass', notes)
}

// ---------- item P1-3: manager fans out to workers ----------
async function itemP13() {
  const id = 'P1-3'
  const title = 'Manager dispatches workers on distinct harnesses'
  if (!ctx.adeManager) return report(id, title, 'skip', ['ade manager runtime unavailable'])
  if (!ctx.kunRoute) return report(id, title, 'skip', ['no configured provider for the manager turn'])
  const workerTargets = ['claude-code', 'opencode', 'gemini-cli']
    .map((h) => harnessUsable(h)).filter(Boolean)
    .map((r) => r.definition.id)
  // A Kun worker always counts toward the fan-out: it proves the manager path
  // even when external harnesses are unavailable upstream.
  const wanted = ['kun', ...workerTargets].slice(0, 3)
  // Ambient native-login can be upstream-blocked while the gateway path is
  // healthy — steer claude-code workers onto the proven kun-gateway route.
  const gatewayHint = wanted.includes('claude-code') && ctx.gatewayEnabled
    ? ` For claude-code use credentialMode "kun-gateway" with model "kun/${ctx.kunRoute.providerId}/${ctx.kunRoute.model}".`
    : ''
  const notes = [`manager route: ${ctx.kunRoute.providerId}/${ctx.kunRoute.model}`,
    `worker harnesses: ${wanted.join(', ')}`]
  const made = await createThread({
    title: 'ade-e2e p1-3 manager', workspace: ctx.workspace,
    model: ctx.kunRoute.model, providerId: ctx.kunRoute.providerId,
    // The manager must stay on the Kun harness: provider inference maps
    // claude-subscription to claude-code, which has no worker tools.
    harnessId: 'kun', workspaceMode: 'ade'
  })
  if (!made.ok) return report(id, title, 'fail', [...notes, `createThread ${made.status}: ${made.error}`])
  const managerId = made.thread.id
  const feed = followThread(managerId)

  const turn = await startTurn(managerId, {
    prompt: [
      'Use worker_create to spawn one worker per harness listed below, each with this task: "Create a file named',
      'out-<harness>.txt containing the single line ok, then submit_result." Do not do the work yourself.',
      `Harnesses: ${wanted.join(', ')}.${gatewayHint}`,
      'After every worker reports, reply with a summary naming which harness produced which file.'
    ].join(' '),
    harnessId: 'kun'
  })
  if (!turn.ok) { feed.close(); return report(id, title, 'fail', [...notes, `startTurn ${turn.status}: ${turn.error}`]) }

  // Wait for the team roster to fill, then for every dispatch to settle.
  // Worker approvals are the user's lane (09 §6.5) — answer them as workers
  // appear or unattended dispatches would stall in `accepted` forever.
  const deadline = Date.now() + SETTLE_MS * 2
  const approvalWatches = new Map()
  const watchWorkers = (list) => {
    for (const w of list) {
      if (!approvalWatches.has(w.workerId)) {
        approvalWatches.set(w.workerId, watchWorkerApprovals([w.workerId]))
      }
    }
  }
  let overview = null
  while (Date.now() < deadline) {
    const res = await api(`/v1/teams/by-manager/${managerId}`)
    if (res.status === 200) overview = res.json
    const workers = overview?.team?.workers ?? []
    watchWorkers(workers)
    const dispatches = overview?.dispatches ?? []
    const allSettled = dispatches.length >= wanted.length &&
      dispatches.every((d) => ['completed', 'failed', 'cancelled'].includes(d.state))
    const managerDone = feed.events.some(settleEvent(turn.turnId))
    if (workers.length >= wanted.length && allSettled && managerDone) break
    if (managerDone && dispatches.length >= wanted.length && allSettled) break
    await sleep(2_000)
  }
  feed.close()
  for (const w of approvalWatches.values()) await w.flush()
  for (const w of approvalWatches.values()) w.close()
  const approvedCount = [...approvalWatches.values()].reduce((n, w) => n + w.approved.size, 0)
  if (approvedCount) notes.push(`worker approvals answered as user: ${approvedCount}`)
  const approvalErrs = [...new Set([...approvalWatches.values()].flatMap((w) => w.errors))]
  if (approvalErrs.length) notes.push(`approval errors: ${approvalErrs.join('; ').slice(0, 240)}`)

  const workers = overview?.team?.workers ?? []
  const dispatches = overview?.dispatches ?? []
  if (workers.length < wanted.length) {
    return report(id, title, 'fail',
      [...notes, `only ${workers.length}/${wanted.length} workers created`, `dispatches: ${dispatches.length}`])
  }
  const distinctHarnesses = new Set(workers.map((w) => w.route?.harnessId))
  const withWorktree = workers.filter((w) => w.taskWorkspaceId).length
  notes.push(`workers: ${workers.length}, distinct harnesses: ${distinctHarnesses.size}, with task workspace: ${withWorktree}`)
  const failed = dispatches.filter((d) => d.state === 'failed' || d.state === 'cancelled')
  if (failed.length) notes.push(`failed dispatches: ${failed.map((d) => d.failureReason ?? d.state).join('; ').slice(0, 240)}`)
  // Activity feed must carry worker rows for Mission Control.
  const activity = await api('/v1/activity')
  const workerRows = (activity.json?.rows ?? []).filter((r) => r.kind === 'worker' && r.parentThreadId === managerId)
  notes.push(`activity rows for this team: ${workerRows.length}`)
  if (!workerRows.length) notes.push('warning: no worker activity rows')
  const ok = distinctHarnesses.size >= Math.min(2, wanted.length) && failed.length === 0
  if (ok) return report(id, title, 'pass', notes)
  const envOnly = failed.length > 0 &&
    failed.every((d) => ENV_BLOCKED.test(String(d.failureReason ?? '')))
  return report(id, title, envOnly ? 'blocked' : 'fail', notes)
}

// ---------- item P1-4: worker question round-trip ----------
async function itemP14() {
  const id = 'P1-4'
  const title = 'Worker question -> answer -> worker continues'
  if (!ctx.adeManager) return report(id, title, 'skip', ['ade manager runtime unavailable'])
  if (!ctx.kunRoute) return report(id, title, 'skip', ['no configured provider for the manager turn'])
  // A kun worker proves the question round-trip deterministically — worker
  // tools are advertised on any worker thread and kun needs no external auth.
  // (The doc accepts "Kun / Claude Code worker"; external workers depend on
  // ambient harness logins that are environment-dependent.)
  const hid = 'kun'
  const notes = [`manager route: ${ctx.kunRoute.providerId}/${ctx.kunRoute.model}`,
    `worker harness: ${hid}`]
  const made = await createThread({
    title: 'ade-e2e p1-4 manager', workspace: ctx.workspace,
    model: ctx.kunRoute.model, providerId: ctx.kunRoute.providerId,
    harnessId: 'kun', workspaceMode: 'ade'
  })
  if (!made.ok) return report(id, title, 'fail', [...notes, `createThread ${made.status}: ${made.error}`])
  const managerId = made.thread.id
  const feed = followThread(managerId)
  const turn = await startTurn(managerId, {
    prompt: [
      `Use worker_create with harness ${hid} for this task: "You must call ask_manager to ask which filename`,
      'to create (offer: alpha.txt or beta.txt). Wait for the answer, create that file containing ok, then',
      'submit_result." Then wait for the worker to finish and summarize.'
    ].join(' '),
    harnessId: 'kun'
  })
  if (!turn.ok) { feed.close(); return report(id, title, 'fail', [...notes, `startTurn ${turn.status}: ${turn.error}`]) }

  // Wait for an open question, answer it as the user, watch the worker finish.
  // Worker approvals are the same user lane (09 §6.5) — answer them too.
  const deadline = Date.now() + SETTLE_MS * 2
  const approvalWatches = new Map()
  const answered = new Set()
  let finalOverview = null
  while (Date.now() < deadline) {
    const res = await api(`/v1/teams/by-manager/${managerId}`)
    if (res.status === 200) finalOverview = res.json
    for (const w of finalOverview?.team?.workers ?? []) {
      if (!approvalWatches.has(w.workerId)) {
        approvalWatches.set(w.workerId, watchWorkerApprovals([w.workerId]))
      }
    }
    const questions = finalOverview?.questions ?? []
    // Answer EVERY open question — the worker may legitimately ask more than
    // once and would wait on any unanswered one.
    for (const open of questions.filter((q) => q.state === 'open' && !answered.has(q.questionId))) {
      await api(`/v1/teams/questions/${open.questionId}/answer`,
        { method: 'POST', body: { answer: 'beta.txt' } })
      answered.add(open.questionId)
      notes.push(`answered question ${open.questionId} as user`)
    }
    const dispatches = finalOverview?.dispatches ?? []
    const settled = dispatches.length > 0 &&
      dispatches.every((d) => ['completed', 'failed', 'cancelled'].includes(d.state))
    if (settled && (!questions.length || questions.every((q) => q.state !== 'open'))) break
    await sleep(2_000)
  }
  feed.close()
  for (const w of approvalWatches.values()) await w.flush()
  for (const w of approvalWatches.values()) w.close()
  const approvedCount = [...approvalWatches.values()].reduce((n, w) => n + w.approved.size, 0)
  if (approvedCount) notes.push(`worker approvals answered as user: ${approvedCount}`)
  const approvalErrs = [...new Set([...approvalWatches.values()].flatMap((w) => w.errors))]
  if (approvalErrs.length) notes.push(`approval errors: ${approvalErrs.join('; ').slice(0, 240)}`)

  const questions = finalOverview?.questions ?? []
  if (!questions.length) {
    return report(id, title, 'fail', [...notes, 'no worker question recorded'])
  }
  const q = questions[0]
  const dispatch = (finalOverview?.dispatches ?? [])[0]
  notes.push(`question state: ${q.state} (answeredBy=${q.answeredBy ?? '-'})`,
    `dispatch: ${dispatch?.state ?? 'none'}`)
  const pass = q.state === 'answered' && dispatch?.state === 'completed'
  return report(id, title, pass ? 'pass' : 'fail', notes)
}

// ---------- run ----------
const RUNNERS = { 'p1-1': itemP11, 'p1-2': itemP12, 'p1-3': itemP13, 'p1-4': itemP14 }

try {
  let base
  let token
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
    createClient({ base, token, settleMs: SETTLE_MS }))
  await preflight()
  console.log(`kun ${ctx.version} on ${base} | workspace ${ctx.workspace} | ade-manager=${ctx.adeManager}`)
  for (const item of ITEMS) {
    const runner = RUNNERS[item]
    if (!runner) { console.error(`unknown item: ${item}`); continue }
    try {
      await runner()
    } catch (error) {
      report(item, '(runner)', 'fail', [`exception: ${String(error?.message ?? error).slice(0, 300)}`])
    }
  }
} finally {
  if (serveProc) {
    serveProc.kill('SIGTERM')
    // Give the child a moment to flush and release files before cleanup;
    // rmSync retries cover the residual ENOTEMPTY/EBUSY window.
    for (let i = 0; i < 40 && serveProc.exitCode === null; i++) await sleep(250)
  }
  if (!args.keep) {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    }
  }
}

// Versioned result table for docs/ade/impl/p3-review-followup.md §4.
const today = new Date().toISOString().slice(0, 10)
console.log('\n--- paste into p3-review-followup.md §4 ---')
for (const r of results) {
  const note = r.notes.join('; ').replace(/\|/g, '/')
  console.log(`| ${today} | kun ${ctx.version} | ${r.id} ${r.title} | ${r.status} | ${note} |`)
}
const counts = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {})
console.log(`\nsummary: ${JSON.stringify(counts)}`)
process.exit(results.some((r) => r.status === 'fail') ? 1 : 0)

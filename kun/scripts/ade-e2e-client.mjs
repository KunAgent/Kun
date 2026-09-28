/**
 * HTTP/SSE client + serve-lifecycle helpers for scripts/ade-e2e.mjs.
 * Split out to keep both files under the 700-line repository gate.
 * Manual/nightly tooling only — never packaged.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KUN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function fail(msg) {
  console.error(`ade-e2e: ${msg}`)
  process.exit(1)
}

async function freePort() {
  const srv = createServer()
  await new Promise((res) => srv.listen(0, '127.0.0.1', res))
  const { port } = srv.address()
  await new Promise((res) => srv.close(res))
  return port
}

/** Force on the capability gates the ADE path needs (ade + delegation + the
 * loopback model gateway that `kun-gateway` credential routes terminate on). */
function withAdeEnabled(user) {
  user.ade = { ...(user.ade ?? {}), enabled: true }
  user.capabilities = { ...(user.capabilities ?? {}) }
  user.capabilities.subagents = { ...(user.capabilities.subagents ?? {}), enabled: true }
  user.serve = { ...(user.serve ?? {}) }
  user.serve.localModelGateway = {
    ...(user.serve.localModelGateway ?? {}), enabled: true, exposeProviderModels: true
  }
  return user
}

function buildConfig(args, dataDir) {
  const cfgPath = join(dataDir, 'config.json')
  if (args.config) {
    const user = JSON.parse(readFileSync(args.config, 'utf8'))
    writeFileSync(cfgPath, JSON.stringify(withAdeEnabled(user), null, 2))
    return cfgPath
  }
  if (!existsSync(cfgPath)) {
    writeFileSync(cfgPath, JSON.stringify(withAdeEnabled({}), null, 2))
  }
  return cfgPath
}

/** Read a provider key without ever echoing it to stdout/stderr or argv. */
function readApiKeyFile(path) {
  const raw = readFileSync(path, 'utf8').trim()
  try {
    const json = JSON.parse(raw)
    const key = json?.entries?.deepseek ?? json?.deepseek ?? json?.apiKey
    if (typeof key === 'string' && key.trim()) return key.trim()
  } catch { /* raw key text */ }
  return raw
}

/**
 * Start `kun serve` on a scratch data dir. A runtime token is generated when
 * the caller did not supply one so admin endpoints (gateway credential
 * ensure) authorize. Returns { base, token, proc, dataDir, cleanupDirs }.
 */
export async function spawnServe(args) {
  const entry = join(KUN_ROOT, 'dist/cli/serve-entry.js')
  if (!existsSync(entry)) {
    fail(`missing ${entry} — run \`npm run build:kun\` first, or use --url`)
  }
  const apiKey = args['api-key-file'] ? readApiKeyFile(args['api-key-file']) : ''
  if (args['api-key-file'] && !apiKey) fail(`no api key found in ${args['api-key-file']}`)
  const dataDir = args['data-dir'] ?? mkdtempSync(join(tmpdir(), 'ade-e2e-data-'))
  const cleanupDirs = args['data-dir'] ? [] : [dataDir]
  mkdirSync(dataDir, { recursive: true })
  const configPath = buildConfig(args, dataDir)
  const port = await freePort()
  const token = args.token ?? process.env.KUN_RUNTIME_TOKEN ?? `ade-e2e-${randomUUID()}`
  const proc = spawn(process.execPath, [entry, 'serve',
    '--data-dir', dataDir, '--config', configPath,
    '--host', '127.0.0.1', '--port', String(port), '--insecure',
    '--runtime-token', token
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      ...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}),
      // Isolate the profile so a second app session is allowed (docs/AGENTS.md).
      KUN_MANAGER_CONTROL_DIR: join(dataDir, 'control'),
      KUN_MANAGER_SETTINGS_PATH: join(dataDir, 'kun-settings.json')
    }
  })
  let stderr = ''
  proc.stderr.on('data', (c) => { stderr = (stderr + c).slice(-16 * 1024) })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      fail(`kun serve exited early (code ${proc.exitCode})\n${stderr}`)
    }
    const ok = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false)
    if (ok) return { base, token, proc, dataDir, cleanupDirs }
    await sleep(250)
  }
  fail(`kun serve did not become healthy on ${base}\n${stderr}`)
}

/** Fresh scratch git repo (or the caller's --workspace), for thread runs. */
export function makeWorkspace(args, cleanupDirs) {
  if (args.workspace) return resolve(args.workspace)
  const dir = mkdtempSync(join(tmpdir(), 'ade-e2e-ws-'))
  cleanupDirs.push(dir)
  const git = (a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git(['init', '-q', '-b', 'main'])
  writeFileSync(join(dir, 'README.md'), '# ade-e2e scratch repo\n')
  git(['-c', 'user.email=ade-e2e@local', '-c', 'user.name=ade-e2e', 'add', '-A'])
  git(['-c', 'user.email=ade-e2e@local', '-c', 'user.name=ade-e2e', 'commit', '-qm', 'init'])
  return dir
}

const settleEvent = (turnId) => (e) =>
  ['turn_completed', 'turn_failed', 'turn_aborted'].includes(e.kind) &&
  (!e.turnId || e.turnId === turnId)

/**
 * Client bound to one serve. Token is the bearer credential; it also signs
 * approval-consent headers the way the GUI host does.
 */
export function createClient({ base, token, settleMs }) {
  const headers = (json) => ({
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {})
  })

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers(Boolean(body)),
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    return { status: res.status, json, text }
  }

  /** Follow a thread's SSE stream; collects every event for assertions. */
  function followThread(threadId) {
    const events = []
    const ac = new AbortController()
    const ready = (async () => {
      const res = await fetch(`${base}/v1/threads/${threadId}/events`, {
        headers: headers(false),
        signal: ac.signal
      })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let cut
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          const dataLines = [...block.matchAll(/^data: (.*)$/gm)].map((m) => m[1])
          if (!dataLines.length) continue
          try { events.push(JSON.parse(dataLines.join('\n'))) } catch { /* markers */ }
        }
      }
    })().catch(() => {})
    return {
      events,
      ready,
      /** Wait until pred(event) matches a collected event; returns it or null. */
      async wait(pred, ms = settleMs) {
        const deadline = Date.now() + ms
        while (Date.now() < deadline) {
          const hit = events.find(pred)
          if (hit) return hit
          await sleep(200)
        }
        return null
      },
      close() { ac.abort() }
    }
  }

  async function createThread(body) {
    const res = await api('/v1/threads', { method: 'POST', body })
    if (res.status !== 201) {
      return { ok: false, status: res.status, error: res.text.slice(0, 500) }
    }
    return { ok: true, thread: res.json }
  }

  async function startTurn(threadId, body) {
    const res = await api(`/v1/threads/${threadId}/turns`, { method: 'POST', body })
    if (res.status >= 300) return { ok: false, status: res.status, error: res.text.slice(0, 500) }
    return { ok: true, turnId: res.json.turnId }
  }

  /**
   * Approval-consent token (x-kun-approval-consent), minted the same way the
   * GUI host does — HMAC over the approval id + decision, signed with the
   * runtime token this script spawned/attached with.
   */
  function approvalConsent(approvalId, decision) {
    const expiresAt = Date.now() + 30_000
    const nonce = randomBytes(24).toString('base64url')
    const payload = `v1\n${approvalId}\n${decision}\n${expiresAt}\n${nonce}`
    const sig = createHmac('sha256', token).update(payload).digest('base64url')
    return `v1.${expiresAt}.${nonce}.${sig}`
  }

  /** Resolve a pending approval as the user (09 §6.5 worker approval lane). */
  async function decideApproval(approvalId, decision = 'allow') {
    const res = await fetch(`${base}/v1/approvals/${approvalId}`, {
      method: 'POST',
      headers: { ...headers(true), 'x-kun-approval-consent': approvalConsent(approvalId, decision) },
      body: JSON.stringify({ decision })
    })
    return res.status
  }

  /** Allow every still-pending approval_request seen on the given feeds.
   * Only a <300 decision counts as answered — failures are retried on the
   * next sweep and recorded in `errors`. */
  async function sweepApprovals(feeds, approved, errors) {
    for (const feed of feeds) {
      const resolved = new Set(feed.events
        .filter((e) => e.kind === 'approval_resolved')
        .map((e) => e.approvalId))
      for (const e of feed.events) {
        if (e.kind !== 'approval_requested' || e.status !== 'pending') continue
        if (resolved.has(e.approvalId) || approved.has(e.approvalId)) continue
        const status = await decideApproval(e.approvalId).catch(() => 0)
        if (status > 0 && status < 300) approved.add(e.approvalId)
        else errors.push(`approval ${e.approvalId} -> ${status}`)
      }
    }
  }

  /**
   * Watch worker threads over SSE: every `approval_requested` still pending
   * is auto-allowed inside the scratch workspace — this is the user lane
   * from 09 §6.5, which unattended worker turns would otherwise block on
   * forever. Returns {approved, flush, close}.
   */
  function watchWorkerApprovals(workerIds) {
    const approved = new Set()
    const errors = []
    const feeds = [...workerIds].map((id) => followThread(id))
    const timer = setInterval(() => { sweepApprovals(feeds, approved, errors) }, 1_000)
    return {
      approved,
      errors,
      /** One final sweep so a just-arrived request is not missed at cutoff. */
      flush: () => sweepApprovals(feeds, approved, errors),
      close() { clearInterval(timer); for (const f of feeds) f.close() }
    }
  }

  return {
    api, followThread, createThread, startTurn,
    decideApproval, watchWorkerApprovals, settleEvent
  }
}

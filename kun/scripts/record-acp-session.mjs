#!/usr/bin/env node
/**
 * Records a real ACP agent's wire traffic into a sanitized JSONL fixture for
 * replay tests (docs/ade/03 §13.3). Manual/nightly tool only — it requires the
 * real CLI binary to be installed and authenticated.
 *
 * Usage:
 *   node scripts/record-acp-session.mjs <harness-id> <command> [args...]
 *
 * Example:
 *   node scripts/record-acp-session.mjs gemini gemini --experimental-acp
 *
 * Output: src/runtime/acp/__fixtures__/recorded/<harness-id>-<agentVersion>.jsonl
 * Line format matches the fake agent's journal:
 *   {"dir":"in"|"out","frame":<json-rpc>}   one per wire message
 *   {"dir":"event","kind":<marker>}         recorder-side annotations
 * Secret-bearing fields (tokens, keys, auth values) are redacted; $HOME is
 * replaced with "~" so fixtures never leak the recorder's environment.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [harnessId, command, ...args] = process.argv.slice(2)
if (!harnessId || !command) {
  console.error(
    'Usage: record-acp-session.mjs <harness-id> <command> [args...]\n' +
      '  e.g. record-acp-session.mjs gemini gemini --experimental-acp'
  )
  process.exit(2)
}

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/runtime/acp/__fixtures__/recorded'
)
mkdirSync(outDir, { recursive: true })

const HOME = homedir()
const SECRET_KEYS = /token|secret|api_?key|password|credential|auth(?!MethodId)/i

function sanitize(value) {
  if (typeof value === 'string') {
    return value.split(HOME).join('~')
  }
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) && typeof v === 'string' ? '<redacted>' : sanitize(v)
    }
    return out
  }
  return value
}

const lines = []
function journal(dir, frame) {
  lines.push(JSON.stringify({ dir, frame: sanitize(frame) }))
}
function event(kind, extra) {
  lines.push(JSON.stringify({ dir: 'event', kind, ...(extra ? sanitize(extra) : {}) }))
}

const child = spawn(command, args, {
  cwd: tmpdir(),
  env: { PATH: process.env.PATH, HOME: process.env.HOME },
  stdio: ['pipe', 'pipe', 'pipe']
})
let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8')
  if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024)
})

let nextId = 1
const pending = new Map()
const rl = createInterface({ input: child.stdout })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let frame
  try {
    frame = JSON.parse(trimmed)
  } catch {
    event('nonJson', { line: trimmed.slice(0, 200) })
    return
  }
  journal('out', frame)
  if (frame.id !== undefined && pending.has(frame.id)) {
    const { resolve, reject } = pending.get(frame.id)
    pending.delete(frame.id)
    if (frame.error) reject(new Error(JSON.stringify(frame.error)))
    else resolve(frame.result)
    return
  }
  // Agent->client requests (fs, terminal, permission): answer minimally so the
  // agent proceeds; journal stays faithful to what was actually sent.
  if (frame.method && frame.id !== undefined) {
    const result = answerClientRequest(frame)
    const reply = { jsonrpc: '2.0', id: frame.id, result }
    journal('in', reply)
    child.stdin.write(JSON.stringify(reply) + '\n')
  }
})

function request(method, params) {
  const id = nextId++
  const frame = { jsonrpc: '2.0', id, method, params }
  journal('in', frame)
  child.stdin.write(JSON.stringify(frame) + '\n')
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`))
    }, 60_000)
  })
}
function notify(method, params) {
  const frame = { jsonrpc: '2.0', method, params }
  journal('in', frame)
  child.stdin.write(JSON.stringify(frame) + '\n')
}

function answerClientRequest(frame) {
  event('clientRequest', { method: frame.method })
  switch (frame.method) {
    case 'fs/read_text_file':
      return { content: 'recorded file content\n' }
    case 'fs/write_text_file':
      return {}
    case 'session/request_permission': {
      const options = frame.params?.options ?? []
      const allow =
        options.find((o) => /allow_once|allow-once/i.test(o.optionId ?? o.kind ?? '')) ??
        options.find((o) => /allow/i.test(o.optionId ?? o.kind ?? '')) ??
        options[0]
      return { outcome: { outcome: 'selected', optionId: allow?.optionId ?? 'allow_once' } }
    }
    case 'terminal/create':
      return { terminalId: 'recorded-terminal-1' }
    case 'terminal/output':
      return { output: '', truncated: false, exitStatus: null }
    case 'terminal/wait_for_exit':
      return { exitStatus: { exitCode: 0, signal: null } }
    case 'terminal/kill':
    case 'terminal/release':
      return {}
    default:
      return {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true
    },
    clientInfo: { name: 'kun-acp-recorder', version: '0.0.0' }
  })
  event('initialized', { protocolVersion: init?.protocolVersion })

  const session = await request('session/new', { cwd: tmpdir(), mcpServers: [] })
  event('session', { sessionId: session?.sessionId })
  const sessionId = session?.sessionId
  if (!sessionId) throw new Error('session/new returned no sessionId')

  const prompt = request('session/prompt', {
    sessionId,
    prompt: [
      {
        type: 'text',
        text: 'Reply with the word "ok", then run `echo recorded` if a terminal is available.'
      }
    ]
  })
  // Let streaming updates flow, then exercise cancel on a second prompt.
  const result = await prompt
  event('promptDone', { stopReason: result?.stopReason })

  const second = request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'Count slowly to 100.' }]
  }).catch((err) => ({ error: String(err) }))
  await sleep(1_000)
  notify('session/cancel', { sessionId })
  await second
  event('cancelDone')

  await writeFileSync(join(outDir, `${harnessId}-draft.jsonl`), lines.join('\n') + '\n')
  return init?.agentInfo?.version ?? 'unknown'
}

main()
  .then(async (version) => {
    const draft = join(outDir, `${harnessId}-draft.jsonl`)
    const final = join(outDir, `${harnessId}-${version}.jsonl`)
    const { renameSync } = await import('node:fs')
    renameSync(draft, final)
    console.log(`recorded ${lines.length} frames -> ${final}`)
    child.kill()
    process.exit(0)
  })
  .catch((err) => {
    appendFileSync(
      join(outDir, `${harnessId}-failed.jsonl`),
      lines.join('\n') + '\n' + JSON.stringify({ dir: 'event', kind: 'error', message: String(err) })
    )
    console.error(`recording failed: ${err}\nstderr tail:\n${stderr.slice(-2000)}`)
    child.kill()
    process.exit(1)
  })

#!/usr/bin/env node
/**
 * Minimal scripted ACP agent for tests. Reads newline-delimited JSON-RPC from
 * stdin and answers per a scenario JSON file at FAKE_ACP_SCENARIO.
 *
 * Scenario shape:
 * {
 *   "initialize": { ...result } | { "error": {code,message} },
 *   "sessionId": "sess-1",
 *   "newSession": { "modes": ..., "configOptions": [...] },
 *   "loadSession": { "error": {...} } | { "modes": ..., "configOptions": [...] },
 *   "onLoad":   { "updates": [sessionUpdate, ...] },   // replayed during load
 *   "onNew":    { "updates": [...] },
 *   "turns": [ {
 *     "promptIncludes": "substring" | null,
 *     "steps": [
 *       { "update": sessionUpdate },
 *       { "clientRequest": { "method": "...", "params": {...},
 *                            "expect": { "deep-equal subset": "..." } } },
 *       { "raw": "literal bytes" },
 *       { "sleep": 50 }
 *     ],
 *     "stopReason": "end_turn",
 *     "response": {...},          // custom result instead of {stopReason}
 *     "error": {"code":..,"message":..},
 *     "crash": {"stderr": "...", "code": 3},
 *     "neverRespond": true
 *   } ],
 *   "onCancel": { "settle": "cancelled" | "ignore", "updates": [...] }
 * }
 *
 * When FAKE_ACP_JOURNAL is set, every frame in both directions is appended as
 * JSONL ({dir:'in'|'out', frame}) plus {"dir":"event","kind":...} markers for
 * clientRequest settlements and prompt responses — tests assert on the wire
 * sequence without depending on timing.
 */
import { createInterface } from 'node:readline'
import { appendFileSync, readFileSync } from 'node:fs'

const scenario = JSON.parse(readFileSync(process.env.FAKE_ACP_SCENARIO, 'utf8'))
const journalPath = process.env.FAKE_ACP_JOURNAL
const sessions = new Set()
const pendingClientRequests = new Map()
const pendingPrompts = new Map()
let nextAgentRequestId = 1
let turnCursor = 0

function journal(dir, frame) {
  if (!journalPath) return
  try {
    appendFileSync(journalPath, JSON.stringify({ dir, frame }) + '\n')
  } catch {
    // journaling must never break the fixture
  }
}

function send(frame) {
  journal('out', frame)
  process.stdout.write(JSON.stringify(frame) + '\n')
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result: result ?? {} })
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function emitUpdate(sessionId, update) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })
}

async function clientRequest(method, params, sessionId) {
  const id = `agent-${nextAgentRequestId++}`
  const merged = sessionId ? { sessionId, ...params } : params
  return new Promise((resolve) => {
    pendingClientRequests.set(id, resolve)
    send({ jsonrpc: '2.0', id, method, params: merged })
  })
}

function expectSubset(actual, expect, path) {
  if (expect === null || typeof expect !== 'object') return actual === expect
  if (typeof actual !== 'object' || actual === null) return false
  return Object.entries(expect).every(([key, value]) =>
    expectSubset(actual[key], value, `${path}.${key}`)
  )
}

function promptText(params) {
  const blocks = params?.prompt ?? []
  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
}

function pickTurn(params) {
  const text = promptText(params)
  const turns = scenario.turns ?? []
  const byMatch = turns.findIndex(
    (turn) => !turn.used && turn.promptIncludes && text.includes(turn.promptIncludes)
  )
  const index = byMatch >= 0 ? byMatch : turns.findIndex((turn) => !turn.used && !turn.promptIncludes)
  if (index < 0) return undefined
  const turn = turns[index]
  turn.used = true
  return turn
}

async function runPrompt(id, params) {
  const turn = pickTurn(params)
  if (!turn) {
    respondError(id, -32603, 'fake agent: no scripted turn for this prompt')
    return
  }
  const sessionId = params.sessionId
  pendingPrompts.set(sessionId, { id })
  for (const step of turn.steps ?? []) {
    if (step.sleep) {
      await new Promise((resolve) => setTimeout(resolve, step.sleep))
      continue
    }
    if (step.raw !== undefined) {
      journal('out', { raw: step.raw })
      process.stdout.write(step.raw)
      continue
    }
    if (step.update) {
      emitUpdate(sessionId, step.update)
      continue
    }
    if (step.clientRequest) {
      const { method, params: reqParams, expect } = step.clientRequest
      const response = await clientRequest(method, reqParams ?? {}, sessionId)
      journal('event', {
        kind: 'clientRequestSettled',
        method,
        response,
        ...(expect && !expectSubset(response, expect, 'response')
          ? { mismatch: { expect, actual: response } }
          : {})
      })
      continue
    }
    if (step.respond) {
      respond(id, step.respond)
      pendingPrompts.delete(sessionId)
      return
    }
  }
  if (turn.crash) {
    if (turn.crash.stderr) process.stderr.write(turn.crash.stderr + '\n')
    process.stderr.end(() => process.exit(turn.crash.code ?? 3))
    setTimeout(() => process.exit(turn.crash.code ?? 3), 1_000).unref()
    return
  }
  if (turn.neverRespond) return // stays in pendingPrompts; cancel may settle it
  if (turn.error) {
    respondError(id, turn.error.code, turn.error.message)
  } else if (turn.response !== undefined) {
    respond(id, turn.response)
  } else {
    respond(id, { stopReason: turn.stopReason ?? 'end_turn' })
  }
  pendingPrompts.delete(sessionId)
}

function handleCancel(params) {
  const sessionId = params?.sessionId
  const pending = pendingPrompts.get(sessionId)
  const onCancel = scenario.onCancel ?? { settle: 'cancelled' }
  for (const update of onCancel.updates ?? []) emitUpdate(sessionId, update)
  if (pending && onCancel.settle !== 'ignore') {
    respond(pending.id, { stopReason: 'cancelled' })
    pendingPrompts.delete(sessionId)
  }
}

async function handleRequest(id, method, params) {
  switch (method) {
    case 'initialize': {
      const init = scenario.initialize ?? {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: scenario.loadSession !== undefined,
          promptCapabilities: { image: true, embeddedContext: true },
          mcpCapabilities: { http: false }
        },
        authMethods: []
      }
      if (init.error) respondError(id, init.error.code, init.error.message)
      else respond(id, init)
      return
    }
    case 'authenticate':
      respond(id, scenario.authenticate ?? {})
      return
    case 'session/new': {
      if (scenario.newSession?.error) {
        respondError(id, scenario.newSession.error.code, scenario.newSession.error.message)
        return
      }
      const sessionId = scenario.sessionId ?? `sess-${sessions.size + 1}`
      sessions.add(sessionId)
      respond(id, { sessionId, ...(scenario.newSession ?? {}) })
      for (const update of scenario.onNew?.updates ?? []) emitUpdate(sessionId, update)
      return
    }
    case 'session/load': {
      const load = scenario.loadSession
      if (load?.error) {
        respondError(id, load.error.code, load.error.message)
        return
      }
      sessions.add(params.sessionId)
      for (const update of scenario.onLoad?.updates ?? []) emitUpdate(params.sessionId, update)
      respond(id, load ?? {})
      return
    }
    case 'session/prompt':
      await runPrompt(id, params)
      return
    case 'session/set_config_option':
    case 'session/set_model':
    case 'session/set_mode':
      journal('event', { kind: 'configSet', method, params })
      respond(id, {})
      return
    default:
      respondError(id, -32601, `Method not found: ${method}`)
  }
}

function handleResponse(frame) {
  const pending = pendingClientRequests.get(frame.id)
  if (!pending) return
  pendingClientRequests.delete(frame.id)
  pending(frame.error ? { error: frame.error } : { result: frame.result })
}

async function handleLine(line) {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return // malformed inbound: ignore
  }
  journal('in', frame)
  if (frame.method !== undefined && frame.id !== undefined) {
    await handleRequest(frame.id, frame.method, frame.params ?? {})
    return
  }
  if (frame.method !== undefined) {
    if (frame.method === 'session/cancel') handleCancel(frame.params)
    else journal('event', { kind: 'notification', method: frame.method })
    return
  }
  if (frame.id !== undefined) handleResponse(frame)
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  handleLine(line).catch((error) => {
    process.stderr.write(`fake agent error: ${error.message}\n`)
  })
})
rl.on('close', () => process.exit(0))

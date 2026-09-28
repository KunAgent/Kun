/**
 * Playback tests over real recorded ACP wire traffic (docs/ade impl P3-12).
 * Recordings live in `__fixtures__/recorded/` as sanitized JSONL journals
 * produced by `kun/scripts/record-acp-session.mjs`; each frame is replayed
 * through the production schemas and the event mapper so upstream drift in
 * a real agent surfaces here.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { AcpEventMapper } from './acp-event-mapper.js'
import {
  AcpInitializeResultSchema,
  AcpJsonRpcFrameSchema,
  AcpNewSessionResultSchema,
  AcpPromptResultSchema,
  parseAcpSessionNotification,
  type AcpJsonRpcFrame
} from './acp-schema.js'

const RECORDED = fileURLToPath(
  new URL('./__fixtures__/recorded/', import.meta.url)
)

type JournalLine = {
  dir: 'in' | 'out' | 'event'
  kind?: string
  frame?: Record<string, unknown>
}

function recorded(name: string): JournalLine[] {
  return readFileSync(`${RECORDED}${name}`, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JournalLine)
}

/** Every frame passes the wire envelope schema — no malformed traffic. */
function frames(name: string): AcpJsonRpcFrame[] {
  return recorded(name)
    .filter((line) => line.dir !== 'event' && line.frame)
    .map((line) => {
      const parsed = AcpJsonRpcFrameSchema.safeParse(line.frame)
      expect(parsed.success).toBe(true)
      return parsed.data!
    })
}

function makeMapper(): AcpEventMapper {
  let n = 0
  return new AcpEventMapper({
    threadId: 'thread_1',
    turnId: 'turn_1',
    harnessId: 'opencode',
    model: 'recorded-model',
    nextId: (prefix) => `${prefix}_${++n}`,
    nowIso: () => '2026-01-01T00:00:00.000Z'
  })
}

describe('recorded ACP sessions (P3-12)', () => {
  test('opencode 1.1.47: initialize + session/new parse and the update maps', () => {
    const all = frames('opencode-1.1.47.jsonl')

    // initialize result — real capability advertisement from the binary.
    const init = AcpInitializeResultSchema.safeParse(
      all.find((f) => f.id === 1 && f.result)?.result
    )
    expect(init.success).toBe(true)
    expect(init.data?.agentInfo?.version).toBe('1.1.47')
    expect(init.data?.protocolVersion).toBe(1)

    // session/new carries the real models + modes sections.
    const session = AcpNewSessionResultSchema.safeParse(
      all.find((f) => f.id === 2 && f.result)?.result
    )
    expect(session.success).toBe(true)
    expect(session.data?.sessionId).toMatch(/^ses_/)

    // Prompt responses parse; the session/update notification feeds the mapper.
    for (const frame of all.filter((f) => 'result' in f && (f.id === 3 || f.id === 4))) {
      expect(AcpPromptResultSchema.safeParse(frame.result).success).toBe(true)
    }
    const mapper = makeMapper()
    const drafts: RuntimeEventDraft[] = []
    for (const frame of all) {
      if (frame.method !== 'session/update') continue
      const { update } = parseAcpSessionNotification(frame.params)
      drafts.push(...mapper.apply(update))
    }
    // The recorded update was a real available_commands_update — it must map
    // to a harness_session_state draft carrying OpenCode's command list.
    const kinds = drafts.map((d) => d.kind)
    expect(kinds).toContain('harness_session_state')
    const state = drafts.find((d) => d.kind === 'harness_session_state') as
      | { commands?: Array<{ name: string }> }
      | undefined
    expect(state?.commands?.map((c) => c.name)).toEqual([
      'init',
      'review',
      'compact'
    ])
  })

  test('gemini 0.52.0: initialize succeeds; session/new reports the upstream block', () => {
    const all = frames('gemini-0.52.0-session-new-blocked.jsonl')
    const init = AcpInitializeResultSchema.safeParse(
      all.find((f) => f.id === 1 && f.result)?.result
    )
    expect(init.success).toBe(true)
    expect(init.data?.protocolVersion).toBe(1)
    // Individual Google accounts are refused at session/new by Gemini Code
    // Assist — the wire error must remain a well-formed JSON-RPC error frame.
    const sessionNew = all.find((f) => f.id === 2 && 'error' in f)
    expect(sessionNew?.error).toMatchObject({ code: -32000 })
    expect(String(sessionNew?.error?.message)).toContain('no longer supported')
  })
})

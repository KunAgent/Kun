import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dispatchRequest } from '../../src/server/http-server.js'
import { createApprovalRequest } from '../../src/domain/approval.js'
import { makeAssistantTextItem, makeToolCallItem, makeToolResultItem } from '../../src/domain/item.js'
import { encodeSseEvent } from '../../src/server/sse.js'
import { buildHarness, readJson, readSseEvents, usageSnapshot } from '../http-server-test-harness.js'
import type { TurnItem } from '../../src/contracts/items.js'
import {
  createApprovalConsentToken,
  KUN_APPROVAL_CONSENT_HEADER
} from '../../src/server/approval-consent.js'

describe('HTTP server', () => {
  let dataDir = ''
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-http-'))
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  const approvalConsent = (approvalId: string, decision: 'allow' | 'deny') =>
    createApprovalConsentToken({
      runtimeToken: 'tok-1',
      approvalId,
      decision,
      expiresAt: Date.now() + 30_000
    })

  it('starts a turn and serves the SSE backlog', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { threadId: string; turnId: string }
    expect(turnBody.threadId).toBe(thread.id)
    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const detailBody = (await readJson(detail)) as {
      latestSeq: number
      turns: Array<{ items: Array<{ kind: string }> }>
    }
    expect(detailBody.latestSeq).toBeGreaterThan(0)
    expect(detailBody.turns.at(-1)?.items.some((item) => item.kind === 'user_message')).toBe(true)
    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events?since_seq=0`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const events = await readSseEvents(eventStream)
    const kinds = events.flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('event:'))
        .map((line) => line.slice(7))
    )
    expect(kinds).toContain('turn_started')
  })

  it('hydrates thread detail items from the session log when the thread snapshot lags', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_lag', title: 'Lagging snapshot' }
    )
    const { turnId } = await h.turnService.startTurn({
      threadId: 'thr_lag',
      request: { prompt: 'hi' }
    })
    await h.sessionStore.appendItem('thr_lag', makeAssistantTextItem({
      id: 'item_answer',
      turnId,
      threadId: 'thr_lag',
      text: 'hello after reload',
      status: 'completed'
    }))
    const snapshot = await h.threadService.get('thr_lag')
    expect(snapshot?.turns.at(-1)?.items.map((item) => item.kind)).toEqual(['user_message'])

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_lag', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      turns: Array<{ items: Array<{ kind: string; text?: string }> }>
    }
    expect(body.turns.at(-1)?.items.map((item) => item.kind)).toEqual(['user_message', 'assistant_text'])
    expect(body.turns.at(-1)?.items.at(-1)).toMatchObject({
      kind: 'assistant_text',
      text: 'hello after reload'
    })
  })

  it('heals stale open session items for finished turns when loading thread detail', async () => {
    const h = buildHarness()
    await h.threadService.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_heal', title: 'Stale session' }
    )
    const { turnId } = await h.turnService.startTurn({
      threadId: 'thr_heal',
      request: { prompt: 'run a tool' }
    })
    await h.turnService.applyItem(
      'thr_heal',
      makeToolCallItem({
        id: 'item_tool_stale',
        turnId,
        threadId: 'thr_heal',
        callId: 'call_stale',
        toolName: 'echo',
        arguments: { text: 'hi' }
      })
    )
    await h.turnService.applyItem(
      'thr_heal',
      makeToolResultItem({
        id: 'item_result_stale',
        turnId,
        threadId: 'thr_heal',
        callId: 'call_stale',
        toolName: 'echo',
        output: { partial: true },
        status: 'running'
      })
    )
    const staleThread = await h.threadStore.get('thr_heal')
    if (!staleThread) throw new Error('expected thread')
    const finishedAt = '2026-06-05T00:00:00.000Z'
    await h.threadStore.upsert({
      ...staleThread,
      status: 'idle',
      turns: staleThread.turns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              status: 'aborted',
              finishedAt,
              items: turn.items.map((item): TurnItem =>
                item.id === 'item_tool_stale' || item.id === 'item_result_stale'
                  ? ({ ...item, status: 'aborted', finishedAt } as TurnItem)
                  : item
              )
            }
          : turn
      )
    })
    const staleById = new Map((await h.sessionStore.loadItems('thr_heal')).map((item) => [item.id, item.status]))
    expect(staleById.get('item_tool_stale')).toBe('pending')
    expect(staleById.get('item_result_stale')).toBe('running')

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads/thr_heal', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      turns: Array<{ id: string; items: Array<{ id: string; status: string }> }>
    }
    const responseItems = new Map(
      (body.turns.find((turn) => turn.id === turnId)?.items ?? []).map((item) => [item.id, item.status])
    )
    expect(responseItems.get('item_tool_stale')).toBe('aborted')
    expect(responseItems.get('item_result_stale')).toBe('aborted')
    const healedById = new Map((await h.sessionStore.loadItems('thr_heal')).map((item) => [item.id, item.status]))
    expect(healedById.get('item_tool_stale')).toBe('aborted')
    expect(healedById.get('item_result_stale')).toBe('aborted')
  })

  it('persists GUI plan context from start-turn requests', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: '/tmp',
            relativePath: '.deepseekgui/plan/auth.md',
            planId: '/tmp:.deepseekgui/plan/auth.md',
            sourceRequest: 'Add auth',
            title: 'Auth'
          }
        })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { turnId: string }
    const detail = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns/${turnBody.turnId}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(detail.status).toBe(200)
    const detailBody = (await readJson(detail)) as { guiPlan?: { relativePath?: string; operation?: string } }
    expect(detailBody.guiPlan).toMatchObject({
      operation: 'draft',
      relativePath: '.deepseekgui/plan/auth.md'
    })
  })

  it('groups usage by the usage event model instead of the thread default model', async () => {
    const h = buildHarness()
    const today = new Date().toISOString().slice(0, 10)
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    expect(create.status).toBe(201)
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)
    const turnBody = (await readJson(turn)) as { turnId: string }
    await h.runtime.events.record({
      kind: 'usage',
      threadId: thread.id,
      turnId: turnBody.turnId,
      model: 'deepseek-v4-pro',
      usage: usageSnapshot({ promptTokens: 30, completionTokens: 10, totalTokens: 40 })
    })

    const usage = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/usage?group_by=model&from=${today}&to=${today}&timezone=UTC`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(usage.status).toBe(200)
    const body = (await readJson(usage)) as {
      buckets: Array<{ model: string; total_tokens: number }>
    }
    expect(body.buckets).toEqual([
      expect.objectContaining({
        model: 'deepseek-v4-pro',
        total_tokens: 40
      })
    ])
  })

  it('replays SSE backlog from Last-Event-ID when since_seq is omitted', async () => {
    const h = buildHarness()
    const create = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: '/tmp', model: 'deepseek-chat' })
      })
    )
    const thread = (await readJson(create)) as { id: string }
    const turn = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/turns`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' })
      })
    )
    expect(turn.status).toBe(202)

    const allEvents = await h.sessionStore.loadEventsSince(thread.id, 0)
    const secondSeq = allEvents[1]?.seq ?? 0
    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events`, {
        headers: { authorization: 'Bearer tok-1', 'Last-Event-ID': String(secondSeq) }
      })
    )
    const events = await readSseEvents(eventStream)
    const ids = events.flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('id:'))
        .map((line) => Number(line.slice(3).trim()))
    )
    expect(ids.every((id) => id > secondSeq)).toBe(true)
  })

  it('delivers an event exactly once when it lands in both backlog and live bus', async () => {
    const h = buildHarness()
    const thread = await h.threadService.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_dedup', title: 'Dedup' }
    )
    const recorded = await h.runtime.events.record({ kind: 'heartbeat', threadId: thread.id })

    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events?since_seq=0`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    // Simulate the persist/publish race: the event is already in the replayed
    // backlog when the live bus re-delivers it after the subscription starts.
    await new Promise((resolve) => setTimeout(resolve, 20))
    h.bus.publish(recorded)

    const frames = await readSseEvents(eventStream)
    const occurrences = frames.filter((frame) => frame.includes(`id: ${recorded.seq}\n`))
    expect(occurrences).toHaveLength(1)
  })

  it('skips SSE backlog replay when the client is already caught up', async () => {
    const h = buildHarness()
    const thread = await h.threadService.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_caught_up', title: 'Caught up' }
    )
    const latestSeq = await h.sessionStore.highestSeq(thread.id)
    const loadEventsSince = vi.spyOn(h.sessionStore, 'loadEventsSince')

    const eventStream = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/threads/${thread.id}/events?since_seq=${latestSeq}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const events = await readSseEvents(eventStream)

    expect(events).toHaveLength(1)
    expect(events[0]).toContain('event: replay_synchronized')
    expect(events[0]).toContain(`"cursor":${latestSeq}`)
    expect(loadEventsSince).not.toHaveBeenCalled()
  })
})

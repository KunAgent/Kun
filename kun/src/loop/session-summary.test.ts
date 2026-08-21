import { describe, expect, it } from 'vitest'
import { makeGoalContextItem, makeUserItem } from '../domain/item.js'
import { buildSessionTranscript, generateSessionSummary } from './session-summary.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'

function clientFrom(build: () => AsyncIterable<ModelStreamChunk>): ModelClient {
  return { provider: 'test', model: 'deepseek-chat', stream: () => build() }
}

function conversation(): ReturnType<typeof makeUserItem>[] {
  return [
    makeUserItem({
      id: 'item_user',
      threadId: 'thread_summary',
      turnId: 'turn_summary',
      text: 'Why did the deploy fail?'
    })
  ]
}

describe('buildSessionTranscript', () => {
  it('never emits model-only goal context into a public summary transcript', () => {
    const user = makeUserItem({
      id: 'item_summary_user',
      threadId: 'thread_summary',
      turnId: 'turn_summary',
      text: 'Summarize this conversation.'
    })
    const goal = makeGoalContextItem({
      id: 'item_summary_goal',
      threadId: 'thread_summary',
      turnId: 'turn_summary',
      goalKey: 'goal_summary',
      text: 'Internal goal instruction that must not reach a public summary.'
    })

    const transcript = buildSessionTranscript([user, goal], 4_096)

    expect(transcript).toContain('Summarize this conversation.')
    expect(transcript).not.toContain('Internal goal instruction')
    expect(transcript).not.toContain('[goal_context]')
  })
})

describe('generateSessionSummary outcomes (#1200)', () => {
  it('returns the collected text on success', async () => {
    const modelClient = clientFrom(async function* stream() {
      yield { kind: 'assistant_text_delta', text: 'The deploy failed on a  missing secret.' }
    })

    await expect(generateSessionSummary({
      threadId: 'thread_summary',
      modelClient,
      model: 'deepseek-chat',
      items: conversation()
    })).resolves.toEqual({ ok: true, summary: 'The deploy failed on a missing secret.' })
  })

  it('separates a timed-out summary from a caller-cancelled one', async () => {
    const modelClient = clientFrom(async function* stream() {
      await new Promise((resolve) => setTimeout(resolve, 50))
      yield { kind: 'assistant_text_delta', text: 'too late' }
    })

    await expect(generateSessionSummary({
      threadId: 'thread_summary',
      modelClient,
      model: 'deepseek-chat',
      items: conversation(),
      timeoutMs: 5
    })).resolves.toEqual({ ok: false, reason: 'timeout', timeoutMs: 5 })

    const cancelled = new AbortController()
    cancelled.abort()
    await expect(generateSessionSummary({
      threadId: 'thread_summary',
      modelClient,
      model: 'deepseek-chat',
      items: conversation(),
      abortSignal: cancelled.signal
    })).resolves.toEqual({ ok: false, reason: 'aborted' })
  })

  it('carries the provider message and code out of an error chunk', async () => {
    const modelClient = clientFrom(async function* stream() {
      yield { kind: 'error', message: 'insufficient balance', code: 'payment_required' }
    })

    await expect(generateSessionSummary({
      threadId: 'thread_summary',
      modelClient,
      model: 'deepseek-chat',
      items: conversation()
    })).resolves.toEqual({
      ok: false,
      reason: 'model_error',
      message: 'insufficient balance',
      code: 'payment_required'
    })
  })

  it('reports an empty answer and an unreadable transcript apart', async () => {
    const silent = clientFrom(async function* stream() {
      yield { kind: 'assistant_text_delta', text: '  ' }
    })

    await expect(generateSessionSummary({
      threadId: 'thread_summary',
      modelClient: silent,
      model: 'deepseek-chat',
      items: conversation()
    })).resolves.toEqual({ ok: false, reason: 'empty_output' })

    await expect(generateSessionSummary({
      threadId: 'thread_summary',
      modelClient: silent,
      model: 'deepseek-chat',
      items: []
    })).resolves.toEqual({ ok: false, reason: 'empty_transcript' })
  })
})

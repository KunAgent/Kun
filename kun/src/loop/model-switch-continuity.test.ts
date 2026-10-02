import { makeUserItem } from '../domain/item.js'
import { expect, it } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import { ContextCompactor } from './context-compactor.js'
import { modelContextProfilesFromConfig, modelCapabilitiesForModel } from './model-context-profile.js'
import { estimateModelRequestInputTokens } from './model-request-estimator.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'

it('keeps one canonical history through repeated large-small-large window changes', async () => {
  const profiles = modelContextProfilesFromConfig({ models: { profiles: {
    large: { contextWindowTokens: 128_000, maxOutputTokens: 1024 },
    small: { contextWindowTokens: 16_000, maxOutputTokens: 1024 }
  } } })
  const seen: ModelRequest[] = []
  const model: ModelClient = { provider: 'test', model: 'large', async *stream(request) {
    seen.push(request)
    yield { kind: 'assistant_text_delta', text: 'COMPLETED evidence. ' + 'long result '.repeat(1400) }
    yield { kind: 'completed', stopReason: 'stop' }
  } }
  const h = makeHarness(model, { tools: [], compactor: new ContextCompactor({ profilesForProvider: () => profiles }),
    modelCapabilities: (name) => modelCapabilitiesForModel(name, profiles), contextCompaction: { summaryMode: 'heuristic' } })
  const thread = await h.threads.create({ model: 'large', mode: 'agent', workspace: '/tmp', title: 'Window switch test' })
  const prompts: string[] = []
  for (let n = 0; n < 18; n++) {
    const selected = n % 3 === 1 ? 'small' : 'large'
    const prompt = `CURRENT_${n} Preserve the original goal. ` + 'Conversation context '.repeat(500)
    prompts.push(prompt)
    const admitted = await h.turns.startTurn({ threadId: thread.id, request: { model: selected, prompt } })
    expect(await h.loop.runTurn(thread.id, admitted.turnId)).toBe('completed')
    const requests = seen.filter((entry) => entry.turnId === admitted.turnId)
    expect(requests).toHaveLength(1)
    const actual = requests[0]
    expect(actual.model).toBe(selected)
    const cap = Math.floor(modelCapabilitiesForModel(selected, profiles).contextWindowTokens! * .85)
    expect(estimateModelRequestInputTokens(actual) + (actual.maxTokens ?? 0)).toBeLessThanOrEqual(cap)
    expect(actual.history.filter((entry) => entry.kind === 'user_message' && entry.turnId === admitted.turnId)).toHaveLength(1)
  }
  const canonical = await h.sessionStore.loadItems(thread.id)
  expect(h.bus.snapshotSince(thread.id, 0).filter((entry) => entry.kind === 'compaction_completed').length).toBeGreaterThan(1)
  for (const prompt of prompts) expect(canonical.some((entry) => entry.kind === 'user_message' && entry.text === prompt)).toBe(true)
  expect((await h.threads.getMetadata(thread.id))!.turns).toHaveLength(18)
}, 30_000)


it('still enforces the unknown-model cap when legacy compactor thresholds are much larger', async () => {
  const seen: ModelRequest[] = []
  const model: ModelClient = { provider: 'test', model: 'custom-unknown-capacity', async *stream(request) {
    seen.push(request)
    yield { kind: 'assistant_text_delta', text: 'Completed normally' }
    yield { kind: 'completed', stopReason: 'stop' }
  } }
  const h = makeHarness(model, { tools: [], compactor: new ContextCompactor({ softThreshold: 750_000, hardThreshold: 850_000 }),
    contextCompaction: { summaryMode: 'heuristic' } })
  const thread = await h.threads.create({ title: 'Unknown capacity', workspace: '/tmp', model: model.model, mode: 'agent' })
  for (let n = 0; n < 12; n++) await h.sessionStore.appendItem(thread.id, makeUserItem({ id: 'seed-' + n,
    threadId: thread.id, turnId: 'old-' + n, text: 'Historical user constraint '.repeat(500) }))
  const admitted = await h.turns.startTurn({ threadId: thread.id, request: { prompt: 'Continue safely' } })
  expect(await h.loop.runTurn(thread.id, admitted.turnId)).toBe('completed')
  expect(seen).toHaveLength(1)
  expect(estimateModelRequestInputTokens(seen[0]) + seen[0].maxTokens!).toBeLessThanOrEqual(27_200)
  expect(h.bus.snapshotSince(thread.id, 0).some((event) => event.kind === 'compaction_completed')).toBe(true)
  expect((await h.sessionStore.loadItems(thread.id)).filter((item) => item.kind === 'user_message')).toHaveLength(13)
})

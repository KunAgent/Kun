import { describe, expect, test } from 'vitest'
import type { SteeringEntry } from '../../contracts/turns.js'
import type { DelegatedSteering } from '../../services/delegated-steering.js'
import { AcpLiveSteering } from './acp-live-steering.js'

function fakeSteering() {
  const pending: SteeringEntry[] = []
  const listeners = new Set<() => void>()
  let sealed = false
  const steering: DelegatedSteering = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async take() {
      return pending.splice(0)
    },
    sealIfEmpty() {
      if (pending.length) return false
      sealed = true
      return true
    }
  }
  return {
    steering,
    admit(text: string, notify = true) {
      pending.push({ text })
      if (notify) for (const listener of listeners) listener()
    },
    get sealed() { return sealed },
    get listeners() { return listeners.size }
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AcpLiveSteering', () => {
  test('sends admitted guidance as its own prompt while the main prompt runs', async () => {
    const fake = fakeSteering()
    const sent: string[][] = []
    const results: unknown[] = []
    let resolveGuidance!: (value: unknown) => void
    const live = new AcpLiveSteering({
      steering: fake.steering,
      send: (entries) => {
        sent.push(entries.map((entry) => entry.text))
        return new Promise((resolve) => { resolveGuidance = resolve })
      },
      onResult: (raw) => { results.push(raw) },
      onError: (error) => { throw error }
    })
    fake.admit('also check the 5-1 case')
    await tick()
    expect(sent).toEqual([['also check the 5-1 case']])

    // The guidance request resolves together with the main run.
    const finished = live.finish({ followUp: true })
    await tick()
    expect(results).toEqual([])
    resolveGuidance({ stopReason: 'end_turn' })
    await finished
    expect(results).toEqual([{ stopReason: 'end_turn' }])
    expect(fake.sealed).toBe(true)
    expect(fake.listeners).toBe(0)
  })

  test('guidance that arrives after the run ended goes out as an awaited follow-up', async () => {
    const fake = fakeSteering()
    const sent: string[][] = []
    const live = new AcpLiveSteering({
      steering: fake.steering,
      send: async (entries) => {
        sent.push(entries.map((entry) => entry.text))
        return { stopReason: 'end_turn' }
      },
      onResult: () => undefined,
      onError: (error) => { throw error }
    })
    fake.admit('late', false)
    await live.finish({ followUp: true })
    expect(sent).toEqual([['late']])
    expect(fake.sealed).toBe(true)
  })

  test('a cancelled turn persists late guidance without sending it', async () => {
    const fake = fakeSteering()
    const sent: string[][] = []
    const live = new AcpLiveSteering({
      steering: fake.steering,
      send: async (entries) => { sent.push(entries.map((entry) => entry.text)) },
      onResult: () => undefined,
      onError: () => undefined
    })
    fake.admit('too late', false)
    await live.finish({ followUp: false })
    expect(sent).toEqual([])
    expect(fake.sealed).toBe(true)
  })

  test('a failed guidance request is reported and does not fail the turn', async () => {
    const fake = fakeSteering()
    const errors: unknown[] = []
    const live = new AcpLiveSteering({
      steering: fake.steering,
      send: async () => { throw new Error('agent busy') },
      onResult: () => undefined,
      onError: (error) => { errors.push(error) }
    })
    fake.admit('steer')
    await tick()
    await live.finish({ followUp: true })
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('agent busy')
  })
})

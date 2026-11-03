import { describe, expect, test } from 'vitest'
import type { SteeringEntry } from '../../contracts/turns.js'
import type { DelegatedSteering } from '../../services/delegated-steering.js'
import { AcpLiveSteering, type AcpGuidanceDelivery } from './acp-live-steering.js'

function fakeSteering() {
  const pending: SteeringEntry[] = []
  const taken: string[] = []
  const listeners = new Set<() => void>()
  let sealed = false
  const steering: DelegatedSteering = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async take() {
      const entries = pending.splice(0)
      taken.push(...entries.map((entry) => entry.text))
      return entries
    },
    sealIfEmpty() {
      if (pending.length) return false
      sealed = true
      return true
    }
  }
  return {
    steering,
    taken,
    admit(text: string, notify = true) {
      pending.push({ text })
      if (notify) for (const listener of listeners) listener()
    },
    get sealed() { return sealed },
    get listeners() { return listeners.size }
  }
}

function recordingDelivery(overrides: Partial<AcpGuidanceDelivery> = {}) {
  const sent: string[][] = []
  const results: unknown[] = []
  const errors: unknown[] = []
  const delivery: AcpGuidanceDelivery = {
    send: async (entries) => {
      sent.push(entries.map((entry) => entry.text))
      return { stopReason: 'end_turn' }
    },
    onResult: (raw) => { results.push(raw) },
    onError: (error) => { errors.push(error) },
    ...overrides
  }
  return { delivery, sent, results, errors }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AcpLiveSteering (live)', () => {
  test('sends admitted guidance as its own prompt while the main prompt runs', async () => {
    const fake = fakeSteering()
    let resolveGuidance!: (value: unknown) => void
    const { delivery, sent, results } = recordingDelivery({
      send: (entries) => {
        sent.push(entries.map((entry) => entry.text))
        return new Promise((resolve) => { resolveGuidance = resolve })
      }
    })
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'live' })
    live.start(delivery)
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

  test('guidance admitted before the run starts waits for it', async () => {
    const fake = fakeSteering()
    const { delivery, sent } = recordingDelivery()
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'live' })
    fake.admit('early')
    await tick()
    expect(fake.taken).toEqual([])
    live.start(delivery)
    await tick()
    expect(sent).toEqual([['early']])
    await live.finish({ followUp: true })
  })

  test('guidance that arrives after the run ended goes out as an awaited follow-up', async () => {
    const fake = fakeSteering()
    const { delivery, sent } = recordingDelivery()
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'live' })
    live.start(delivery)
    fake.admit('late', false)
    await live.finish({ followUp: true })
    expect(sent).toEqual([['late']])
    expect(fake.sealed).toBe(true)
  })

  test('a cancelled turn persists late guidance without sending it', async () => {
    const fake = fakeSteering()
    const { delivery, sent } = recordingDelivery()
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'live' })
    live.start(delivery)
    fake.admit('too late', false)
    await live.finish({ followUp: false })
    expect(sent).toEqual([])
    expect(fake.taken).toEqual(['too late'])
    expect(fake.sealed).toBe(true)
  })

  test('a failed guidance request is reported and does not fail the turn', async () => {
    const fake = fakeSteering()
    const { delivery, errors } = recordingDelivery({ send: async () => { throw new Error('agent busy') } })
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'live' })
    live.start(delivery)
    fake.admit('steer')
    await tick()
    await live.finish({ followUp: true })
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('agent busy')
  })

  test('guidance the engine refuses mid-run is still answered as a follow-up in the same turn', async () => {
    const fake = fakeSteering()
    let attempts = 0
    const { delivery, sent, errors } = recordingDelivery({
      send: async (entries) => {
        attempts += 1
        // The first attempt races the run's end; the follow-up succeeds.
        if (attempts === 1) throw new Error('no active run')
        sent.push(entries.map((entry) => entry.text))
        return { stopReason: 'end_turn' }
      }
    })
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'live' })
    live.start(delivery)
    fake.admit('commit when done')
    await tick()
    expect(sent).toEqual([])

    await live.finish({ followUp: true })
    expect(sent).toEqual([['commit when done']])
    expect(errors).toEqual([])
    expect(fake.sealed).toBe(true)
  })
})

describe('AcpLiveSteering (deferred)', () => {
  test('persists guidance at once and answers it after the main prompt', async () => {
    const fake = fakeSteering()
    const order: string[] = []
    const { delivery, sent } = recordingDelivery({
      beforeFollowUp: () => { order.push('beforeFollowUp') },
      send: async (entries) => {
        order.push('send')
        sent.push(entries.map((entry) => entry.text))
        return { stopReason: 'end_turn' }
      }
    })
    // Admitted while the Agent was still starting up.
    fake.admit('commit when done')
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'deferred' })
    await tick()
    expect(fake.taken).toEqual(['commit when done'])
    live.start(delivery)
    fake.admit('to local develop')
    await tick()
    expect(fake.taken).toEqual(['commit when done', 'to local develop'])
    expect(sent).toEqual([])

    await live.finish({ followUp: true })
    expect(sent).toEqual([['commit when done', 'to local develop']])
    expect(order).toEqual(['beforeFollowUp', 'send'])
    expect(fake.sealed).toBe(true)
    expect(fake.listeners).toBe(0)
  })

  test('guidance admitted during a follow-up gets a follow-up of its own', async () => {
    const fake = fakeSteering()
    const { delivery, sent } = recordingDelivery({
      send: async (entries) => {
        sent.push(entries.map((entry) => entry.text))
        // Admission stays open while a follow-up runs.
        if (sent.length === 1) fake.admit('and push it', false)
        return { stopReason: 'end_turn' }
      }
    })
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'deferred' })
    live.start(delivery)
    fake.admit('commit')
    await tick()
    await live.finish({ followUp: true })
    expect(sent).toEqual([['commit'], ['and push it']])
    expect(fake.sealed).toBe(true)
  })

  test('a stopped turn keeps waiting guidance without sending it', async () => {
    const fake = fakeSteering()
    let stopped = false
    const { delivery, sent } = recordingDelivery({ canFollowUp: () => !stopped })
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'deferred' })
    live.start(delivery)
    fake.admit('commit')
    await tick()
    stopped = true
    await live.finish({ followUp: true })
    expect(sent).toEqual([])
    expect(fake.taken).toEqual(['commit'])
    expect(fake.sealed).toBe(true)
  })

  test('a failed follow-up seals admission, then fails the turn; finish is idempotent', async () => {
    const fake = fakeSteering()
    const { delivery } = recordingDelivery({ send: async () => { throw new Error('session gone') } })
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'deferred' })
    live.start(delivery)
    fake.admit('commit')
    await tick()
    await expect(live.finish({ followUp: true })).rejects.toThrow('session gone')
    expect(fake.sealed).toBe(true)
    await expect(live.finish({ followUp: false })).rejects.toThrow('session gone')
  })

  test('a turn torn down before it started still persists and seals guidance', async () => {
    const fake = fakeSteering()
    const live = new AcpLiveSteering({ steering: fake.steering, mode: 'deferred' })
    fake.admit('early')
    await live.finish({ followUp: false })
    expect(fake.taken).toEqual(['early'])
    expect(fake.sealed).toBe(true)
  })
})

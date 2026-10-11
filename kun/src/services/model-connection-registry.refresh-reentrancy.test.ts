import { describe, expect, it, vi } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { runInsideOAuthRefresh } from './oauth-refresh-scope.js'

type Changed = (this: ModelConnectionRegistry, document: never) => Promise<void>
const changed = (ModelConnectionRegistry.prototype as unknown as { changed: Changed }).changed

function registryWith(applyLatest: () => Promise<void>): ModelConnectionRegistry {
  return { applyLatest } as unknown as ModelConnectionRegistry
}

describe('ModelConnectionRegistry change application during an OAuth refresh', () => {
  it('does not wait for the apply that is itself waiting on the refresh', async () => {
    // The outer apply is blocked until this refresh finishes, so its queue slot never frees up here.
    const applyLatest = vi.fn(() => new Promise<void>(() => undefined))

    const outcome = await Promise.race([
      runInsideOAuthRefresh('model-connection:grok', () => changed.call(registryWith(applyLatest), {} as never))
        .then(() => 'returned'),
      new Promise<string>((resolve) => setTimeout(() => resolve('deadlocked'), 500))
    ])

    expect(outcome).toBe('returned')
    expect(applyLatest).toHaveBeenCalledTimes(1)
  })

  it('still waits for the apply outside of a refresh', async () => {
    let finish!: () => void
    const applyLatest = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    let settled = false

    const pending = changed.call(registryWith(applyLatest), {} as never).then(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    finish()
    await pending
    expect(settled).toBe(true)
  })
})

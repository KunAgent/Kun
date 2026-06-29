import { afterEach, describe, expect, it, vi } from 'vitest'
import process from 'node:process'
import { installServeCrashHandlers } from './serve-crash-handlers.js'

type Listener = (...args: unknown[]) => void

/**
 * installServeCrashHandlers registers process-wide listeners. Snapshot the
 * existing ones so we can invoke (and later remove) only the pair this call
 * added, without disturbing vitest's own handlers.
 */
function install(getHandle: () => null = () => null): {
  unhandled: Listener[]
  uncaught: Listener[]
  cleanup: () => void
} {
  const beforeRejection = new Set(process.listeners('unhandledRejection'))
  const beforeException = new Set(process.listeners('uncaughtException'))
  installServeCrashHandlers(getHandle)
  const unhandled = process
    .listeners('unhandledRejection')
    .filter((l) => !beforeRejection.has(l)) as unknown as Listener[]
  const uncaught = process
    .listeners('uncaughtException')
    .filter((l) => !beforeException.has(l)) as unknown as Listener[]
  return {
    unhandled,
    uncaught,
    cleanup: () => {
      for (const l of unhandled) process.removeListener('unhandledRejection', l as never)
      for (const l of uncaught) process.removeListener('uncaughtException', l as never)
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('serve crash handlers (#639)', () => {
  it('keeps the runtime alive on an unhandledRejection (e.g. an MCP transport drop)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const writes: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }) as never)

    const handlers = install()
    try {
      expect(handlers.unhandled).toHaveLength(1)
      handlers.unhandled[0](new Error('SSE stream disconnected: socket hang up'))

      expect(exitSpy).not.toHaveBeenCalled()
      expect(writes.join('')).toContain('unhandledRejection (non-fatal, runtime stays up)')
      expect(writes.join('')).toContain('socket hang up')
    } finally {
      handlers.cleanup()
    }
  })

  it('still exits non-zero on an uncaughtException so the supervisor restarts a clean process', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)

    const handlers = install()
    try {
      expect(handlers.uncaught).toHaveLength(1)
      handlers.uncaught[0](new Error('boom'))

      // ServeExitCode.runtime === 70
      expect(exitSpy).toHaveBeenCalledWith(70)
    } finally {
      handlers.cleanup()
    }
  })
})

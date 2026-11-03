import { describe, expect, it, vi } from 'vitest'
import { backgroundShellStdin } from './background-shells.js'
import type { BackgroundShellRuntime } from '../../services/background-shell-runtime.js'

function request(body: unknown): Request {
  return new Request('http://kun.local/v1/background-shells/abc/stdin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function runtime(overrides: Partial<BackgroundShellRuntime> = {}): BackgroundShellRuntime {
  return {
    getSession: vi.fn(() => ({ id: 'abc', status: 'running' })),
    writeStdin: vi.fn(async () => true),
    ...overrides
  } as unknown as BackgroundShellRuntime
}

describe('background shell stdin route', () => {
  it('writes input to a known shell', async () => {
    const shells = runtime()
    const response = await backgroundShellStdin(shells, 'abc', request({ input: 'y\n' }))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ sessionId: "abc", written: true })
    expect(shells.writeStdin).toHaveBeenCalledWith('abc', 'y\n')
  })

  it('rejects empty input and unknown shells', async () => {
    expect((await backgroundShellStdin(runtime(), 'abc', request({ input: '' }))).status).toBe(400)
    const missing = runtime({ getSession: vi.fn(() => null) as never })
    expect((await backgroundShellStdin(missing, 'abc', request({ input: 'x' }))).status).toBe(404)
    expect((await backgroundShellStdin(undefined, 'abc', request({ input: 'x' }))).status).toBe(503)
  })
})

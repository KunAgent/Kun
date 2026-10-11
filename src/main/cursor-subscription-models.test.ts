import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  cursorDiscoveryEnvironment,
  cursorDiscoveryScript,
  discoverCursorSubscription,
  parseCursorDiscoveryOutput,
  sanitizeCursorError
} from './cursor-subscription-models'

const MARK = '<<<KUN_CURSOR_SDK>>>'

function frame(value: unknown): string {
  return `${MARK}${JSON.stringify(value)}${MARK}`
}

function fakeSpawn(
  run: (child: FakeChild, input: PassThrough, args: string[], env: NodeJS.ProcessEnv) => void
): typeof spawn {
  return ((_command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const child = new EventEmitter() as FakeChild
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn(() => true)
    queueMicrotask(() => run(child, child.stdin!, args, options.env ?? {}))
    return child
  }) as unknown as typeof spawn
}

type FakeChild = EventEmitter & {
  stdin?: PassThrough
  stdout?: PassThrough
  stderr?: PassThrough
  kill: ReturnType<typeof vi.fn>
}

describe('Cursor subscription SDK discovery', () => {
  it('parses bounded account metadata and unique structured models', () => {
    expect(parseCursorDiscoveryOutput(frame({
      ok: true,
      account: {
        apiKeyName: 'Kun',
        userEmail: 'user@example.com',
        ignored: 'field'
      },
      models: [
        {
          id: 'auto',
          displayName: 'Auto',
          aliases: ['cursor-auto'],
          parameters: [{
            id: 'thinking',
            displayName: 'Thinking',
            values: [{ value: 'high', displayName: 'High' }]
          }],
          variants: [{
            displayName: 'Max',
            description: 'Maximum context',
            isDefault: true,
            params: [{ id: 'thinking', value: 'high' }]
          }]
        },
        { id: 'composer-2.5', displayName: 'Composer 2.5', description: 'Cursor model' },
        { id: 'auto' },
        { id: '' },
        null
      ]
    }), 'cursor-key')).toMatchObject({
      account: {
        apiKeyName: 'Kun',
        userEmail: 'user@example.com'
      },
      models: [
        {
          id: 'auto',
          displayName: 'Auto',
          aliases: ['cursor-auto'],
          parameters: [{
            id: 'thinking',
            displayName: 'Thinking',
            values: [{ value: 'high', displayName: 'High' }]
          }],
          variants: [{
            displayName: 'Max',
            description: 'Maximum context',
            isDefault: true,
            params: [{ id: 'thinking', value: 'high' }]
          }]
        },
        {
          id: 'composer-2.5',
          displayName: 'Composer 2.5',
          description: 'Cursor model'
        }
      ]
    })
  })

  it('redacts the exact API key from SDK and parent errors', () => {
    expect(() => parseCursorDiscoveryOutput(frame({
      ok: false,
      code: 'authentication_error',
      message: 'Cursor rejected cursor-super-secret'
    }), 'cursor-super-secret')).toThrow(
      'authentication_error: Cursor rejected [REDACTED]'
    )
    expect(sanitizeCursorError(
      new Error('request cursor-super-secret failed'),
      'cursor-super-secret'
    )).toBe('request [REDACTED] failed')
  })

  it('removes ambient Cursor credentials and keeps secrets out of the eval script', () => {
    expect(cursorDiscoveryEnvironment({
      CURSOR_API_KEY: 'ambient-secret',
      PATH: '/usr/bin'
    })).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/usr/bin'
    })
    expect(cursorDiscoveryEnvironment({ CURSOR_API_KEY: 'ambient-secret' }))
      .not.toHaveProperty('CURSOR_API_KEY')
    expect(cursorDiscoveryScript()).not.toContain('cursor-super-secret')
  })

  it('passes the submitted API key only through stdin', async () => {
    let received = ''
    const result = await discoverCursorSubscription({
      apiKey: 'cursor-super-secret',
      kunRoots: [join(process.cwd(), 'kun')],
      spawnFn: fakeSpawn((child, input, args, env) => {
        input.on('data', (chunk) => { received += chunk.toString() })
        input.on('finish', () => {
          expect(args.join(' ')).not.toContain('cursor-super-secret')
          expect(env.CURSOR_API_KEY).toBeUndefined()
          child.stdout?.end(frame({
            ok: true,
            account: { apiKeyName: 'Kun test' },
            models: [{ id: 'auto' }]
          }))
          child.emit('exit', 0, null)
        })
      })
    })

    expect(received).toBe('cursor-super-secret')
    expect(result).toEqual({
      account: { apiKeyName: 'Kun test' },
      models: [{ id: 'auto', displayName: 'auto' }]
    })
  })

  it('times out and terminates a stalled SDK helper', async () => {
    let childRef: FakeChild | undefined
    await expect(discoverCursorSubscription({
      apiKey: 'cursor-key',
      kunRoots: [join(process.cwd(), 'kun')],
      timeoutMs: 5,
      spawnFn: fakeSpawn((child) => { childRef = child })
    })).rejects.toThrow('timed out')
    expect(childRef?.kill).toHaveBeenCalled()
  })

  it('rejects oversized helper output', async () => {
    await expect(discoverCursorSubscription({
      apiKey: 'cursor-key',
      kunRoots: [join(process.cwd(), 'kun')],
      spawnFn: fakeSpawn((child, input) => {
        input.on('finish', () => {
          child.stdout?.write(Buffer.alloc(1024 * 1024 + 1, 65))
        })
      })
    })).rejects.toThrow('exceeded the output limit')
  })
})

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { accessMock, spawnMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    access: accessMock
  }
})

import {
  acquireLspSession,
  lspGetDiagnostics,
  releaseLspSession,
  shutdownAllLspSessions
} from './lsp-client.js'
import { resolveServerCommand } from './lsp-servers.js'

type MockProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function createMockProcess(
  onWrite?: (chunk: string, proc: MockProcess) => void
): MockProcess {
  const proc = new EventEmitter() as MockProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  proc.stdin = {
    write: vi.fn((chunk: string) => {
      onWrite?.(chunk, proc)
      return true
    })
  }
  return proc
}

function parseJsonRpc(chunk: string): Record<string, unknown> {
  const [, body = ''] = chunk.split('\r\n\r\n')
  return JSON.parse(body)
}

function emitJsonRpc(proc: MockProcess, message: Record<string, unknown>): void {
  const body = JSON.stringify(message)
  proc.stdout.emit('data', Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8'))
}

afterEach(() => {
  shutdownAllLspSessions()
  spawnMock.mockReset()
  accessMock.mockReset()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('resolveServerCommand', () => {
  it('uses where on Windows when looking up a server on PATH', async () => {
    accessMock.mockRejectedValueOnce(new Error('missing local install'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    spawnMock.mockImplementation((command: string, args: string[]) => {
      const proc = createMockProcess()
      queueMicrotask(() => {
        proc.stdout.emit('data', Buffer.from('C:\\Tools\\typescript-language-server.cmd\r\n', 'utf8'))
        proc.emit('close', 0)
      })
      expect(command).toBe('where')
      expect(args).toEqual(['typescript-language-server'])
      return proc
    })

    await expect(resolveServerCommand('/workspace', 'typescript')).resolves.toEqual({
      command: 'typescript-language-server',
      args: ['--stdio']
    })
  })
})

describe('LSP session cooldown', () => {
  it('enters cooldown after an initialize failure and retries after the cooldown expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T00:00:00Z'))
    accessMock.mockRejectedValue(new Error('missing local install'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    const serverProcesses: MockProcess[] = []

    spawnMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'which') {
        const proc = createMockProcess()
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from('/usr/local/bin/typescript-language-server\n', 'utf8'))
          proc.emit('close', 0)
        })
        return proc
      }

      if (command === 'typescript-language-server') {
        const attempt = serverProcesses.length + 1
        const proc = createMockProcess((chunk, child) => {
          const request = parseJsonRpc(chunk)
          if (request.method === 'initialize') {
            if (attempt === 1) {
              queueMicrotask(() => child.emit('exit', 1, null))
            } else {
              queueMicrotask(() => emitJsonRpc(child, {
                jsonrpc: '2.0',
                id: request.id,
                result: {}
              }))
            }
          }
        })
        serverProcesses.push(proc)
        return proc
      }

      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`)
    })

    await expect(acquireLspSession('/workspace/cooldown', 'typescript')).rejects.toThrow(
      /LSP (session closed|initialize failed)/
    )
    expect(serverProcesses).toHaveLength(1)

    await expect(acquireLspSession('/workspace/cooldown', 'typescript')).rejects.toThrow(
      /recently failed/
    )
    expect(serverProcesses).toHaveLength(1)

    vi.setSystemTime(new Date('2026-06-20T00:05:01Z'))

    const session = await acquireLspSession('/workspace/cooldown', 'typescript')
    expect(session.workspaceRoot).toBe('/workspace/cooldown')
    expect(session.serverKey).toBe('typescript')
    expect(serverProcesses).toHaveLength(2)
    releaseLspSession('/workspace/cooldown', 'typescript')
  })
})

describe('LSP stderr logging', () => {
  it('logs the tail of buffered stderr when the server exits unexpectedly', async () => {
    accessMock.mockRejectedValue(new Error('missing local install'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    let serverProcess: MockProcess | undefined

    spawnMock.mockImplementation((command: string) => {
      if (command === 'which') {
        const proc = createMockProcess()
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from('/usr/local/bin/typescript-language-server\n', 'utf8'))
          proc.emit('close', 0)
        })
        return proc
      }

      if (command === 'typescript-language-server') {
        const proc = createMockProcess((chunk, child) => {
          const request = parseJsonRpc(chunk)
          if (request.method === 'initialize') {
            queueMicrotask(() => emitJsonRpc(child, {
              jsonrpc: '2.0',
              id: request.id,
              result: {}
            }))
          }
        })
        serverProcess = proc
        return proc
      }

      throw new Error(`Unexpected spawn: ${command}`)
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const session = await acquireLspSession('/workspace/stderr', 'typescript')
    expect(session.workspaceRoot).toBe('/workspace/stderr')
    expect(serverProcess).toBeDefined()

    const stderrLines = Array.from({ length: 205 }, (_, index) => `stderr-line-${index}`).join('\n')
    serverProcess?.stderr.emit('data', Buffer.from(stderrLines, 'utf8'))
    serverProcess?.emit('exit', 1, null)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message] = errorSpy.mock.calls[0] ?? ['']
    expect(String(message)).toContain('stderr-line-204')
    expect(String(message)).toContain('stderr-line-185')
    expect(String(message)).not.toContain('stderr-line-184')
    expect(String(message)).not.toContain('stderr-line-0')
  })
})

describe('LSP notifications', () => {
  it('stores diagnostics pushed by the language server', async () => {
    accessMock.mockRejectedValue(new Error('missing local install'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    let serverProcess: MockProcess | undefined

    spawnMock.mockImplementation((command: string) => {
      if (command === 'which') {
        const proc = createMockProcess()
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from('/usr/local/bin/typescript-language-server\n', 'utf8'))
          proc.emit('close', 0)
        })
        return proc
      }

      if (command === 'typescript-language-server') {
        const proc = createMockProcess((chunk, child) => {
          const request = parseJsonRpc(chunk)
          if (request.method === 'initialize') {
            queueMicrotask(() => emitJsonRpc(child, {
              jsonrpc: '2.0',
              id: request.id,
              result: {}
            }))
          }
        })
        serverProcess = proc
        return proc
      }

      throw new Error(`Unexpected spawn: ${command}`)
    })

    const session = await acquireLspSession('/workspace/diagnostics', 'typescript')
    emitJsonRpc(serverProcess as MockProcess, {
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///workspace/diagnostics/app.ts',
        diagnostics: [{ message: 'boom', severity: 1 }]
      }
    })

    expect(session.diagnostics.get('file:///workspace/diagnostics/app.ts')).toEqual([
      { message: 'boom', severity: 1 }
    ])
    await expect(lspGetDiagnostics(session, '/workspace/diagnostics/app.ts')).resolves.toEqual({
      diagnostics: [{ message: 'boom', severity: 1 }],
      source: 'publishDiagnostics-cache'
    })
    releaseLspSession('/workspace/diagnostics', 'typescript')
  })

  it('logs server messages from window/logMessage notifications', async () => {
    accessMock.mockRejectedValue(new Error('missing local install'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    let serverProcess: MockProcess | undefined

    spawnMock.mockImplementation((command: string) => {
      if (command === 'which') {
        const proc = createMockProcess()
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from('/usr/local/bin/typescript-language-server\n', 'utf8'))
          proc.emit('close', 0)
        })
        return proc
      }

      if (command === 'typescript-language-server') {
        const proc = createMockProcess((chunk, child) => {
          const request = parseJsonRpc(chunk)
          if (request.method === 'initialize') {
            queueMicrotask(() => emitJsonRpc(child, {
              jsonrpc: '2.0',
              id: request.id,
              result: {}
            }))
          }
        })
        serverProcess = proc
        return proc
      }

      throw new Error(`Unexpected spawn: ${command}`)
    })

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await acquireLspSession('/workspace/logs', 'typescript')
    emitJsonRpc(serverProcess as MockProcess, {
      jsonrpc: '2.0',
      method: 'window/logMessage',
      params: {
        type: 3,
        message: 'hello from tsserver'
      }
    })

    expect(infoSpy).toHaveBeenCalledWith(
      '[lsp] TypeScript/JavaScript: hello from tsserver'
    )
  })
})

describe('LSP diagnostics pull fallback', () => {
  it('falls back to textDocument/diagnostic when no push diagnostics are cached', async () => {
    accessMock.mockRejectedValue(new Error('missing local install'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    spawnMock.mockImplementation((command: string) => {
      if (command === 'which') {
        const proc = createMockProcess()
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from('/usr/local/bin/typescript-language-server\n', 'utf8'))
          proc.emit('close', 0)
        })
        return proc
      }

      if (command === 'typescript-language-server') {
        return createMockProcess((chunk, child) => {
          const request = parseJsonRpc(chunk)
          if (request.method === 'initialize') {
            queueMicrotask(() => emitJsonRpc(child, {
              jsonrpc: '2.0',
              id: request.id,
              result: {}
            }))
          }
          if (request.method === 'textDocument/diagnostic') {
            queueMicrotask(() => emitJsonRpc(child, {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                kind: 'full',
                items: [{ message: 'pulled diagnostic', severity: 1 }]
              }
            }))
          }
        })
      }

      throw new Error(`Unexpected spawn: ${command}`)
    })

    const session = await acquireLspSession('/workspace/pull', 'typescript')
    await expect(lspGetDiagnostics(session, '/workspace/pull/app.ts')).resolves.toEqual({
      diagnostics: [{ message: 'pulled diagnostic', severity: 1 }],
      source: 'textDocument/diagnostic'
    })
    releaseLspSession('/workspace/pull', 'typescript')
  })

  it('parses pulled diagnostics with multibyte JSON-RPC framing', async () => {
    accessMock.mockRejectedValue(new Error('missing local install'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    spawnMock.mockImplementation((command: string) => {
      if (command === 'which') {
        const proc = createMockProcess()
        queueMicrotask(() => {
          proc.stdout.emit('data', Buffer.from('/usr/local/bin/typescript-language-server\n', 'utf8'))
          proc.emit('close', 0)
        })
        return proc
      }

      if (command === 'typescript-language-server') {
        return createMockProcess((chunk, child) => {
          const request = parseJsonRpc(chunk)
          if (request.method === 'initialize') {
            queueMicrotask(() => emitJsonRpc(child, {
              jsonrpc: '2.0',
              id: request.id,
              result: {}
            }))
          }
          if (request.method === 'textDocument/diagnostic') {
            queueMicrotask(() => {
              const response = {
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  kind: 'full',
                  items: [{ message: '类型错误：需要字符串', severity: 1 }]
                }
              }
              const logMessage = {
                jsonrpc: '2.0',
                method: 'window/logMessage',
                params: {
                  type: 3,
                  message: 'diagnostics complete'
                }
              }
              const responseBody = JSON.stringify(response)
              const logBody = JSON.stringify(logMessage)
              child.stdout.emit('data', Buffer.concat([
                Buffer.from(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n\r\n${responseBody}`, 'utf8'),
                Buffer.from(`Content-Length: ${Buffer.byteLength(logBody)}\r\n\r\n${logBody}`, 'utf8')
              ]))
            })
          }
        })
      }

      throw new Error(`Unexpected spawn: ${command}`)
    })

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const session = await acquireLspSession('/workspace/multibyte-pull', 'typescript')
    await expect(lspGetDiagnostics(session, '/workspace/multibyte-pull/app.ts')).resolves.toEqual({
      diagnostics: [{ message: '类型错误：需要字符串', severity: 1 }],
      source: 'textDocument/diagnostic'
    })
    expect(infoSpy).toHaveBeenCalledWith(
      '[lsp] TypeScript/JavaScript: diagnostics complete'
    )
    releaseLspSession('/workspace/multibyte-pull', 'typescript')
  })
})

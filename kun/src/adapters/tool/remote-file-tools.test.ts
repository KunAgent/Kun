import { describe, expect, it, vi } from 'vitest'
import { remoteEdit, remoteFind, remoteGrep, remoteLs, remoteRead, remoteWrite } from './remote-file-tools.js'
import type { RemoteExecutionHandle, RemoteExecResult } from '../../ports/remote-execution.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

function execResult(overrides: Partial<RemoteExecResult>): RemoteExecResult {
  return { command: 'c', stdout: '', stderr: '', exitCode: 0, signal: null, durationMs: 1, timedOut: false, ...overrides }
}

function handle(opts: {
  exec?: (command: string) => Promise<RemoteExecResult>
  guardPath?: RemoteExecutionHandle['guardPath']
  guardFile?: RemoteExecutionHandle['guardFile']
} = {}): { handle: RemoteExecutionHandle; exec: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(opts.exec ?? (async () => execResult({ stdout: 'ok' })))
  const h: RemoteExecutionHandle = {
    target: { kind: 'ssh', alias: 'prod', remoteDir: '/srv/api' },
    runMode: 'develop',
    production: false,
    status: () => 'connected',
    describe: () => ({ target: { kind: 'ssh', alias: 'prod', remoteDir: '/srv/api' }, status: 'connected' }),
    guardCommand: () => ({ decision: 'allow', reasons: [] }),
    guardPath: opts.guardPath ?? (() => ({ decision: 'allow', reasons: [] })),
    guardFile: opts.guardFile ?? (() => ({ decision: 'allow', reasons: [] })),
    exec: exec as never
  }
  return { handle: h, exec }
}

function context(awaitApproval: ToolHostContext['awaitApproval'] = vi.fn(async () => 'allow' as const)): ToolHostContext {
  return { threadId: 't', turnId: 'tn', workspace: '/ws', approvalPolicy: 'auto', abortSignal: new AbortController().signal, awaitApproval }
}

describe('remote file tools', () => {
  it('read reads the remote file directly (no cat|head pipe) and tags the target', async () => {
    const { handle: h, exec } = handle({ exec: async () => execResult({ stdout: 'line1\nline2' }) })
    const result = await remoteRead(h, { path: 'src/a.ts' }, context())
    expect(result.output).toMatchObject({ target: 'ssh', host: 'prod', content: 'line1\nline2' })
    expect(exec.mock.calls[0][0]).toContain("head -c")
    expect(exec.mock.calls[0][0]).toContain("-- 'src/a.ts'")
    expect(exec.mock.calls[0][0]).not.toContain('| head')
  })

  it('read surfaces a missing-file failure instead of empty success', async () => {
    const { handle: h } = handle({ exec: async () => execResult({ exitCode: 1, stderr: 'No such file or directory', stdout: '' }) })
    const result = await remoteRead(h, { path: 'nope.ts' }, context())
    expect(result.isError).toBe(true)
    expect(String((result.output as Record<string, unknown>).error)).toContain('No such file')
  })

  it('read uses sed for a line window', async () => {
    const { handle: h, exec } = handle()
    await remoteRead(h, { path: 'a.ts', offset: 5, limit: 10 }, context())
    expect(exec.mock.calls[0][0]).toContain("sed -n '5,14p'")
  })

  it('writes content over stdin and atomically replaces the remote file', async () => {
    const { handle: h, exec } = handle({ exec: async () => execResult({ exitCode: 0 }) })
    const result = await remoteWrite(h, { path: 'out.txt', content: 'hello' }, context())
    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({ bytes_written: 5 })
    expect(exec.mock.calls[0][0]).toContain('mktemp')
    expect(exec.mock.calls[0][0]).toContain('mv -f')
    expect(exec.mock.calls[0][1]).toMatchObject({ input: 'hello' })
  })

  it('edit reads, applies replacement, and writes back', async () => {
    let call = 0
    const { handle: h, exec } = handle({
      exec: async () => {
        call += 1
        return call === 1 ? execResult({ stdout: 'const x = 1' }) : execResult({ exitCode: 0 })
      }
    })
    const result = await remoteEdit(h, { path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2' }, context())
    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({ replacements: 1 })
    expect(exec.mock.calls[1][0]).toContain('sha256sum')
    expect(exec.mock.calls[1][0]).toContain('mv -f')
    expect(exec.mock.calls[1][1]).toMatchObject({ input: 'const x = 2' })
    // The edit read must NOT cap with a pipe (would truncate large files on write-back).
    expect(exec.mock.calls[0][0]).toBe("cat -- 'a.ts'")
  })

  it('refuses the edit write-back when the remote file changed since the read (atomic CAS conflict)', async () => {
    let call = 0
    const { handle: h } = handle({
      exec: async () => {
        call += 1
        // 1st = cat read; 2nd = CAS write-back reports a conflict (exit 65).
        return call === 1
          ? execResult({ stdout: 'const x = 1' })
          : execResult({ exitCode: 65, stderr: 'REMOTE_EDIT_CONFLICT' })
      }
    })
    const result = await remoteEdit(h, { path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2' }, context())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ conflict: true })
    expect(String((result.output as Record<string, unknown>).error)).toContain('changed since it was read')
  })

  it('REFUSES to edit a file whose read was truncated (no silent data loss)', async () => {
    const { handle: h, exec } = handle({ exec: async () => execResult({ stdout: 'partial content', truncated: true }) })
    const result = await remoteEdit(h, { path: 'big.ts', oldText: 'a', newText: 'b' }, context())
    expect(result.isError).toBe(true)
    expect(String((result.output as Record<string, unknown>).error)).toContain('too large')
    // Only the read ran — no write-back of a truncated file.
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('ls lists remote entries', async () => {
    const { handle: h } = handle({ exec: async () => execResult({ stdout: 'a.ts\nsub/\n' }) })
    const result = await remoteLs(h, { path: '.' }, context())
    expect(result.output.names).toEqual(['a.ts', 'sub/'])
  })

  it('find returns remote matches', async () => {
    const { handle: h, exec } = handle({ exec: async () => execResult({ stdout: './src/a.ts\n./src/b.ts' }) })
    const result = await remoteFind(h, { pattern: '*.ts' }, context())
    expect(result.output.matches).toEqual(['./src/a.ts', './src/b.ts'])
    expect(exec.mock.calls[0][0]).toContain('find')
  })

  it('grep parses path:line:text rows', async () => {
    const guardFile = vi.fn(() => ({ decision: 'allow' as const, reasons: [] }))
    const { handle: h } = handle({ exec: async () => execResult({ stdout: 'src/a.ts:12:const x = 1' }), guardFile })
    const result = await remoteGrep(h, { pattern: 'const' }, context())
    expect(result.output.matches).toEqual([{ path: 'src/a.ts', line: 12, text: 'const x = 1' }])
    expect(guardFile).toHaveBeenCalledWith(expect.objectContaining({ operation: 'search', recursive: true }))
  })

  it('denies a protected-path write without executing', async () => {
    const { handle: h, exec } = handle({ guardFile: () => ({ decision: 'deny', reasons: ['protected'] }) })
    const result = await remoteWrite(h, { path: '/etc/passwd', content: 'x' }, context())
    expect(exec).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ decision: 'deny' })
  })

  it('requires approval before writing a confirm-class protected path', async () => {
    const approve = vi.fn(async () => 'deny' as const)
    const { handle: h, exec } = handle({ guardFile: () => ({ decision: 'confirm', reasons: ['protected'] }) })
    const result = await remoteWrite(h, { path: '.env', content: 'SECRET=1' }, context(approve))
    expect(approve).toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({ approved: false })
  })

  it('routes search ops through the file gate (deny blocks grep without executing)', async () => {
    const { handle: h, exec } = handle({ guardFile: () => ({ decision: 'deny', reasons: ['observe mode'] }) })
    const result = await remoteGrep(h, { pattern: 'secret' }, context())
    expect(exec).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ operation: 'search', decision: 'deny' })
  })

  it('requires approval before searching a protected path (find confirm)', async () => {
    const approve = vi.fn(async () => 'deny' as const)
    const { handle: h, exec } = handle({ guardFile: () => ({ decision: 'confirm', reasons: ['protected'] }) })
    const result = await remoteFind(h, { pattern: '*.pem', path: '/etc/ssl' }, context(approve))
    expect(approve).toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({ approved: false })
  })

  it('surfaces statusUnknown when the connection drops mid-op', async () => {
    const { handle: h } = handle({ exec: async () => execResult({ statusUnknown: true, stderr: 'reset', exitCode: null }) })
    const result = await remoteRead(h, { path: 'a.ts' }, context())
    expect(result.output).toMatchObject({ statusUnknown: true })
  })
})

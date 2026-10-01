import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { resolveAcpTerminalCommand } from './acp-terminal-command.js'

const options = { cwd: tmpdir(), env: process.env }
it('wraps an entire command and pipeline in an explicit POSIX shell', async () => {
  expect(await resolveAcpTerminalCommand('git status -sb && git log -1', [], { ...options, platform: 'darwin' }))
    .toEqual({ command: '/bin/sh', args: ['-c', 'git status -sb && git log -1'] })
})
it('keeps explicit argv literal, including shell syntax in an argument', async () => {
  expect(await resolveAcpTerminalCommand('git', ['show', 'a; echo unsafe'], options))
    .toEqual({ command: 'git', args: ['show', 'a; echo unsafe'] })
})
it('selects an explicit Windows shell for command strings', async () => {
  expect(await resolveAcpTerminalCommand('echo ready && echo done', [], { ...options, platform: 'win32', env: { ComSpec: 'fixture-cmd' } }))
    .toEqual({ command: 'fixture-cmd', args: ['/d', '/s', '/c', 'echo ready && echo done'] })
})
it.skipIf(process.platform === 'win32')('preserves executable paths containing whitespace and shell punctuation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-acp-command-'))
  const path = join(dir, 'node with ; punctuation')
  try {
    await symlink(process.execPath, path)
    expect(await resolveAcpTerminalCommand(path, [], options)).toEqual({ command: path, args: [] })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

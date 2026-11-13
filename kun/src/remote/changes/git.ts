import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { CodeChange, CodeChanges, CodeChangePatch } from '@kun/remote-protocol'

const MAX_PATCH = 131072, MAX_FILES = 200
const hash = (text: string) => 'changes-v1:' + createHash('sha256').update(text).digest('hex')
async function git(cwd: string, args: string[], boundedPatch = false): Promise<string> {
  return new Promise((accept, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '--no-pager', ...args], {
      cwd, timeout: 10000, maxBuffer: boundedPatch ? MAX_PATCH * 2 : 2 * 1024 * 1024,
      encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    }, (error, stdout, stderr) => {
      if (!error) accept(stdout)
      else if (boundedPatch && (error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') accept(stdout + '\n[truncated]')
      else reject(new Error('GIT_UNAVAILABLE', { cause: { notRepository: /not a git repository/i.test(stderr) } }))
    })
  })
}
const safePath = (path: string) => path.length <= 4096 && !isAbsolute(path) && !path.includes('\\') &&
  !path.includes('\0') && !path.split('/').some(p => !p || p === '..' || p === '.' || p.toLowerCase() === '.git')

export class GitChanges {
  constructor(private readonly workspace: string, private readonly permitted: (root: string, path: string) => Promise<boolean>) {}
  async list(): Promise<CodeChanges> {
    const cwd = await realpath(this.workspace)
    let status: string
    try { status = await git(cwd, ['-c', 'status.relativePaths=true', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']) }
    catch (error) {
      // A failed read of a Git workspace is not an empty change set.
      if ((error as { cause?: { notRepository?: boolean } }).cause?.notRepository)
        return { repository: false, revision: hash('not-git'), files: [], truncated: false }
      throw new Error('GIT_UNAVAILABLE')
    }
    const files: CodeChange[] = [], parts = status.split('\0')
    for (let index = 0; index < parts.length && parts[index]; index++) {
      const entry = parts[index], state = entry.slice(0, 2), path = entry.slice(3)
      if (/[RC]/.test(state)) index++
      if (safePath(path) && await this.permitted(cwd, resolve(cwd, path)))
        files.push({ path, status: state, added: 0, removed: 0, binary: false })
      if (files.length > MAX_FILES) break
    }
    const head = await git(cwd, ['rev-parse', '--verify', 'HEAD']).catch(() => '')
    const statArgs = ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '--relative', ...(head ? ['HEAD'] : ['--cached']), '--', '.']
    const stats = (await git(cwd, statArgs)).split('\0')
    const byPath = new Map(files.map(f => [f.path, f]))
    for (let i = 0; i < stats.length; i++) {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(stats[i])
      if (!match) continue
      const path = match[3] || (i += 2, stats[i]), file = byPath.get(path)
      if (file) { file.binary = match[1] === '-'; file.added = Number(match[1]) || 0; file.removed = Number(match[2]) || 0 }
    }
    const stamps: string[] = []
    for (const file of files.slice(0, MAX_FILES)) {
      const stat = await lstat(resolve(cwd, file.path), { bigint: true }).catch(() => null)
      stamps.push(`${file.path}:${stat?.mtimeNs}:${stat?.ctimeNs}:${stat?.size}`)
    }
    return { repository: true, revision: hash(JSON.stringify([cwd, status, head, stats, stamps])),
      files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
  }
  async get(path: string, revision: string): Promise<CodeChangePatch> {
    if (!safePath(path)) throw new Error('FILE_NOT_ALLOWED')
    const cwd = await realpath(this.workspace), target = resolve(cwd, path)
    if (!await this.permitted(cwd, target)) throw new Error('FILE_NOT_ALLOWED')
    const before = await this.list()
    if (before.revision !== revision) throw new Error('CHANGES_REVISION_CONFLICT')
    const file = before.files.find(f => f.path === path)
    if (!file) throw new Error('NOT_FOUND')
    const parent = await realpath(dirname(target)).catch(() => cwd)
    if (relative(cwd, parent).startsWith('..') || isAbsolute(relative(cwd, parent))) throw new Error('FILE_NOT_ALLOWED')
    let patch = '', binary = file.binary
    if (file.status === '??' || !await git(cwd, ['rev-parse', '--verify', 'HEAD']).catch(() => '')) {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null)
      if (!handle) throw new Error('FILE_NOT_ALLOWED')
      try {
        const stat = await handle.stat()
        if (!stat.isFile()) throw new Error('FILE_NOT_ALLOWED')
        const buffer = Buffer.alloc(Math.min(stat.size, MAX_PATCH + 1))
        const read = await handle.read(buffer, 0, buffer.length, 0), bytes = buffer.subarray(0, read.bytesRead)
        binary = bytes.includes(0)
        if (!binary) patch = `--- /dev/null\n+++ b/${path}\n` + bytes.toString('utf8').split('\n').map(line => '+' + line).join('\n') + (stat.size > MAX_PATCH ? '\n[truncated]' : '')
      } finally { await handle.close() }
    } else patch = await git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--relative', 'HEAD', '--', path], true)
    if ((await this.list()).revision !== revision) throw new Error('CHANGES_REVISION_CONFLICT')
    if (!await this.permitted(cwd, target)) throw new Error('FILE_NOT_ALLOWED')
    return { path, revision, patch: patch.slice(0, MAX_PATCH), binary,
      truncated: patch.length > MAX_PATCH || patch.endsWith('[truncated]') }
  }
}

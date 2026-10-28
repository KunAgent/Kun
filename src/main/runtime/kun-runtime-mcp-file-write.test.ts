import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { McpConfigStaleWriteError, writeKunMcpConfigFile } from './kun-runtime-mcp-file-write'

const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-mcp-ipc-write-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  return root
}

const enabled = JSON.stringify({ servers: { app: { enabled: true, command: 'old-server' } } }, null, 2)
const disabled = JSON.stringify({ servers: { app: { enabled: false, command: 'old-server' } } }, null, 2)

it('writes when the caller saved on top of the current content', async () => {
  const root = await temporaryRoot()
  const path = join(root, 'mcp.json')
  await writeFile(path, enabled, 'utf8')
  const onWritten = vi.fn()

  await writeKunMcpConfigFile({
    path,
    content: disabled,
    baseContent: enabled,
    onWritten
  })

  expect(await readFile(path, 'utf8')).toBe(disabled)
  expect(onWritten).toHaveBeenCalledWith(path, disabled)
})

it('rejects a stale snapshot instead of overwriting a Runtime disable', async () => {
  const root = await temporaryRoot()
  const path = join(root, 'mcp.json')
  // The Runtime disabled the server after the panel loaded `enabled`.
  await writeFile(path, disabled, 'utf8')
  const onWritten = vi.fn()

  await expect(writeKunMcpConfigFile({ path, content: enabled, baseContent: enabled, onWritten }))
    .rejects.toBeInstanceOf(McpConfigStaleWriteError)
  expect(await readFile(path, 'utf8')).toBe(disabled)
  expect(onWritten).not.toHaveBeenCalled()
})

it('rejects an empty base for an existing file instead of overwriting it', async () => {
  const root = await temporaryRoot()
  const path = join(root, 'mcp.json')
  await writeFile(path, disabled, 'utf8')

  await expect(writeKunMcpConfigFile({ path, content: enabled, baseContent: '' }))
    .rejects.toBeInstanceOf(McpConfigStaleWriteError)
  expect(await readFile(path, 'utf8')).toBe(disabled)
})

it('treats the file as absent only for ENOENT', async () => {
  const root = await temporaryRoot()
  const path = join(root, 'mcp.json')

  await writeKunMcpConfigFile({ path, content: enabled, baseContent: '' })
  expect(await readFile(path, 'utf8')).toBe(enabled)

  const unreadable = join(root, 'unreadable.json')
  await mkdir(unreadable)
  await expect(writeKunMcpConfigFile({ path: unreadable, content: enabled, baseContent: '' }))
    .rejects.toThrow()
})

it('waits for the shared lock another process holds', async () => {
  const root = await temporaryRoot()
  const path = join(root, 'mcp.json')
  await writeFile(path, disabled, 'utf8')
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs')
    const os = require('node:os')
    fs.writeFileSync(process.env.LOCK_PATH, JSON.stringify({
      version: 1, token: 'child', pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString()
    }))
    process.stdout.write('ready\\n')
    process.stdin.resume()
  `], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, LOCK_PATH: `${path}.lock` } })
  cleanup.push(async () => { child.kill('SIGKILL') })
  await new Promise<void>((resolve) => child.stdout?.on('data', (chunk) => {
    if (String(chunk).includes('ready')) resolve()
  }))

  const previous = process.env.KUN_MCP_LOCK_TIMEOUT_MS
  process.env.KUN_MCP_LOCK_TIMEOUT_MS = '200'
  try {
    await expect(writeKunMcpConfigFile({ path, content: enabled, baseContent: disabled }))
      .rejects.toThrow(/Timed out waiting for the MCP configuration lock/)
  } finally {
    if (previous === undefined) delete process.env.KUN_MCP_LOCK_TIMEOUT_MS
    else process.env.KUN_MCP_LOCK_TIMEOUT_MS = previous
  }
  // A blocked writer must not touch the file.
  expect(await readFile(path, 'utf8')).toBe(disabled)
})

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  McpLockTimeoutError,
  acquireMcpLock,
  breakStaleMcpLock,
  mcpLockBreakClaimPath,
  releaseMcpLock,
  sharedMcpLockPath,
  withMcpLock,
  withSharedMcpLock
} from './runtime-mcp-lock.js'

const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-mcp-lock-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  return root
}

function lockOwner(pid: number, host = hostname(), token = 'owner-token') {
  return { version: 1 as const, token, pid, host, createdAt: new Date().toISOString() }
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  if (pid === undefined) throw new Error('could not spawn a short-lived process')
  return pid
}

/** A second OS process that owns the lock until it is killed. */
function holdLockInChild(lockPath: string): { child: ChildProcess; ready: Promise<void> } {
  const script = `
    const fs = require('node:fs')
    const os = require('node:os')
    fs.writeFileSync(process.env.LOCK_PATH, JSON.stringify({
      version: 1, token: 'child-token', pid: process.pid, host: os.hostname(),
      createdAt: new Date().toISOString()
    }))
    process.stdout.write('ready\\n')
    process.stdin.resume()
  `
  const child = spawn(process.execPath, ['-e', script], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, LOCK_PATH: lockPath }
  })
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false
    child.stdout?.on('data', (chunk) => {
      if (settled || !String(chunk).includes('ready')) return
      settled = true
      resolve()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`lock holder exited with ${code}`))
    })
  })
  return { child, ready }
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
}

it('serializes two writers on the same lock path', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  const owner = await acquireMcpLock(lockPath)
  await expect(acquireMcpLock(lockPath, { timeoutMs: 100, pollMs: 5 }))
    .rejects.toBeInstanceOf(McpLockTimeoutError)
  await releaseMcpLock(lockPath, owner)
  await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  const again = await acquireMcpLock(lockPath, { timeoutMs: 100 })
  await releaseMcpLock(lockPath, again)
})

it('blocks while another process owns the lock and takes over after it dies', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  const { child, ready } = holdLockInChild(lockPath)
  cleanup.push(async () => { child.kill('SIGKILL'); await waitForExit(child) })
  await ready

  await expect(acquireMcpLock(lockPath, { timeoutMs: 200, pollMs: 5 }))
    .rejects.toBeInstanceOf(McpLockTimeoutError)

  child.kill('SIGKILL')
  await waitForExit(child)
  const owner = await acquireMcpLock(lockPath, { timeoutMs: 3_000, pollMs: 10 })
  // Takeover must replace the dead owner with our own record.
  const written = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number; token: string }
  expect(written.pid).toBe(process.pid)
  expect(written.token).toBe(owner.token)
  await releaseMcpLock(lockPath, owner)
})

it('does not treat an unreadable owner record as an absent lock', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  await writeFile(lockPath, '{ not an owner record', 'utf8')

  await expect(acquireMcpLock(lockPath, { timeoutMs: 150, pollMs: 5 }))
    .rejects.toBeInstanceOf(McpLockTimeoutError)
  expect(await readFile(lockPath, 'utf8')).toBe('{ not an owner record')
})

it('does not take over a lock recorded by another host', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  await writeFile(lockPath, JSON.stringify(lockOwner(process.pid, 'another-host')), 'utf8')

  await expect(acquireMcpLock(lockPath, { timeoutMs: 150, pollMs: 5 }))
    .rejects.toBeInstanceOf(McpLockTimeoutError)
})

it('takes over a lock whose owner process is gone', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const deadPid = dead.pid
  await waitForExit(dead)
  expect(deadPid).toBeTypeOf('number')
  await writeFile(lockPath, JSON.stringify(lockOwner(deadPid!)), 'utf8')

  const owner = await acquireMcpLock(lockPath, { timeoutMs: 1_000, pollMs: 5 })
  await releaseMcpLock(lockPath, owner)
})

it('does not let a non-owner release someone else lock', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  await writeFile(lockPath, JSON.stringify(lockOwner(process.pid, hostname(), 'other-token')), 'utf8')

  await releaseMcpLock(lockPath, { ...lockOwner(process.pid, hostname(), 'my-token') })
  expect(JSON.parse(await readFile(lockPath, 'utf8')).token).toBe('other-token')
})

it('keys the shared-file lock to the shared file path', async () => {
  const root = await temporaryRoot()
  const sharedPath = join(root, 'mcp.json')
  const lockPath = sharedMcpLockPath(sharedPath)
  expect(lockPath).toBe(`${sharedPath}.lock`)

  let observedPid = 0
  await withSharedMcpLock(sharedPath, async () => {
    observedPid = (JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number }).pid
  })
  expect(observedPid).toBe(process.pid)
  await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('releases the lock when the operation throws', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  await expect(withMcpLock(lockPath, async () => { throw new Error('boom') }))
    .rejects.toThrow('boom')
  const owner = await acquireMcpLock(lockPath, { timeoutMs: 100 })
  await releaseMcpLock(lockPath, owner)
})

it('never removes a lock that a competing breaker already published', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  const staleOwner = lockOwner(await deadPid(), hostname(), 'dead-token')
  await writeFile(lockPath, JSON.stringify(staleOwner), 'utf8')

  // A observes the dead lock, removes it and publishes its own lock.
  expect(await breakStaleMcpLock(lockPath, staleOwner)).toBe(true)
  const owner = await acquireMcpLock(lockPath, { timeoutMs: 500 })

  // B still holds its stale observation of the dead owner. It must not remove
  // the live lock A just published.
  expect(await breakStaleMcpLock(lockPath, staleOwner)).toBe(false)
  const intact = JSON.parse(await readFile(lockPath, 'utf8')) as { token: string; pid: number }
  expect(intact.token).toBe(owner.token)
  expect(intact.pid).toBe(process.pid)
  await releaseMcpLock(lockPath, owner)
})

it('lets only one breaker claim the same dead token', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  const staleOwner = lockOwner(await deadPid(), hostname(), 'dead-token')
  await writeFile(lockPath, JSON.stringify(staleOwner), 'utf8')

  const results = await Promise.all([
    breakStaleMcpLock(lockPath, staleOwner),
    breakStaleMcpLock(lockPath, staleOwner)
  ])
  expect(results.some(Boolean)).toBe(true)
  // The dead lock is gone and no breaker published a phantom owner.
  await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(mcpLockBreakClaimPath(lockPath, 'dead-token')))
    .rejects.toMatchObject({ code: 'ENOENT' })
})

it('waits instead of stealing while another process holds the break claim', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  const staleOwner = lockOwner(await deadPid(), hostname(), 'dead-token')
  await writeFile(lockPath, JSON.stringify(staleOwner), 'utf8')
  const claimPath = mcpLockBreakClaimPath(lockPath, staleOwner.token)
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs')
    const os = require('node:os')
    fs.writeFileSync(process.env.CLAIM_PATH, JSON.stringify({
      version: 1, token: 'child', pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString()
    }))
    process.stdout.write('ready\\n')
    process.stdin.resume()
  `], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, CLAIM_PATH: claimPath } })
  cleanup.push(async () => { child.kill('SIGKILL') })
  await new Promise<void>((resolve) => child.stdout?.on('data', (chunk) => {
    if (String(chunk).includes('ready')) resolve()
  }))

  await expect(acquireMcpLock(lockPath, { timeoutMs: 250, pollMs: 5 }))
    .rejects.toBeInstanceOf(McpLockTimeoutError)
  // The dead lock was not stolen while the breaker claim was held.
  expect((JSON.parse(await readFile(lockPath, 'utf8')) as { token: string }).token)
    .toBe(staleOwner.token)
})

it('keeps a crashed breaker claim unavailable and explains how to recover', async () => {
  const root = await temporaryRoot()
  const lockPath = join(root, 'mcp-config.lock')
  const staleOwner = lockOwner(await deadPid(), hostname(), 'dead-token')
  await writeFile(lockPath, JSON.stringify(staleOwner), 'utf8')
  const claimPath = mcpLockBreakClaimPath(lockPath, staleOwner.token)
  // A breaker died after claiming the token: nobody may guess that the lock is
  // still the one it observed, so the claim stays and acquisition fails closed.
  await writeFile(
    claimPath,
    JSON.stringify(lockOwner(await deadPid(), hostname(), 'claim-token')),
    'utf8'
  )

  let error: unknown
  try {
    await acquireMcpLock(lockPath, { timeoutMs: 150, pollMs: 5 })
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(McpLockTimeoutError)
  const message = error instanceof Error ? error.message : ''
  expect(message).toContain('Timed out waiting for the MCP configuration lock')
  expect(message).toContain(claimPath)
  expect(message).toContain('process is gone')
  expect(message).toContain('remove')
  // Neither the dead lock nor the claim was removed automatically.
  expect((JSON.parse(await readFile(lockPath, 'utf8')) as { token: string }).token).toBe('dead-token')
  expect(JSON.parse(await readFile(claimPath, 'utf8')) as { token: string }).toMatchObject({
    token: 'claim-token'
  })
})

import { spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { GmailError } from './ports.js'

const CACHE_MS = 10_000
const MAX_PROBE_BYTES = 256 * 1024
const PROBE_TIMEOUT_MS = 4_000
const protectionMessage = 'Gmail mail access requires verified encrypted local storage. Enable FileVault for Kun’s data location or move Kun’s data to an encrypted volume.'
type StorageLocation = { path: string; filesystemId: string }
type Probe = (command: string, args: readonly string[], input?: string) => Promise<string>
type Dependencies = {
  platform: NodeJS.Platform
  locate: (dataDir: string) => Promise<StorageLocation>
  run: Probe
  now: () => number
}

/** Verify the physical volume used by app-managed history, caches and diagnostics. */
export class EncryptedGmailStorageGuard {
  private readonly cache = new Map<string, { expiresAt: number; result: Promise<void> }>()
  constructor(private readonly dependencies: Dependencies = {
    platform: process.platform, locate: locateStorage, run: runProbe, now: Date.now
  }) {}

  async assert(dataDir: string): Promise<void> {
    if (this.dependencies.platform !== 'darwin') {
      throw new GmailError('storage_protection_required',
        'Gmail mail access is unavailable until encrypted local storage can be verified on this platform.')
    }
    let location: StorageLocation
    try { location = await this.dependencies.locate(dataDir) }
    catch { throw new GmailError('storage_protection_required', protectionMessage) }
    // Resolve and stat on each access so a moved profile or changed mount cannot
    // inherit the cached result for an earlier physical filesystem.
    const key = `${location.path}\n${location.filesystemId}`
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.dependencies.now()) return cached.result
    const result = this.verify(location.path)
    this.cache.set(key, { expiresAt: this.dependencies.now() + CACHE_MS, result })
    while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!)
    return result
  }

  private async verify(path: string): Promise<void> {
    try {
      const output = await this.dependencies.run('/bin/df', ['-P', path])
      const lines = output.trim().split(/\r?\n/u)
      // df -P emits one portable-format record. Never pass an arbitrary mount
      // name or a parsed shell fragment to diskutil.
      if (lines.length !== 2) throw new Error('Unexpected filesystem report')
      const device = /^(\/dev\/[A-Za-z0-9._-]+)\s/u.exec(lines[1])?.[1]
      if (!device) throw new Error('Local disk identity is unavailable')
      const plist = await this.dependencies.run('/usr/sbin/diskutil', ['info', '-plist', device])
      const json = await this.dependencies.run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], plist)
      const info: unknown = JSON.parse(json)
      if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Invalid volume report')
      const flags = info as Record<string, unknown>
      if (flags.FileVault !== true || flags.Encryption !== true || flags.EncryptionThisVolumeProper !== true) {
        throw new Error('Volume encryption is not verified')
      }
    } catch {
      throw new GmailError('storage_protection_required', protectionMessage)
    }
  }
}

/** Missing profile directories are checked against their nearest existing parent. */
export async function locateStorage(dataDir: string): Promise<StorageLocation> {
  let path = resolve(dataDir)
  for (;;) {
    try {
      const canonical = await realpath(path)
      const info = await stat(canonical)
      if (!info.isDirectory()) throw new Error('Kun data location is not a directory')
      return { path: canonical, filesystemId: String(info.dev) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error
      path = dirname(path)
    }
  }
}

/** Bounded host utility calls; no shell or environment-controlled verifier. */
async function runProbe(command: string, args: readonly string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) { child.kill(); reject(error) }
      else resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const timer = setTimeout(() => finish(new Error('Storage verification timed out')), PROBE_TIMEOUT_MS)
    child.on('error', () => finish(new Error('Storage verifier is unavailable')))
    child.stdin.on('error', () => finish(new Error('Storage verifier input failed')))
    child.stdout.on('data', (value: Buffer) => {
      bytes += value.length
      if (bytes > MAX_PROBE_BYTES) finish(new Error('Storage report exceeded its limit'))
      else chunks.push(value)
    })
    child.stderr.on('data', (value: Buffer) => {
      bytes += value.length
      if (bytes > MAX_PROBE_BYTES) finish(new Error('Storage report exceeded its limit'))
    })
    child.on('close', (code) => finish(code === 0 ? undefined : new Error('Storage verification failed')))
    child.stdin.end(input ?? '')
  })
}

const storageGuard = new EncryptedGmailStorageGuard()
export const assertEncryptedGmailStorage = (dataDir: string): Promise<void> => storageGuard.assert(dataDir)

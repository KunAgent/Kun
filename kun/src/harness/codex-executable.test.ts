import { describe, expect, it, vi } from 'vitest'
import { codexMetadataProbeArgs, discoverCodexExecutable, resolveCodexExecutable } from './codex-executable.js'

const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
const resolve = vi.fn(async (command: string) => command === 'codex' ? '/old/codex' : command === bundled ? bundled : undefined)

describe('Codex automatic executable selection', () => {
  it('uses the newer installed official CLI for automatic native discovery', async () => {
    const version = vi.fn(async (command: string) => command === bundled ? '0.159.2' : '0.145.0')
    expect(await discoverCodexExecutable({ platform: 'darwin', home: '/home', resolve, version,
      nativeBinary: async () => true })).toBe(bundled)
  })
  it('keeps newer PATH binaries and custom account wrappers', async () => {
    expect(await discoverCodexExecutable({ platform: 'darwin', resolve, nativeBinary: async () => true,
      version: async (command) => command === bundled ? '0.159.2' : '0.160.0' })).toBe('/old/codex')
    const version = vi.fn(async () => '0.145.0')
    expect(await discoverCodexExecutable({ platform: 'darwin', resolve, version,
      nativeBinary: async () => false })).toBe('/old/codex')
    expect(version).not.toHaveBeenCalled()
  })
  it('honors explicit commands and does not scan macOS apps on other platforms', async () => {
    expect(await resolveCodexExecutable('/pinned/codex')).toBe('/pinned/codex')
    expect(await resolveCodexExecutable('codex', true)).toBe('codex')
    expect(await discoverCodexExecutable({ platform: 'linux', resolve })).toBe('/old/codex')
    expect(codexMetadataProbeArgs()).toEqual(['-c', 'features.plugins=false', '-s', 'read-only', '-a', 'never', 'app-server'])
  })
})

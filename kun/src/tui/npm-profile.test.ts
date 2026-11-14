import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTuiOptions } from './options.js'
import { defaultTuiRendererHost, runTuiCommand } from './index.js'
import * as tuiNode from './tui-node.js'
import * as gui from '../cli/gui-settings-bridge.js'

vi.mock('../cli/npm-distribution.js', async (original) => ({
  ...await original<typeof import('../cli/npm-distribution.js')>(),
  isNpmDistribution: () => true
}))

describe('standalone npm TUI profile', () => {
  it('returns a parse error for invalid explicit configuration, while help stays available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-npm-tui-invalid-'))
    try {
      const config = join(root, 'config.json')
      await writeFile(config, '{broken')
      expect(parseTuiOptions(['--config', config], {}, () => root)).toMatchObject({
        ok: false, message: expect.stringContaining('invalid configuration:')
      })
      expect(parseTuiOptions(['--config', config, '--help'], {}, () => root)).toMatchObject({
        ok: true, options: { help: true }
      })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('honors explicit config and its data directory before the GUI default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-npm-tui-config-'))
    try {
      const config = join(root, 'config.json')
      await writeFile(config, JSON.stringify({ serve: { dataDir: join(root, 'data'), model: 'fixture' } }))
      expect(parseTuiOptions(['--config', config], {}, () => root)).toMatchObject({
        ok: true, options: { configPath: config, dataDir: join(root, 'data'), dataDirSource: 'configuration' }
      })
      expect(parseTuiOptions(['--config', config, '--data-dir', join(root, 'explicit')], {}, () => root)).toMatchObject({
        ok: true, options: { dataDir: join(root, 'explicit'), dataDirSource: 'argument' }
      })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('does not inspect or project GUI settings before opening an npm session', async () => {
    const settings = vi.spyOn(gui, 'readGuiSharedSettings')
    const resolveConnection = vi.fn(async () => { throw new Error('fixture connection stop') })
    try {
      const code = await runTuiCommand(['--data-dir', '/fixture/data'], {
        stdin: { isTTY: true } as unknown as NodeJS.ReadableStream,
        stdout: { isTTY: true, write: () => undefined }, stderr: { write: () => undefined },
        env: {}, nodeVersion: '26.12.0', resolveConnection,
        renderer: { availableInProcess: async () => true, handoff: async () => 0 }
      })
      expect(code).toBe(70)
      expect(resolveConnection).toHaveBeenCalledOnce()
      expect(settings).not.toHaveBeenCalled()
    } finally { settings.mockRestore() }
  })

  it('uses the installation interpreter for an npm FFI handoff without downloading', async () => {
    const handoff = vi.spyOn(tuiNode, 'handoffToTuiNode').mockResolvedValue(0)
    const download = vi.spyOn(tuiNode, 'downloadTuiNode')
    try {
      expect(await defaultTuiRendererHost.handoff([], {}, { write: () => undefined })).toBe(0)
      expect(handoff).toHaveBeenCalledWith({ path: process.execPath, source: 'system', version: process.versions.node }, [], {})
      expect(download).not.toHaveBeenCalled()
    } finally { handoff.mockRestore(); download.mockRestore() }
  })
})

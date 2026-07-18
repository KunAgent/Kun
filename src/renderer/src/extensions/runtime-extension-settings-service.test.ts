import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionUpdateConfigurationRequest } from '@shared/extension-ipc'
import { RuntimeExtensionSettingsService } from './runtime-extension-settings-service'

describe('RuntimeExtensionSettingsService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps composite runtime revisions to one optimistic renderer snapshot', async () => {
    const load = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        schemaVersion: 1,
        revisions: { 'acme.one': 4, 'acme.two': 7 },
        values: {
          'extension:acme.one/general': { mode: 'safe' },
          'extension:acme.two/general': { enabled: true }
        }
      })
    }))
    const update = vi.fn(async (input: ExtensionUpdateConfigurationRequest) => {
      expect(input).toMatchObject({
        contributionId: 'extension:acme.one/general',
        expectedRevision: 4,
        workspaceRoot: '/workspace'
      })
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          extensionId: 'acme.one',
          revision: 5,
          values: { 'extension:acme.one/general': { mode: 'fast' } }
        })
      }
    })
    const service = new RuntimeExtensionSettingsService({ load, update })
    const loaded = await service.load({
      contributionIds: ['extension:acme.one/general', 'extension:acme.two/general'],
      workspaceRoot: '/workspace'
    })
    const updated = await service.update({
      contributionId: 'extension:acme.one/general',
      key: 'mode',
      value: 'fast',
      expectedRevision: loaded.revision,
      workspaceRoot: '/workspace'
    })
    expect(updated.values).toEqual({
      'extension:acme.one/general': { mode: 'fast' },
      'extension:acme.two/general': { enabled: true }
    })
    await expect(service.update({
      contributionId: 'extension:acme.one/general',
      key: 'mode',
      value: 'safe',
      expectedRevision: loaded.revision,
      workspaceRoot: '/workspace'
    })).rejects.toThrow(/reload/)
  })

  it('uses strict Main configuration bridges instead of the generic runtime bridge', async () => {
    const api = {
      extensionLoadConfiguration: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          revisions: { 'acme.one': 2 },
          values: { 'extension:acme.one/general': { mode: 'safe' } }
        })
      })),
      extensionUpdateConfiguration: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          extensionId: 'acme.one',
          revision: 3,
          values: { 'extension:acme.one/general': { mode: 'fast' } }
        })
      }))
    }
    vi.stubGlobal('window', { kunGui: api })
    const service = new RuntimeExtensionSettingsService()
    const loaded = await service.load({
      contributionIds: ['extension:acme.one/general'],
      workspaceRoot: '/workspace'
    })
    await expect(service.update({
      contributionId: 'extension:acme.one/general',
      key: 'mode',
      value: 'fast',
      expectedRevision: loaded.revision,
      workspaceRoot: '/workspace'
    })).resolves.toMatchObject({
      values: { 'extension:acme.one/general': { mode: 'fast' } }
    })

    expect(api.extensionLoadConfiguration).toHaveBeenCalledWith({
      contributionIds: ['extension:acme.one/general'],
      workspaceRoot: '/workspace'
    })
    expect(api.extensionUpdateConfiguration).toHaveBeenCalledWith({
      contributionId: 'extension:acme.one/general',
      key: 'mode',
      value: 'fast',
      expectedRevision: 2,
      workspaceRoot: '/workspace'
    })
  })

  it('does not let a late workspace load overwrite the newest settings scope', async () => {
    let resolveFirst!: (value: { ok: true; status: number; body: string }) => void
    const first = new Promise<{ ok: true; status: number; body: string }>((resolve) => {
      resolveFirst = resolve
    })
    const load = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          revisions: { 'acme.one': 2 },
          values: { 'extension:acme.one/general': { workspace: 'b' } }
        })
      })
    const service = new RuntimeExtensionSettingsService({ load, update: vi.fn() })
    const stale = service.load({
      contributionIds: ['extension:acme.one/general'],
      workspaceRoot: '/workspace-a'
    })
    const current = await service.load({
      contributionIds: ['extension:acme.one/general'],
      workspaceRoot: '/workspace-b'
    })
    resolveFirst({
      ok: true,
      status: 200,
      body: JSON.stringify({
        schemaVersion: 1,
        revisions: { 'acme.one': 1 },
        values: { 'extension:acme.one/general': { workspace: 'a' } }
      })
    })

    await expect(stale).rejects.toThrow(/superseded/)
    expect(current.values).toEqual({
      'extension:acme.one/general': { workspace: 'b' }
    })
    await expect(service.update({
      contributionId: 'extension:acme.one/general',
      key: 'workspace',
      value: 'b2',
      expectedRevision: current.revision,
      workspaceRoot: '/workspace-a'
    })).rejects.toThrow(/workspace changed/)
  })
})

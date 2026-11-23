import { describe, expect, it, vi } from 'vitest'
import { emptyCodeWorkspaceFolderSetsRegistry, normalizeCodeWorkspaceFolderSetsRegistry } from './code-workspace-folder-sets'
import { saveCodeWorkspaceProjectDraft } from './code-workspace-project-save'

const APP = '/Users/zxy/Code/app'
const API = '/Users/zxy/Code/api'

describe('saveCodeWorkspaceProjectDraft', () => {
  it('creates a named project after re-verifying every folder', async () => {
    const directoryExists = vi.fn(async () => true)
    const result = await saveCodeWorkspaceProjectDraft({
      mode: 'create',
      displayName: ' Storefront ',
      primary: APP,
      extraRoots: [API]
    }, { registry: emptyCodeWorkspaceFolderSetsRegistry(), directoryExists })
    expect(result).toEqual({
      ok: true,
      registry: {
        version: 1,
        sets: [{ primary: APP, extraRoots: [API], displayName: 'Storefront' }]
      },
      set: { primary: APP, extraRoots: [API], displayName: 'Storefront' }
    })
    expect(directoryExists).toHaveBeenCalledWith(APP)
    expect(directoryExists).toHaveBeenCalledWith(API)
  })

  it('writes nothing when a folder disappeared before saving', async () => {
    const registry = emptyCodeWorkspaceFolderSetsRegistry()
    const result = await saveCodeWorkspaceProjectDraft({
      mode: 'create',
      displayName: 'Storefront',
      primary: APP,
      extraRoots: [API]
    }, {
      registry,
      directoryExists: async (path) => path !== API
    })
    expect(result).toEqual({ ok: false, error: 'directory-missing', path: API })
    expect(registry.sets).toEqual([])
  })

  it('rejects conversation folders and invalid drafts', async () => {
    const conversation = await saveCodeWorkspaceProjectDraft({
      mode: 'create',
      displayName: 'Chat',
      primary: '/Users/zxy/.kun/conversations/chat-1',
      extraRoots: []
    }, {
      registry: emptyCodeWorkspaceFolderSetsRegistry(),
      conversationRoot: '/Users/zxy/.kun/conversations',
      directoryExists: async () => true
    })
    expect(conversation).toEqual({
      ok: false,
      error: 'conversation-dir',
      path: '/Users/zxy/.kun/conversations/chat-1'
    })

    const missingName = await saveCodeWorkspaceProjectDraft({
      mode: 'create',
      displayName: '',
      primary: APP,
      extraRoots: []
    }, { registry: emptyCodeWorkspaceFolderSetsRegistry(), directoryExists: async () => true })
    expect(missingName).toEqual({ ok: false, error: 'missing-name' })
  })

  it('updates a managed project without changing its primary folder', async () => {
    const registry = normalizeCodeWorkspaceFolderSetsRegistry({
      version: 1,
      sets: [{ primary: APP, extraRoots: [API], displayName: 'Storefront' }]
    })
    const result = await saveCodeWorkspaceProjectDraft({
      mode: 'manage',
      displayName: 'Renamed',
      primary: APP,
      extraRoots: []
    }, { registry, directoryExists: async () => true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.set.primary).toBe(APP)
    expect(result.set.extraRoots).toEqual([])
    expect(result.registry.sets).toEqual([
      { primary: APP, extraRoots: [], displayName: 'Renamed' }
    ])
  })
})

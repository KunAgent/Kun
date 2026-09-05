import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ExtensionProviderAccountStore,
  extensionProviderBindingScope
} from './extension-provider-account-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ExtensionProviderAccountStore bindings', () => {
  it('persists an exact scoped opaque binding without copying credential references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-provider-binding-'))
    roots.push(root)
    const now = '2026-07-11T00:00:00.000Z'
    const store = new ExtensionProviderAccountStore({ dataDir: root, nowIso: () => now })
    const principal = {
      extensionId: 'acme.models',
      extensionVersion: '1.2.3',
      permissions: ['providers.register', 'accounts.read'],
      workspaceRoots: ['/workspace'],
      workspaceTrusted: true
    }
    const provider = await store.registerProvider(principal, {
      id: 'models',
      displayName: 'Acme Models',
      authTypes: ['api-key'],
      apiKey: { headerName: 'Authorization', prefix: 'Bearer ' },
      capabilities: {
        streaming: true,
        toolCalls: true,
        reasoning: false,
        images: false,
        documents: false,
        tokenCounting: false
      }
    })
    const account = await store.createAccount({
      principal,
      providerId: provider.id,
      label: 'Work',
      authType: 'api-key',
      credentialRef: 'credential_ref_must_not_be_copied'
    })
    const scopeKey = extensionProviderBindingScope('/workspace')
    await store.setBinding({
      scopeKey,
      ownerExtensionId: principal.extensionId,
      ownerExtensionVersion: principal.extensionVersion,
      binding: { providerId: provider.id, accountId: account.id, modelId: 'model-a' },
      dataAccessDigest: 'a'.repeat(64),
      dataCategories: [
        'conversation-history',
        'system-and-mode-instructions',
        'attachments',
        'tool-schemas'
      ]
    })

    const reopened = new ExtensionProviderAccountStore({ dataDir: root })
    await expect(reopened.getBinding(scopeKey, provider.id)).resolves.toMatchObject({
      scopeKey,
      ownerExtensionId: 'acme.models',
      ownerExtensionVersion: '1.2.3',
      binding: { providerId: provider.id, accountId: account.id, modelId: 'model-a' },
      dataAccessDigest: 'a'.repeat(64)
    })
    const bindingFile = await readFile(join(root, 'extensions', 'provider-bindings.json'), 'utf8')
    expect(bindingFile).not.toContain('credential_ref_must_not_be_copied')
  })

  it('reads and clears legacy hash-keyed bindings before rewriting them with the current key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-provider-binding-legacy-'))
    roots.push(root)
    const scopeKey = 'workspace:/legacy'
    const providerId = 'ext-acme-models'
    const path = join(root, 'extensions', 'provider-bindings.json')
    await mkdir(join(root, 'extensions'), { recursive: true })
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      proxyRoutingVersion: 1,
      revision: 1,
      bindings: {
        legacySha256Key: {
          scopeKey,
          ownerExtensionId: 'acme.models',
          ownerExtensionVersion: '1.0.0',
          binding: { providerId, accountId: 'account-1', modelId: 'model-1' },
          dataAccessDigest: 'a'.repeat(64),
          dataCategories: ['conversation-history'],
          acknowledgedAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        }
      }
    }), 'utf8')

    const store = new ExtensionProviderAccountStore({ dataDir: root })
    await expect(store.getBinding(scopeKey, providerId)).resolves.toMatchObject({
      binding: { providerId, accountId: 'account-1' }
    })
    await expect(store.clearBinding(scopeKey, providerId)).resolves.toBe(true)
    await expect(store.getBinding(scopeKey, providerId)).resolves.toBeNull()
  })
})

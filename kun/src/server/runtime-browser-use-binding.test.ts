import { afterEach, describe, expect, it } from 'vitest'
import { HostBridgeBrowserController } from '../adapters/browser-use/browser-controller.js'
import {
  currentBrowserUseHostAuthority,
  resetBrowserUseHostAuthorityForTests
} from '../adapters/browser-use/browser-controller-authority.js'
import { RuntimeConfigApplyRequest } from '../contracts/runtime-config.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { mergeRuntimeConfigApplyOptions } from './runtime-factory-config.js'
import {
  resetRevokedBrowserUseBindingsForTests,
  stageBrowserUseHostBinding
} from './runtime-browser-use-binding.js'

const binding = {
  bridgeUrl: 'http://127.0.0.1:23456',
  bridgeToken: 'b'.repeat(43),
  approvalSigningKey: 's'.repeat(43)
}

describe('runtime Browser Use host binding', () => {
  afterEach(() => {
    resetBrowserUseHostAuthorityForTests()
    resetRevokedBrowserUseBindingsForTests()
  })

  it('rolls back a failed staged replacement without persisting authority', () => {
    const controller = new HostBridgeBrowserController()
    const staged = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: binding
    }))
    expect(controller.readiness()).toEqual({ available: true })
    staged.rollback()
    expect(controller.readiness()).toMatchObject({ available: false })
  })

  it('commits replacement and revokes it on a disabled capability apply', () => {
    const controller = new HostBridgeBrowserController()
    const staged = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: binding
    }))
    staged.commit()
    staged.rollback()
    expect(controller.readiness()).toEqual({ available: true })

    const disabled = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      capabilities: { browserUse: { enabled: false } },
      // A contradictory caller-provided binding must not retain authority when
      // the capability itself is disabled.
      browserUseHostBinding: binding
    }))
    disabled.commit()
    expect(controller.readiness()).toMatchObject({ available: false })
  })

  it('does not revoke an active lease when the same binding is reapplied', () => {
    const first = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: binding
    }))
    first.commit()
    const lease = currentBrowserUseHostAuthority()

    const same = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: binding
    }))
    same.commit()
    expect(lease.signal.aborted).toBe(false)

    const changed = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: { ...binding, bridgeToken: 'n'.repeat(43) }
    }))
    changed.commit()
    expect(lease.signal.aborted).toBe(true)
  })

  it('makes an exiting owner revoke conditional and rejects its late rebind', () => {
    const initial = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: binding
    }))
    initial.commit()

    const revoke = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: null,
      browserUseHostBindingRevoke: binding
    }))
    revoke.commit()
    expect(currentBrowserUseHostAuthority().binding).toBeUndefined()

    const late = stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: binding
    }))
    late.commit()
    expect(currentBrowserUseHostAuthority().binding).toBeUndefined()
  })

  it('does not let an old owner revoke a newer owner binding', () => {
    const newer = { ...binding, bridgeToken: 'n'.repeat(43) }
    stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: binding
    })).commit()
    stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: newer
    })).commit()

    stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: null,
      browserUseHostBindingRevoke: binding
    })).commit()
    expect(currentBrowserUseHostAuthority().binding).toEqual(newer)
  })

  it('lets explicit capability disable override a mismatched conditional revoke', () => {
    const newer = { ...binding, bridgeToken: 'n'.repeat(43) }
    stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: newer
    })).commit()

    stageBrowserUseHostBinding(RuntimeConfigApplyRequest.parse({
      capabilities: { browserUse: { enabled: false } },
      browserUseHostBinding: null,
      browserUseHostBindingRevoke: binding
    })).commit()
    expect(currentBrowserUseHostAuthority().binding).toBeUndefined()
  })

  it('preserves protected provider credential bindings across secret-free hot applies', () => {
    const current = {
      host: '127.0.0.1',
      port: 18899,
      dataDir: '/tmp/kun',
      runtimeToken: 'runtime-token',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      providers: {
        custom: {
          apiKey: '',
          credentialSourceId: 'model-connection:custom',
          baseUrl: 'https://old.example/v1',
          models: ['model-a']
        }
      }
    } as KunServeRuntimeOptions
    const request = RuntimeConfigApplyRequest.parse({
      serve: {
        providers: {
          custom: {
            apiKey: '',
            baseUrl: 'https://new.example/v1',
            models: ['model-a']
          }
        }
      }
    })

    expect(mergeRuntimeConfigApplyOptions(current, request).providers?.custom).toMatchObject({
      baseUrl: 'https://new.example/v1',
      credentialSourceId: 'model-connection:custom'
    })
  })

  it('applies and preserves the dedicated Fast Context route during hot config merges', () => {
    const current = {
      host: '127.0.0.1',
      port: 18899,
      dataDir: '/tmp/kun',
      runtimeToken: 'runtime-token',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      model: 'main-model',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      fastContext: {
        enabled: true,
        model: 'old-fast-context-model',
        providerId: 'old-fast-context-provider',
        fast: false
      }
    } as KunServeRuntimeOptions
    const configured = {
      enabled: true,
      model: 'deepseek-v4-flash',
      providerId: 'deepseek',
      reasoningEffort: 'max' as const,
      fast: false
    }

    const updated = mergeRuntimeConfigApplyOptions(current, RuntimeConfigApplyRequest.parse({
      fastContext: configured
    }))
    expect(updated.fastContext).toEqual(configured)
    expect(mergeRuntimeConfigApplyOptions(updated, RuntimeConfigApplyRequest.parse({})).fastContext)
      .toEqual(configured)
  })

  it('keeps the ephemeral binding out of active and persistable runtime options', () => {
    const request = RuntimeConfigApplyRequest.parse({ browserUseHostBinding: binding })
    const activeOptions = mergeRuntimeConfigApplyOptions({
      host: '127.0.0.1',
      port: 18899,
      dataDir: '/tmp/kun',
      runtimeToken: 'runtime-token',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false
    } as KunServeRuntimeOptions, request)

    expect(activeOptions).not.toHaveProperty('browserUseHostBinding')
    expect(JSON.stringify(activeOptions)).not.toContain(binding.bridgeToken)

    const revokeRequest = RuntimeConfigApplyRequest.parse({
      browserUseHostBinding: null,
      browserUseHostBindingRevoke: binding
    })
    const afterRevoke = mergeRuntimeConfigApplyOptions(activeOptions, revokeRequest)
    expect(afterRevoke).not.toHaveProperty('browserUseHostBinding')
    expect(afterRevoke).not.toHaveProperty('browserUseHostBindingRevoke')
    expect(JSON.stringify(afterRevoke)).not.toContain(binding.bridgeToken)
    expect(JSON.stringify(afterRevoke)).not.toContain(binding.approvalSigningKey)
  })
})

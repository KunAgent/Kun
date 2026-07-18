import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedHostContentScript } from './extension-descriptor-resolver'
import { ExtensionContentScriptController } from './extension-content-script-controller'

let packageRoot = ''

beforeEach(async () => {
  vi.useFakeTimers()
  packageRoot = await mkdtemp(join(tmpdir(), 'kun-direct-dom-'))
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(join(packageRoot, 'dist/content.js'), 'globalThis.__kunDirectDomRan = true\n')
  await writeFile(join(packageRoot, 'dist/content.css'), '.kun-direct-dom { color: red }\n')
})

afterEach(async () => {
  vi.useRealTimers()
  if (packageRoot) await rm(packageRoot, { recursive: true, force: true })
  packageRoot = ''
})

function resolved(runAt: 'documentStart' | 'documentEnd'): ResolvedHostContentScript {
  return {
    extensionId: 'acme.dom',
    extensionVersion: '1.2.3',
    packageRoot,
    contributionId: 'decorate',
    scripts: ['dist/content.js'],
    styles: ['dist/content.css'],
    runAt
  } as ResolvedHostContentScript
}

function frameFixture() {
  const destroyedListeners: Array<() => void> = []
  let destroyed = false
  const frame = {
    id: 17,
    isDestroyed: () => destroyed,
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.push(listener)
      return frame
    }),
    send: vi.fn(),
    reload: vi.fn(),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined)
  }
  return {
    frame: frame as unknown as WebContents,
    destroy() {
      destroyed = true
      for (const listener of destroyedListeners) listener()
    },
    send: frame.send,
    reload: frame.reload,
    execute: frame.executeJavaScriptInIsolatedWorld
  }
}

function controllerFor(contribution: ResolvedHostContentScript) {
  const resolveHostContentScript = vi.fn(async () => contribution)
  const diagnostics: unknown[] = []
  const controller = new ExtensionContentScriptController({
    resolveHostContentScript
  } as never, {
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  })
  return { controller, resolveHostContentScript, diagnostics }
}

const syncRequest = {
  surface: 'workbench:code' as const,
  workspaceRoot: '/workspace/one',
  descriptors: [{ extensionId: 'acme.dom', contributionId: 'decorate' }]
}

describe('ExtensionContentScriptController', () => {
  it('arms documentStart only through preload bootstrap and reloads the current document', async () => {
    const { controller } = controllerFor(resolved('documentStart'))
    const frame = frameFixture()
    const result = await controller.sync(frame.frame, syncRequest)

    expect(result).toMatchObject({ ok: true, reloadScheduled: true })
    expect(frame.send).not.toHaveBeenCalled()
    const bootstrap = controller.bootstrap(frame.frame)
    expect(bootstrap.bindings).toHaveLength(1)
    expect(bootstrap.bindings[0]).toMatchObject({
      worldId: expect.any(Number),
      context: {
        extensionId: 'acme.dom',
        extensionVersion: '1.2.3',
        contributionId: 'decorate',
        surface: 'workbench:code',
        runAt: 'documentStart',
        rawDomCompatibility: 'unsupported'
      }
    })
    expect(bootstrap.bindings[0]!.worldId).toBeGreaterThanOrEqual(10_000)
    expect(bootstrap.bindings[0]!.scripts[0]!.code).toContain('__kunDirectDomRan')

    await vi.advanceTimersByTimeAsync(30)
    expect(frame.reload).toHaveBeenCalledTimes(1)
  })

  it('dispatches documentEnd to the preload without a surface reload', async () => {
    const { controller } = controllerFor(resolved('documentEnd'))
    const frame = frameFixture()
    const result = await controller.sync(frame.frame, syncRequest)

    expect(result).toMatchObject({ ok: true })
    expect(result).not.toHaveProperty('reloadScheduled')
    expect(frame.send).toHaveBeenCalledWith(
      'extension:content-script:install',
      expect.objectContaining({
        version: 1,
        bindings: [expect.objectContaining({
          context: expect.objectContaining({ runAt: 'documentEnd' })
        })]
      })
    )
    await vi.advanceTimersByTimeAsync(30)
    expect(frame.reload).not.toHaveBeenCalled()
  })

  it('authenticates the narrow diagnostic bridge with its Main-held nonce', async () => {
    const { controller } = controllerFor(resolved('documentEnd'))
    const frame = frameFixture()
    await controller.sync(frame.frame, syncRequest)
    const binding = controller.bootstrap(frame.frame).bindings[0]!

    expect(() => controller.handleBridgeRequest(frame.frame, {
      bindingId: binding.bindingId,
      nonce: 'x'.repeat(43),
      method: 'reportDiagnostic',
      diagnostic: { code: 'SELECTOR_MISSING', message: 'Selector was not found.' }
    })).toThrow(/binding is invalid/)
    expect(() => controller.handleBridgeRequest(frame.frame, {
      bindingId: binding.bindingId,
      nonce: binding.nonce,
      method: 'reportDiagnostic',
      diagnostic: { code: 'SELECTOR_MISSING', message: 'Selector was not found.' }
    })).not.toThrow()
    expect(controller.recentDiagnostics()).toContainEqual(expect.objectContaining({
      code: 'HOST_DOM_EXTENSION_DIAGNOSTIC',
      extensionId: 'acme.dom',
      contributionId: 'decorate',
      workspaceScope: expect.stringMatching(/^workspace:[a-f0-9]{64}$/),
      message: '[warning:SELECTOR_MISSING] Selector was not found.'
    }))
  })

  it('deactivates host-managed resources and reloads after revoke or workspace change', async () => {
    const { controller } = controllerFor(resolved('documentEnd'))
    const frame = frameFixture()
    await controller.sync(frame.frame, syncRequest)

    await expect(controller.revokeExtension(
      frame.frame,
      'acme.dom',
      'permission-change',
      '/workspace/two'
    )).resolves.toBe(false)
    expect(frame.execute).not.toHaveBeenCalled()
    await expect(controller.revokeExtension(
      frame.frame,
      'acme.dom',
      'permission-change',
      '/workspace/one'
    )).resolves.toBe(true)
    expect(frame.execute).toHaveBeenCalledWith(
      expect.any(Number),
      [expect.objectContaining({ code: expect.stringContaining('kun-extension-deactivate') })]
    )
    await vi.advanceTimersByTimeAsync(30)
    expect(frame.reload).toHaveBeenCalledTimes(1)

    // A workspace-bound context change also replaces the old principal.
    await controller.sync(frame.frame, {
      ...syncRequest,
      workspaceRoot: '/workspace/two'
    })
    expect(controller.bootstrap(frame.frame).bindings[0]!.context.workspaceScope)
      .toMatch(/^workspace:[a-f0-9]{64}$/)
  })

  it('fails closed and clears active scripts for protected surfaces', async () => {
    const { controller, resolveHostContentScript } = controllerFor(resolved('documentEnd'))
    const frame = frameFixture()
    await controller.sync(frame.frame, syncRequest)
    resolveHostContentScript.mockClear()

    const result = await controller.sync(frame.frame, {
      surface: null,
      protectedSurface: 'account-credentials',
      descriptors: []
    })
    expect(result).toMatchObject({ ok: false, code: 'EXTENSION_PROTECTED_SURFACE_DENIED' })
    expect(resolveHostContentScript).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30)
    expect(frame.reload).toHaveBeenCalled()
  })

  it('revokes scripts when an external CLI/runtime permission change fails revalidation', async () => {
    const { controller, resolveHostContentScript } = controllerFor(resolved('documentEnd'))
    const frame = frameFixture()
    await controller.sync(frame.frame, syncRequest)
    resolveHostContentScript.mockRejectedValueOnce(new Error('Direct DOM permission is not granted.'))

    await vi.advanceTimersByTimeAsync(2_050)
    expect(frame.execute).toHaveBeenCalledWith(
      expect.any(Number),
      [expect.objectContaining({ code: expect.stringContaining('kun-extension-deactivate') })]
    )
    await vi.advanceTimersByTimeAsync(30)
    expect(frame.reload).toHaveBeenCalled()
    expect(controller.recentDiagnostics()).toContainEqual(expect.objectContaining({
      code: 'HOST_DOM_EXTERNAL_STATE_REVOKED'
    }))
  })
})

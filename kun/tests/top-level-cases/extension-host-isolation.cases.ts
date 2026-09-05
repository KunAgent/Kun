import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ExtensionApiError } from '@kun/extension-api'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ExtensionHostProcess,
  ExtensionLogWriter,
  ExtensionManager,
  ExtensionPaths,
  JsonRpcPeer,
  isViewIdleDeactivationEligible,
  manifestCompatibilityReport,
  parseExtensionManifest,
  type ExtensionCompatibility,
  type ExtensionPackageManager,
  type JsonValue,
  type ResolvedExtension,
  type RpcEnvelope
} from '../../src/extensions/index.js'
import { admissionFor, buildBuiltinRunner, eventually, fixturePackageManager, hostCompatibility, withFixtureActivation, writeFixtureRunner, writeHandshakeMismatchRunner, writeResolvedExtension } from '../support/extension-host-fixtures.js'

describe('extension host processes', () => {
  let builtinRunnerPath: string

  beforeAll(async () => {
    builtinRunnerPath = await buildBuiltinRunner()
  }, 120_000)

  it('keeps headless hosts isolated across a crash, restarts only the failed host, and shuts down active calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-isolation-'))
    try {
      const runnerPath = await writeFixtureRunner(root)
      const extensions = new Map([
        ['acme.one', await writeResolvedExtension(root, 'acme.one')],
        ['acme.two', await writeResolvedExtension(root, 'acme.two')]
      ])
      let nowMs = Date.now()
      const packageManager = withFixtureActivation({
        async resolveForActivation(extensionId: string) {
          const extension = extensions.get(extensionId)
          if (extension === undefined) throw new Error(`missing extension: ${extensionId}`)
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension(extensionId: string) {
          const extension = extensions.get(extensionId)
          return extension === undefined ? undefined : admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const hostExits: Array<{ extensionId: string; expected: boolean }> = []
      const manager = new ExtensionManager({
        packageManager,
        paths: new ExtensionPaths({
          packageRoot: join(root, 'extensions'),
          dataRoot: join(root, 'data')
        }),
        runnerPath,
        restartBackoffMs: 10,
        restartBackoffMaxMs: 10,
        healthyResetMs: 10_000,
        now: () => new Date(nowMs),
        hostLimits: { operationTimeoutMs: 1_000, shutdownTimeoutMs: 200 },
        onHostExit: (exit) => {
          hostExits.push({ extensionId: exit.extensionId, expected: exit.expected })
        }
      })
      const [first, second] = await Promise.all([
        manager.activate('acme.one', 'onCommand:demo-run'),
        manager.activate('acme.two', 'onCommand:demo-run')
      ])
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      expect(first!.pid).not.toBe(second!.pid)

      await expect(
        manager.invoke('acme.one', 'onCommand:demo-run', 'crash', null)
      ).rejects.toBeDefined()
      await eventually(async () => {
        expect(await manager.diagnostic('acme.one')).toMatchObject({
          active: false,
          consecutiveFailures: 1,
          lifecycleState: 'crashed'
        })
      })
      expect(hostExits).toContainEqual({ extensionId: 'acme.one', expected: false })
      await expect(
        manager.invoke('acme.two', 'onCommand:demo-run', 'noop', null)
      ).resolves.toBeNull()
      await expect(manager.diagnostic('acme.two')).resolves.toMatchObject({
        active: true,
        processId: second!.pid
      })

      await expect(
        manager.activate('acme.one', 'onCommand:demo-run')
      ).rejects.toMatchObject({ code: 'EXTENSION_HOST_RESTART_BACKOFF' })
      nowMs += 20
      const restarted = await manager.activate('acme.one', 'onCommand:demo-run')
      expect(restarted).toBeDefined()
      expect(restarted).not.toBe(first)
      await expect(manager.diagnostic('acme.one')).resolves.toMatchObject({
        active: true,
        restartCount: 1
      })

      const hanging = restarted!.invoke('hang', null)
      const hangingOutcome = expect(hanging).rejects.toMatchObject({
        code: 'EXTENSION_HOST_DEACTIVATING'
      })
      await eventually(() => expect(restarted!.state).toBe('active'))
      await manager.shutdown()
      await hangingOutcome
      expect(restarted!.state).toBe('stopped')
      expect(second!.state).toBe('stopped')
      await expect(manager.diagnostic('acme.one')).resolves.toMatchObject({
        active: false,
        lifecycleState: 'stopped'
      })
      await expect(manager.diagnostic('acme.two')).resolves.toMatchObject({
        active: false,
        lifecycleState: 'stopped'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not spawn a Node host for a browser-only extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-browser-only-'))
    try {
      const extension = await writeResolvedExtension(root, 'acme.browser-only', {
        browserOnly: true
      })
      const packageManager = withFixtureActivation({
        async resolveForActivation() {
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const manager = new ExtensionManager({
        packageManager,
        paths: new ExtensionPaths({
          packageRoot: join(root, 'extensions'),
          dataRoot: join(root, 'data')
        }),
        runnerPath: join(root, 'runner-that-must-not-start.mjs')
      })
      await expect(manager.activate('acme.browser-only', 'onView:browser-only')).resolves.toBeUndefined()
      await expect(manager.diagnostic('acme.browser-only')).resolves.toMatchObject({
        active: false,
        lifecycleState: 'browser-only'
      })
      await expect(
        manager.invoke('acme.browser-only', 'onView:browser-only', 'noop', null)
      ).rejects.toMatchObject({ code: 'EXTENSION_HEADLESS_ENTRYPOINT_REQUIRED' })
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('admits every workspaceRoots entry instead of trusting only workspaceRoot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-workspace-trust-'))
    try {
      const extension = await writeResolvedExtension(root, 'acme.workspace-trust', {
        activationEvents: ['onStartup']
      })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const trustedRoot = join(root, 'a-trusted')
      const deniedRoot = join(root, 'z-denied')
      const trustedKey = paths.workspaceKey(trustedRoot)
      const deniedKey = paths.workspaceKey(deniedRoot)
      const resolvedKeys: Array<string | undefined> = []
      const packageManager = withFixtureActivation({
        async resolveForActivation(_extensionId: string, workspaceKey?: string) {
          resolvedKeys.push(workspaceKey)
          if (workspaceKey === deniedKey) {
            throw Object.assign(new Error('workspace is not trusted'), {
              code: 'EXTENSION_WORKSPACE_UNTRUSTED'
            })
          }
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const manager = new ExtensionManager({ packageManager, paths })

      await expect(manager.activate('acme.workspace-trust', 'onStartup', {
        workspaceRoots: [trustedRoot, deniedRoot]
      })).rejects.toMatchObject({ code: 'EXTENSION_WORKSPACE_UNTRUSTED' })
      expect(resolvedKeys).toEqual([trustedKey, deniedKey])
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not share a pending activation promise across workspace trust scopes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-concurrent-workspace-trust-'))
    try {
      const extension = await writeResolvedExtension(root, 'acme.concurrent-trust', {
        activationEvents: ['onStartup'],
        browserOnly: true
      })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const trustedRoot = join(root, 'trusted')
      const deniedRoot = join(root, 'denied')
      const trustedKey = paths.workspaceKey(trustedRoot)
      const deniedKey = paths.workspaceKey(deniedRoot)
      const resolvedKeys: string[] = []
      let releaseTrusted!: () => void
      const trustedGate = new Promise<void>((resolvePromise) => {
        releaseTrusted = resolvePromise
      })
      const packageManager = withFixtureActivation({
        async resolveForActivation(_extensionId: string, workspaceKey?: string) {
          if (!workspaceKey) throw new Error('workspace admission was skipped')
          resolvedKeys.push(workspaceKey)
          if (workspaceKey === trustedKey) await trustedGate
          if (workspaceKey === deniedKey) {
            throw Object.assign(new Error('workspace is not trusted'), {
              code: 'EXTENSION_WORKSPACE_UNTRUSTED'
            })
          }
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const manager = new ExtensionManager({ packageManager, paths })

      const trustedActivation = manager.activate('acme.concurrent-trust', 'onStartup', {
        workspaceRoot: trustedRoot
      })
      await eventually(() => expect(resolvedKeys).toEqual([trustedKey]))
      const deniedActivation = manager.activate('acme.concurrent-trust', 'onStartup', {
        workspaceRoot: deniedRoot
      })
      const deniedOutcome = expect(deniedActivation).rejects.toMatchObject({
        code: 'EXTENSION_WORKSPACE_UNTRUSTED'
      })
      await eventually(() => expect(resolvedKeys).toEqual([trustedKey, deniedKey]))
      releaseTrusted()

      await expect(trustedActivation).resolves.toBeUndefined()
      await deniedOutcome
      expect(resolvedKeys).toEqual([trustedKey, deniedKey])
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('re-admits a trusted scope after a concurrent scope activation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-concurrent-scope-retry-'))
    try {
      const extension = await writeResolvedExtension(root, 'acme.concurrent-scope-retry', {
        activationEvents: ['onStartup'],
        browserOnly: true
      })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const deniedRoot = join(root, 'denied')
      const trustedRoot = join(root, 'trusted')
      const deniedKey = paths.workspaceKey(deniedRoot)
      const trustedKey = paths.workspaceKey(trustedRoot)
      const resolvedKeys: string[] = []
      let releaseDenied!: () => void
      const deniedGate = new Promise<void>((resolvePromise) => {
        releaseDenied = resolvePromise
      })
      const packageManager = withFixtureActivation({
        async resolveForActivation(_extensionId: string, workspaceKey?: string) {
          if (!workspaceKey) throw new Error('workspace admission was skipped')
          resolvedKeys.push(workspaceKey)
          if (workspaceKey === deniedKey) {
            await deniedGate
            throw Object.assign(new Error('workspace is not trusted'), {
              code: 'EXTENSION_WORKSPACE_UNTRUSTED'
            })
          }
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const manager = new ExtensionManager({ packageManager, paths })

      const deniedActivation = manager.activate('acme.concurrent-scope-retry', 'onStartup', {
        workspaceRoot: deniedRoot
      })
      const deniedOutcome = expect(deniedActivation).rejects.toMatchObject({
        code: 'EXTENSION_WORKSPACE_UNTRUSTED'
      })
      await eventually(() => expect(resolvedKeys).toEqual([deniedKey]))
      const trustedActivation = manager.activate('acme.concurrent-scope-retry', 'onStartup', {
        workspaceRoot: trustedRoot
      })
      releaseDenied()

      await deniedOutcome
      await expect(trustedActivation).resolves.toBeUndefined()
      expect(resolvedKeys).toEqual([deniedKey, trustedKey])
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('invalidates a pending activation when workspace permission lifecycle changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-pending-invalidation-'))
    try {
      const extension = await writeResolvedExtension(root, 'acme.pending-invalidation', {
        activationEvents: ['onStartup'],
        browserOnly: true
      })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const workspaceRoot = join(root, 'workspace')
      let releaseAdmission!: () => void
      const admissionGate = new Promise<void>((resolvePromise) => {
        releaseAdmission = resolvePromise
      })
      let admissionStarted = false
      const packageManager = withFixtureActivation({
        async resolveForActivation() {
          admissionStarted = true
          await admissionGate
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const manager = new ExtensionManager({ packageManager, paths })

      const activation = manager.activate('acme.pending-invalidation', 'onStartup', { workspaceRoot })
      const outcome = expect(activation).rejects.toMatchObject({
        code: 'EXTENSION_ACTIVATION_CANCELLED'
      })
      await eventually(() => expect(admissionStarted).toBe(true))
      await manager.deactivate('acme.pending-invalidation')
      releaseAdmission()

      await outcome
      await expect(manager.diagnostic('acme.pending-invalidation')).resolves.toMatchObject({
        active: false
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('deactivates only the Host admitted for the revoked workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-workspace-stop-'))
    try {
      const runnerPath = await writeFixtureRunner(root)
      const extension = await writeResolvedExtension(root, 'acme.workspace-stop')
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const workspaceA = join(root, 'workspace-a')
      const workspaceB = join(root, 'workspace-b')
      const manager = new ExtensionManager({
        packageManager: fixturePackageManager(new Map([[extension.id, extension]])),
        paths,
        runnerPath,
        hostLimits: { operationTimeoutMs: 1_000, shutdownTimeoutMs: 500 }
      })

      await Promise.all([
        manager.activate(extension.id, 'onCommand:demo-run', { workspaceRoot: workspaceA }),
        manager.activate(extension.id, 'onCommand:demo-run', { workspaceRoot: workspaceB })
      ])
      const generationB = manager.activeHostGeneration(extension.id, { workspaceRoot: workspaceB })
      expect(manager.activeHostGeneration(extension.id, { workspaceRoot: workspaceA })).toBeTruthy()
      expect(generationB).toBeTruthy()

      await manager.deactivateWorkspace(extension.id, paths.workspaceKey(workspaceA))

      expect(manager.activeHostGeneration(extension.id, { workspaceRoot: workspaceA })).toBeUndefined()
      expect(manager.activeHostGeneration(extension.id, { workspaceRoot: workspaceB })).toBe(generationB)
      await expect(manager.notify(extension.id, 'ui.message', null, { workspaceRoot: workspaceA }))
        .rejects.toMatchObject({ code: 'EXTENSION_NOT_ACTIVE' })
      await expect(manager.notify(extension.id, 'ui.message', null, { workspaceRoot: workspaceB }))
        .resolves.toBeUndefined()
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

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

  it('captures a fresh activation epoch after package recovery invalidates the prior lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-recovery-fence-'))
    try {
      const extension = await writeResolvedExtension(root, 'acme.recovery-fence', {
        activationEvents: ['onStartup'],
        browserOnly: true
      })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      let manager!: ExtensionManager
      const packageManager = {
        async resolveActivation<T>(
          _extensionId: string,
          _workspaceKeys: readonly string[],
          captureFence: () => T
        ) {
          await manager.deactivate(extension.id)
          return { resolvedScopes: [extension], fence: captureFence() }
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      } as unknown as ExtensionPackageManager
      manager = new ExtensionManager({ packageManager, paths })

      await expect(manager.activate(extension.id, 'onStartup')).resolves.toBeUndefined()
      await expect(manager.diagnostic(extension.id)).resolves.toMatchObject({
        version: extension.version,
        lifecycleState: 'browser-only'
      })
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('invalidates only the pending activation for the revoked workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-workspace-pending-stop-'))
    try {
      const extension = await writeResolvedExtension(root, 'acme.workspace-pending-stop', {
        activationEvents: ['onStartup'],
        browserOnly: true
      })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const workspaceA = join(root, 'workspace-a')
      const workspaceB = join(root, 'workspace-b')
      const gates = new Map<string, () => void>()
      const packageManager = withFixtureActivation({
        async resolveForActivation(_extensionId: string, workspaceKey?: string) {
          await new Promise<void>((resolvePromise) => {
            gates.set(workspaceKey!, resolvePromise)
          })
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const manager = new ExtensionManager({ packageManager, paths })
      const keyA = paths.workspaceKey(workspaceA)
      const keyB = paths.workspaceKey(workspaceB)
      const activationA = manager.activate(extension.id, 'onStartup', { workspaceRoot: workspaceA })
      const activationB = manager.activate(extension.id, 'onStartup', { workspaceRoot: workspaceB })
      await eventually(() => expect([...gates.keys()].sort()).toEqual([keyA, keyB].sort()))

      await manager.deactivateWorkspace(extension.id, keyA)
      gates.get(keyA)!()
      gates.get(keyB)!()

      await expect(activationA).rejects.toMatchObject({ code: 'EXTENSION_ACTIVATION_CANCELLED' })
      await expect(activationB).resolves.toBeUndefined()
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('activates lazily once, applies restart backoff, and opens a per-extension crash circuit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-'))
    try {
      const runnerPath = await writeFixtureRunner(root)
      const extension = await writeResolvedExtension(root, 'acme.demo')
      let resolutions = 0
      const packageManager = withFixtureActivation({
        async resolveForActivation() {
          resolutions += 1
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      }) as unknown as ExtensionPackageManager
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const manager = new ExtensionManager({
        packageManager,
        paths,
        runnerPath,
        crashThreshold: 3,
        restartBackoffMs: 10,
        restartBackoffMaxMs: 10,
        healthyResetMs: 10_000,
        hostLimits: { operationTimeoutMs: 1_000, shutdownTimeoutMs: 500 }
      })
      expect((await manager.listDiagnostics())).toEqual([])
      await expect(manager.notify('acme.demo', 'ui.message', null)).rejects.toMatchObject({
        code: 'EXTENSION_NOT_ACTIVE'
      })
      const [first, second] = await Promise.all([
        manager.activate('acme.demo', 'onCommand:demo-run'),
        manager.activate('acme.demo', 'onCommand:demo-run')
      ])
      expect(first).toBe(second)
      expect(resolutions).toBe(1)
      await expect(manager.notify('acme.demo', 'ui.message', { channel: 'test' }))
        .resolves.toBeUndefined()

      for (let failure = 1; failure <= 3; failure += 1) {
        await expect(
          manager.invoke('acme.demo', 'onCommand:demo-run', 'crash', null)
        ).rejects.toBeDefined()
        await eventually(async () => {
          expect((await manager.diagnostic('acme.demo')).consecutiveFailures).toBe(failure)
        })
        if (failure < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
      }
      await expect(manager.diagnostic('acme.demo')).resolves.toMatchObject({
        circuitOpen: true,
        lifecycleState: 'circuit-open',
        active: false
      })
      await expect(
        manager.activate('acme.demo', 'onCommand:demo-run')
      ).rejects.toMatchObject({ code: 'EXTENSION_HOST_CIRCUIT_OPEN' })
      await manager.retry('acme.demo')
      await expect(manager.diagnostic('acme.demo')).resolves.toMatchObject({
        circuitOpen: false,
        consecutiveFailures: 0
      })
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('deactivates a pure View Host only after all concurrent View references close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-view-idle-'))
    try {
      const runnerPath = await writeFixtureRunner(root)
      const extension = await writeResolvedExtension(root, 'acme.view-idle', { view: true })
      const manager = new ExtensionManager({
        packageManager: fixturePackageManager(new Map([[extension.id, extension]])),
        paths: new ExtensionPaths({
          packageRoot: join(root, 'extensions'),
          dataRoot: join(root, 'data')
        }),
        runnerPath,
        viewIdleTimeoutMs: 50,
        healthyResetMs: 10_000,
        hostLimits: { shutdownTimeoutMs: 500 }
      })

      manager.retainView(extension.id)
      manager.retainView(extension.id)
      const [first, second] = await Promise.all([
        manager.activate(extension.id, 'onView:panel'),
        manager.activate(extension.id, 'onView:panel')
      ])
      expect(first).toBe(second)
      manager.releaseView(extension.id)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      await expect(manager.diagnostic(extension.id)).resolves.toMatchObject({ active: true })
      expect(manager.pendingIdleDeactivationCount).toBe(0)

      manager.releaseView(extension.id)
      expect(manager.pendingIdleDeactivationCount).toBe(1)
      await eventually(async () => {
        expect(await manager.diagnostic(extension.id)).toMatchObject({
          active: false,
          lifecycleState: 'stopped'
        })
      })
      expect(manager.pendingIdleDeactivationCount).toBe(0)
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cancels idle timers on reopen and waits for old Host cleanup before reactivation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-view-reopen-'))
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>((resolvePromise) => {
      releaseCleanup = resolvePromise
    })
    let cleanupStarted = false
    let exitCount = 0
    try {
      const runnerPath = await writeFixtureRunner(root)
      const extension = await writeResolvedExtension(root, 'acme.view-reopen', { view: true })
      const manager = new ExtensionManager({
        packageManager: fixturePackageManager(new Map([[extension.id, extension]])),
        paths: new ExtensionPaths({
          packageRoot: join(root, 'extensions'),
          dataRoot: join(root, 'data')
        }),
        runnerPath,
        viewIdleTimeoutMs: 80,
        healthyResetMs: 10_000,
        hostLimits: { shutdownTimeoutMs: 500 },
        onHostExit: async () => {
          exitCount += 1
          cleanupStarted = true
          await cleanupGate
        }
      })

      manager.retainView(extension.id)
      const first = await manager.activate(extension.id, 'onView:panel')
      const firstPid = first!.pid
      manager.releaseView(extension.id)
      expect(manager.pendingIdleDeactivationCount).toBe(1)
      manager.retainView(extension.id)
      expect(manager.pendingIdleDeactivationCount).toBe(0)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
      await expect(manager.diagnostic(extension.id)).resolves.toMatchObject({ active: true })

      manager.releaseView(extension.id)
      await eventually(() => expect(cleanupStarted).toBe(true))
      await expect(
        manager.invoke(extension.id, 'onView:panel', 'noop', null)
      ).rejects.toMatchObject({ code: 'EXTENSION_HOST_DEACTIVATING' })
      manager.retainView(extension.id)
      let reopened = false
      const reopen = manager.activate(extension.id, 'onView:panel').then((host) => {
        reopened = true
        return host
      })
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30))
      expect(reopened).toBe(false)
      releaseCleanup()
      const second = await reopen
      expect(second).toBeDefined()
      expect(second).not.toBe(first)
      expect(second!.pid).not.toBe(firstPid)

      manager.releaseView(extension.id)
      expect(manager.pendingIdleDeactivationCount).toBe(1)
      await manager.shutdown()
      expect(manager.pendingIdleDeactivationCount).toBe(0)
      const exitsAfterShutdown = exitCount
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
      expect(exitCount).toBe(exitsAfterShutdown)
    } finally {
      releaseCleanup()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps tool, Provider, and startup/background Hosts alive after their last View closes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-background-view-'))
    try {
      const runnerPath = await writeFixtureRunner(root)
      const extensions = new Map<string, ResolvedExtension>()
      for (const background of ['tool', 'provider', 'startup'] as const) {
        const extension = await writeResolvedExtension(root, `acme.${background}-view`, {
          view: true,
          background
        })
        extensions.set(extension.id, extension)
      }
      const manager = new ExtensionManager({
        packageManager: fixturePackageManager(extensions),
        paths: new ExtensionPaths({
          packageRoot: join(root, 'extensions'),
          dataRoot: join(root, 'data')
        }),
        runnerPath,
        viewIdleTimeoutMs: 40,
        healthyResetMs: 10_000,
        hostLimits: { shutdownTimeoutMs: 500 }
      })

      for (const extension of extensions.values()) {
        expect(isViewIdleDeactivationEligible(extension.manifest)).toBe(false)
        manager.retainView(extension.id)
        await manager.activate(extension.id, 'onView:panel')
        manager.releaseView(extension.id)
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      for (const extension of extensions.values()) {
        await expect(manager.diagnostic(extension.id)).resolves.toMatchObject({ active: true })
      }
      expect(manager.pendingIdleDeactivationCount).toBe(0)
      await manager.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rotates extension-scoped logs within the configured retention bound', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-logs-'))
    try {
      const logPath = join(root, 'host.log')
      const writer = new ExtensionLogWriter(logPath, { maxBytes: 180, retention: 2 })
      for (let index = 0; index < 20; index += 1) {
        await writer.write('stdout', `line-${index}-${'x'.repeat(30)}\n`)
      }
      await writer.flush()
      const files = await readdir(root)
      expect(files).toContain('host.log')
      expect(files).toContain('host.log.1')
      expect(files).not.toContain('host.log.3')
      expect(await readFile(logPath, 'utf8')).toMatch(/\d{4}-\d{2}-\d{2}T.*\[stdout\]/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

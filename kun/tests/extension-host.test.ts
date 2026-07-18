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
} from '../src/extensions/index.js'

const hostCompatibility: ExtensionCompatibility = {
  kunVersion: '0.1.0',
  supportedManifestVersions: [1],
  supportedApiVersions: ['1.0.0']
}

describe('extension host protocol', () => {
  it('supports typed requests, cancellation, ordered stream acknowledgements, and bounds', async () => {
    let left!: JsonRpcPeer
    let right!: JsonRpcPeer
    let cancelledRequests = 0
    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolvePromise) => {
      releaseRequest = resolvePromise
    })
    let releaseStream!: () => void
    const streamGate = new Promise<void>((resolvePromise) => {
      releaseStream = resolvePromise
    })
    right = new JsonRpcPeer({
      send: async (envelope) => left.receive(structuredClone(envelope)),
      onRequest: async (method, params, context) => {
        if (method === 'echo') return params
        if (method === 'hold') {
          await requestGate
          return { released: true }
        }
        if (method === 'wait') {
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              cancelledRequests += 1
              reject(new Error('cancelled'))
            }, { once: true })
          })
        }
        return null
      },
      onStream: async () => streamGate,
      maxMessageBytes: 512
    })
    left = new JsonRpcPeer({
      send: async (envelope) => right.receive(structuredClone(envelope)),
      maxMessageBytes: 512,
      maxConcurrentRequests: 1,
      streamWindow: 1
    })

    await expect(left.request('echo', { ok: true })).resolves.toEqual({ ok: true })
    const held = left.request('hold', null)
    await eventually(() => expect(left.pendingRequestCount).toBe(1))
    await expect(left.request('echo', null)).rejects.toMatchObject({
      code: 'EXTENSION_HOST_CONCURRENCY_LIMIT'
    })
    releaseRequest()
    await expect(held).resolves.toEqual({ released: true })

    const controller = new AbortController()
    const waiting = left.request('wait', null, { signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'EXTENSION_HOST_CANCELLED' })
    await eventually(() => expect(cancelledRequests).toBe(1))
    await expect(left.request('wait', null, { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'EXTENSION_HOST_TIMEOUT'
    })
    await eventually(() => expect(cancelledRequests).toBe(2))

    const firstStream = left.sendStream('stream_1', { value: 1 })
    await expect(left.sendStream('stream_1', { value: 2 })).rejects.toMatchObject({
      code: 'EXTENSION_STREAM_BACKPRESSURE'
    })
    releaseStream()
    await expect(firstStream).resolves.toBeUndefined()

    await expect(
      left.receive({
        rpcVersion: 1,
        kind: 'notification',
        method: 'large',
        params: { value: 'x'.repeat(1_000) }
      })
    ).rejects.toMatchObject({ code: 'EXTENSION_HOST_MESSAGE_LIMIT' })
    left.close()
    right.close()
  })

  it('round-trips bundled public API errors without trusting unbranded error-shaped objects', async () => {
    let left!: JsonRpcPeer
    let right!: JsonRpcPeer
    right = new JsonRpcPeer({
      send: async (envelope) => left.receive(structuredClone(envelope)),
      onRequest: async (method) => {
        if (method === 'public-error') {
          const error = new ExtensionApiError({
            code: 'CONFLICT',
            message: 'The expected revision is stale.',
            retryable: true,
            details: {
              expectedRevision: 7,
              actualRevision: 8,
              authToken: 'must-not-cross-the-rpc-boundary'
            }
          })
          Object.setPrototypeOf(error, Error.prototype)
          throw error
        }
        throw Object.assign(new Error('untrusted implementation detail'), {
          code: 'CONFLICT',
          retryable: true,
          details: { leaked: true }
        })
      }
    })
    left = new JsonRpcPeer({
      send: async (envelope) => right.receive(structuredClone(envelope))
    })

    const publicError = await left.request('public-error', null).catch((error: unknown) => error)
    expect(publicError).toBeInstanceOf(ExtensionApiError)
    expect(publicError).toMatchObject({
      code: 'CONFLICT',
      message: 'The expected revision is stale.',
      retryable: true,
      details: {
        expectedRevision: 7,
        actualRevision: 8,
        authToken: '<redacted>'
      }
    })
    await expect(left.request('error-shaped-object', null)).rejects.toMatchObject({
      code: 'EXTENSION_INTERNAL_ERROR',
      message: 'Extension operation failed',
      details: {}
    })
    left.close()
    right.close()
  })
})

describe('extension host processes', () => {
  let builtinRunnerPath: string

  beforeAll(async () => {
    builtinRunnerPath = await buildBuiltinRunner()
  }, 60_000)

  it('rejects mismatched API or RPC handshakes before requesting extension entrypoint load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-host-handshake-'))
    try {
      for (const mismatch of [
        { name: 'api', rpcVersion: 1, apiVersion: '9.0.0' },
        { name: 'rpc', rpcVersion: 2, apiVersion: '1.0.0' }
      ]) {
        const marker = join(root, `${mismatch.name}-loaded`)
        const extension = await writeResolvedExtension(root, `acme.${mismatch.name}-mismatch`)
        const host = new ExtensionHostProcess({
          extension,
          compatibilityReport: admissionFor(extension),
          paths: new ExtensionPaths({
            packageRoot: join(root, 'packages'),
            dataRoot: join(root, 'data')
          }),
          runnerPath: await writeHandshakeMismatchRunner(root, mismatch, marker),
          limits: { activationTimeoutMs: 1_000, shutdownTimeoutMs: 200 }
        })
        await expect(host.start()).rejects.toMatchObject({
          code: 'EXTENSION_HOST_HANDSHAKE_MISMATCH'
        })
        await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs the built-in runner with the canonical SDK context and command/notification round trips', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-real-runner-'))
    let unregisterCalls = 0
    try {
      const packagePath = join(root, 'extension')
      await mkdir(packagePath, { recursive: true })
      await writeFile(join(packagePath, 'main.mjs'), `
let latestMessage = null;
export async function activate(context) {
  context.subscriptions.add(context.ui.onDidReceiveMessage((message) => { latestMessage = message; }));
  context.subscriptions.add(await context.commands.registerCommand('hello', async (args) => ({
    greeting: 'hello ' + args.name,
    extensionId: context.extension.id,
    apiVersion: context.apiVersion,
    latestMessage
  })));
}
export async function migrateState(state, context) {
  return { ...state, migratedScope: context.scope, from: context.fromVersion, to: context.toVersion };
}
`)
      const manifest = parseExtensionManifest({
        publisher: 'acme',
        name: 'canonical',
        version: '1.0.0',
        manifestVersion: 1,
        apiVersion: '1.0.0',
        engines: { kun: '*' },
        main: 'main.mjs',
        activationEvents: ['onCommand:hello'],
        contributes: { commands: [{ id: 'hello', title: 'Hello' }] },
        permissions: ['commands.register'],
        stateSchemaVersion: 0
      })
      const extension: ResolvedExtension = {
        id: 'acme.canonical',
        version: '1.0.0',
        packagePath,
        manifest,
        requestedPermissions: [...manifest.permissions],
        grantedPermissions: [...manifest.permissions],
        source: { type: 'development', locator: packagePath },
        development: true,
        generation: 1
      }
      const compatibilityReport = manifestCompatibilityReport(manifest, {
        kunVersion: '0.1.0',
        supportedManifestVersions: [1],
        supportedApiVersions: ['1.1.0']
      })
      const host = new ExtensionHostProcess({
        extension,
        compatibilityReport,
        paths: new ExtensionPaths({
          packageRoot: join(root, 'packages'),
          dataRoot: join(root, 'data')
        }),
        runnerPath: builtinRunnerPath,
        limits: {
          activationTimeoutMs: 4_000,
          operationTimeoutMs: 4_000,
          shutdownTimeoutMs: 2_000,
          maxMessageBytes: 16 * 1024
        },
        requiredPermission: (method) => method.startsWith('commands.')
          ? 'commands.register'
          : undefined,
        broker: async ({ principal, method, params }) => {
          expect(principal.extensionId).toBe('acme.canonical')
          if (method === 'commands.register') {
            expect(params).toEqual({ id: 'hello' })
            return { registrationId: 'command-1' }
          }
          if (method === 'commands.unregister') {
            unregisterCalls += 1
            return null
          }
          throw new Error(`unexpected broker method: ${method}`)
        }
      })
      await host.activate('onCommand:hello')
      await host.notify('ui.message', {
        channel: 'test',
        payload: { value: 7 }
      })
      await expect(
        host.invoke('commands.invoke:command-1', { name: 'Kun' })
      ).resolves.toEqual({
        greeting: 'hello Kun',
        extensionId: 'acme.canonical',
        apiVersion: '1.1.0',
        latestMessage: { channel: 'test', payload: { value: 7 } }
      })
      await expect(
        host.migrateState(0, 1, { value: 'old' }, { scope: 'global' })
      ).resolves.toEqual({ value: 'old', migratedScope: 'global', from: 0, to: 1 })
      await expect(
        host.notify('ui.message', { channel: 'large', payload: 'x'.repeat(32 * 1024) })
      ).rejects.toMatchObject({ code: 'EXTENSION_HOST_MESSAGE_LIMIT' })
      await host.deactivate()
      expect(unregisterCalls).toBe(1)
      await expect(host.notify('ui.message', { channel: 'late', payload: null }))
        .rejects.toMatchObject({ code: 'EXTENSION_NOT_ACTIVE' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('preserves public API failures through a real Node Host broker round trip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-api-error-'))
    try {
      const packagePath = join(root, 'extension')
      await mkdir(packagePath, { recursive: true })
      await writeFile(join(packagePath, 'main.mjs'), `
export async function activate(context) {
  context.subscriptions.add(await context.commands.registerCommand('save', async () => {
    await context.workspace.writeFile({
      path: 'deck.kun-ppt.html',
      content: '<!doctype html>',
      encoding: 'utf8'
    });
    return null;
  }));
}
`)
      const manifest = parseExtensionManifest({
        publisher: 'acme',
        name: 'api-error',
        version: '1.0.0',
        manifestVersion: 1,
        apiVersion: '1.0.0',
        engines: { kun: '*' },
        main: 'main.mjs',
        activationEvents: ['onCommand:save'],
        contributes: { commands: [{ id: 'save', title: 'Save' }] },
        permissions: ['commands.register', 'workspace.write'],
        stateSchemaVersion: 0
      })
      const extension: ResolvedExtension = {
        id: 'acme.api-error',
        version: '1.0.0',
        packagePath,
        manifest,
        requestedPermissions: [...manifest.permissions],
        grantedPermissions: [...manifest.permissions],
        source: { type: 'development', locator: packagePath },
        development: true,
        generation: 1
      }
      const host = new ExtensionHostProcess({
        extension,
        compatibilityReport: manifestCompatibilityReport(manifest, {
          kunVersion: '0.1.0',
          supportedManifestVersions: [1],
          supportedApiVersions: ['1.1.0']
        }),
        paths: new ExtensionPaths({
          packageRoot: join(root, 'packages'),
          dataRoot: join(root, 'data')
        }),
        runnerPath: builtinRunnerPath,
        limits: {
          activationTimeoutMs: 4_000,
          operationTimeoutMs: 4_000,
          shutdownTimeoutMs: 2_000
        },
        requiredPermission: (method) => method.startsWith('commands.')
          ? 'commands.register'
          : method === 'workspace.writeFile' ? 'workspace.write' : undefined,
        broker: async ({ method }) => {
          if (method === 'commands.register') return { registrationId: 'command-save' }
          if (method === 'commands.unregister') return null
          if (method === 'workspace.writeFile') {
            throw new ExtensionApiError({
              code: 'CONFLICT',
              message: 'The presentation revision changed before commit.',
              retryable: true,
              details: { expectedRevision: 3, actualRevision: 4 }
            })
          }
          throw new Error(`unexpected broker method: ${method}`)
        }
      })

      await host.activate('onCommand:save')
      const error = await host.invoke('commands.invoke:command-save', null).catch((value: unknown) => value)
      expect(error).toBeInstanceOf(ExtensionApiError)
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: 'The presentation revision changed before commit.',
        retryable: true,
        details: { expectedRevision: 3, actualRevision: 4 }
      })
      await host.deactivate()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('isolates processes, binds identity, minimizes environment, cancels calls, and shuts down', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-host-'))
    const previousSecret = process.env.KUN_EXTENSION_TEST_SECRET
    process.env.KUN_EXTENSION_TEST_SECRET = 'must-not-leak'
    try {
      const runnerPath = await writeFixtureRunner(root)
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const extensionOne = await writeResolvedExtension(root, 'acme.one')
      const extensionTwo = await writeResolvedExtension(root, 'acme.two')
      const broker = async (request: {
        principal: { extensionId: string; lifecycleNonce: string }
        params: JsonValue
      }): Promise<JsonValue> => {
        const params = request.params as Record<string, JsonValue>
        return {
          boundExtensionId: request.principal.extensionId,
          lifecycleNonce: request.principal.lifecycleNonce,
          claimedExtensionId: params.extensionId ?? null,
          envKeys: params.envKeys ?? []
        }
      }
      const first = new ExtensionHostProcess({
        extension: extensionOne,
        compatibilityReport: admissionFor(extensionOne),
        paths,
        runnerPath,
        broker: broker as never,
        limits: { operationTimeoutMs: 2_000, shutdownTimeoutMs: 1_000 }
      })
      const second = new ExtensionHostProcess({
        extension: extensionTwo,
        compatibilityReport: admissionFor(extensionTwo),
        paths,
        runnerPath,
        broker: broker as never,
        limits: { operationTimeoutMs: 2_000, shutdownTimeoutMs: 1_000 }
      })
      await Promise.all([
        first.activate('onCommand:demo-run'),
        second.activate('onCommand:demo-run')
      ])
      expect(first.pid).toBeTypeOf('number')
      expect(second.pid).toBeTypeOf('number')
      expect(first.pid).not.toBe(second.pid)

      const identity = await first.invoke('identity', {}) as Record<string, JsonValue>
      expect(identity.boundExtensionId).toBe('acme.one')
      expect(identity.claimedExtensionId).toBe('forged.extension')
      expect(identity.lifecycleNonce).toBe(first.lifecycleNonce)
      expect(identity.envKeys).not.toContain('KUN_EXTENSION_TEST_SECRET')

      const controller = new AbortController()
      const hanging = first.invoke('hang', null, { signal: controller.signal })
      controller.abort()
      await expect(hanging).rejects.toMatchObject({ code: 'EXTENSION_HOST_CANCELLED' })

      await Promise.all([first.deactivate(), second.deactivate()])
      expect(first.state).toBe('stopped')
      expect(second.state).toBe('stopped')
      expect(await readFile(first.logPath, 'utf8')).toContain('[lifecycle] activated')
    } finally {
      if (previousSecret === undefined) delete process.env.KUN_EXTENSION_TEST_SECRET
      else process.env.KUN_EXTENSION_TEST_SECRET = previousSecret
      await rm(root, { recursive: true, force: true })
    }
  })

  it('bounds activation and memory independently of the Kun process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-host-limits-'))
    try {
      const runnerPath = await writeFixtureRunner(root)
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const activationExtension = await writeResolvedExtension(root, 'acme.activation-timeout', {
        activationEvents: ['onCommand:hang-activation']
      })
      const activationHost = new ExtensionHostProcess({
        extension: activationExtension,
        compatibilityReport: admissionFor(activationExtension),
        paths,
        runnerPath,
        limits: {
          activationTimeoutMs: 30,
          cancellationGraceMs: 30,
          shutdownTimeoutMs: 100
        }
      })
      await expect(activationHost.activate('onCommand:hang-activation')).rejects.toMatchObject({
        code: 'EXTENSION_HOST_TIMEOUT'
      })
      expect(activationHost.state).toBe('stopped')
      expect(activationHost.lastError).toMatchObject({ code: 'EXTENSION_HOST_TIMEOUT' })

      const memoryExtension = await writeResolvedExtension(root, 'acme.memory-limit')
      const memoryHost = new ExtensionHostProcess({
        extension: memoryExtension,
        compatibilityReport: admissionFor(memoryExtension),
        paths,
        runnerPath,
        limits: {
          maxMemoryBytes: 64 * 1024 * 1024,
          operationTimeoutMs: 1_000,
          shutdownTimeoutMs: 100
        }
      })
      await memoryHost.activate('onCommand:demo-run')
      await expect(memoryHost.invoke('memory-limit', null)).rejects.toBeDefined()
      await eventually(() => expect(memoryHost.state).toBe('crashed'))
      expect(memoryHost.lastError).toMatchObject({ code: 'EXTENSION_HOST_MEMORY_LIMIT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps headless hosts isolated across a crash, restarts only the failed host, and shuts down active calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-manager-isolation-'))
    try {
      const runnerPath = await writeFixtureRunner(root)
      const extensions = new Map([
        ['acme.one', await writeResolvedExtension(root, 'acme.one')],
        ['acme.two', await writeResolvedExtension(root, 'acme.two')]
      ])
      let nowMs = Date.now()
      const packageManager = {
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
      } as unknown as ExtensionPackageManager
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
      const packageManager = {
        async resolveForActivation() {
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      } as unknown as ExtensionPackageManager
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
      const packageManager = {
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
      } as unknown as ExtensionPackageManager
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
      const packageManager = {
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
      } as unknown as ExtensionPackageManager
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
      const packageManager = {
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
      } as unknown as ExtensionPackageManager
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
      const packageManager = {
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
      } as unknown as ExtensionPackageManager
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
      const packageManager = {
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
      } as unknown as ExtensionPackageManager
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
      const packageManager = {
        async resolveForActivation() {
          resolutions += 1
          return extension
        },
        admitManifest: (manifest: ResolvedExtension['manifest']) =>
          manifestCompatibilityReport(manifest, hostCompatibility),
        async compatibilityReportForExtension() {
          return admissionFor(extension)
        }
      } as unknown as ExtensionPackageManager
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

async function writeResolvedExtension(
  root: string,
  id: string,
  options: {
    activationEvents?: string[]
    browserOnly?: boolean
    view?: boolean
    background?: 'tool' | 'provider' | 'startup'
  } = {}
): Promise<ResolvedExtension> {
  const [publisher, name] = id.split('.') as [string, string]
  const packagePath = join(root, id)
  await mkdir(packagePath, { recursive: true })
  const entrypoint = options.browserOnly ? 'browser.js' : 'main.mjs'
  await writeFile(join(packagePath, entrypoint), 'export async function activate() {}\n')
  if (options.view && !options.browserOnly) {
    await writeFile(join(packagePath, 'view.html'), '<!doctype html><title>Test View</title>\n')
  }
  const activationEvents = options.activationEvents ?? (
    options.browserOnly
      ? ['onView:browser-only']
      : options.view
        ? [
            'onView:panel',
            ...(options.background === 'tool' ? ['onTool:echo'] : []),
            ...(options.background === 'provider' ? ['onProvider:echo'] : []),
            ...(options.background === 'startup' ? ['onStartup'] : [])
          ]
        : ['onCommand:demo-run']
  )
  const commands = activationEvents
    .filter((event) => event.startsWith('onCommand:'))
    .map((event) => ({ id: event.slice('onCommand:'.length), title: 'Test command' }))
  const viewId = options.browserOnly ? 'browser-only' : 'panel'
  const hasView = options.browserOnly || options.view
  const requestedPermissions = [
    ...(hasView ? ['ui.views', 'webview'] : []),
    ...(commands.length > 0 ? ['commands.register'] : []),
    ...(options.background === 'tool' ? ['tools.register'] : []),
    ...(options.background === 'provider' ? ['providers.register'] : [])
  ]
  return {
    id,
    version: '1.0.0',
    packagePath,
    manifest: parseExtensionManifest({
      publisher,
      name,
      version: '1.0.0',
      manifestVersion: 1,
      apiVersion: '1.0.0',
      engines: { kun: '*' },
      ...(options.browserOnly ? { browser: entrypoint } : { main: entrypoint }),
      activationEvents,
      contributes: {
        ...(commands.length > 0 ? { commands } : {}),
        ...(hasView ? {
          'views.rightSidebar': [{
            id: viewId,
            title: 'Test View',
            entry: options.browserOnly ? entrypoint : 'view.html'
          }]
        } : {}),
        ...(options.background === 'tool' ? {
          tools: [{ id: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }]
        } : {}),
        ...(options.background === 'provider' ? {
          modelProviders: [{ id: 'echo', displayName: 'Echo Provider' }]
        } : {})
      },
      permissions: requestedPermissions,
      stateSchemaVersion: 0
    }),
    requestedPermissions,
    grantedPermissions: [...requestedPermissions],
    source: { type: 'development', locator: packagePath },
    development: true,
    generation: 1
  }
}

function fixturePackageManager(
  extensions: Map<string, ResolvedExtension>
): ExtensionPackageManager {
  return {
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
  } as unknown as ExtensionPackageManager
}

function admissionFor(extension: ResolvedExtension) {
  return manifestCompatibilityReport(extension.manifest, hostCompatibility)
}

async function writeFixtureRunner(root: string): Promise<string> {
  const path = join(root, 'fixture-runner.mjs')
  await writeFile(path, `
const pendingBroker = new Map();
const hanging = new Set();
let initialization;
function send(message) { if (process.connected) process.send(message); }
function result(id, value) { send({ rpcVersion: 1, kind: 'response', id, result: value }); }
function failure(id, code, message) { send({ rpcVersion: 1, kind: 'response', id, error: { code, message } }); }
process.on('message', (message) => {
  if (message.kind === 'response') {
    const original = pendingBroker.get(message.id);
    if (original) {
      pendingBroker.delete(message.id);
      if (message.error) send({ rpcVersion: 1, kind: 'response', id: original, error: message.error });
      else result(original, message.result);
    }
    return;
  }
  if (message.kind === 'cancel') {
    if (hanging.delete(message.id)) failure(message.id, 'EXTENSION_HOST_CANCELLED', 'cancelled');
    return;
  }
  if (message.kind !== 'request') return;
  if (message.method === 'host.initialize') {
    initialization = message.params;
    result(message.id, {
      initialized: true,
      rpcVersion: 1,
      apiVersion: initialization.identity.apiVersion
    });
    return;
  }
  if (message.method === 'host.load') {
    result(message.id, { loaded: true });
    return;
  }
  if (message.method === 'extension.activate') {
    if (message.params.event === 'onCommand:hang-activation') return;
    console.log('activated fixture');
    result(message.id, { activated: true });
    return;
  }
  if (message.method === 'extension.deactivate') {
    result(message.id, { deactivated: true });
    return;
  }
  if (message.method === 'extension.migrateState') {
    result(message.id, message.params.state);
    return;
  }
  if (message.method === 'extension.invoke') {
    const method = message.params.method;
    if (method === 'identity') {
      const brokerId = 'b_' + Math.random().toString(16).slice(2);
      pendingBroker.set(brokerId, message.id);
      send({
        rpcVersion: 1,
        kind: 'request',
        id: brokerId,
        method: 'broker.identity',
        params: {
          extensionId: 'forged.extension',
          envKeys: Object.keys(process.env),
          lifecycleNonce: initialization.identity.lifecycleNonce
        }
      });
      return;
    }
    if (method === 'hang') { hanging.add(message.id); return; }
    if (method === 'memory-limit') {
      send({
        rpcVersion: 1,
        kind: 'notification',
        method: 'host.metrics',
        params: { rss: Number.MAX_SAFE_INTEGER }
      });
      return;
    }
    if (method === 'crash') { process.exit(17); }
    result(message.id, null);
  }
});
process.on('disconnect', () => process.exit(0));
send({ rpcVersion: 1, kind: 'notification', method: 'host.ready', params: { pid: process.pid } });
`)
  return path
}

async function writeHandshakeMismatchRunner(
  root: string,
  mismatch: { name: string; rpcVersion: number; apiVersion: string },
  marker: string
): Promise<string> {
  const path = join(root, `${mismatch.name}-mismatch-runner.mjs`)
  await writeFile(path, `
import { writeFileSync } from 'node:fs';
function send(message) { if (process.connected) process.send(message); }
process.on('message', (message) => {
  if (message.kind !== 'request') return;
  if (message.method === 'host.initialize') {
    send({
      rpcVersion: 1,
      kind: 'response',
      id: message.id,
      result: {
        initialized: true,
        rpcVersion: ${mismatch.rpcVersion},
        apiVersion: ${JSON.stringify(mismatch.apiVersion)}
      }
    });
    return;
  }
  if (message.method === 'host.load') {
    writeFileSync(${JSON.stringify(marker)}, 'loaded');
    send({ rpcVersion: 1, kind: 'response', id: message.id, result: { loaded: true } });
  }
});
process.on('disconnect', () => process.exit(0));
send({ rpcVersion: 1, kind: 'notification', method: 'host.ready', params: { pid: process.pid } });
`)
  return path
}

async function eventually(assertion: () => void | Promise<void>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
    }
  }
  throw lastError
}

async function buildBuiltinRunner(): Promise<string> {
  const run = promisify(execFile)
  const tsc = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')
  await run(process.execPath, [
    tsc,
    '-p',
    join(process.cwd(), '..', 'packages', 'extension-api', 'tsconfig.build.json')
  ])
  await run(process.execPath, [tsc, '-p', join(process.cwd(), 'tsconfig.build.json')])
  return join(process.cwd(), 'dist', 'extensions', 'host-runner.js')
}

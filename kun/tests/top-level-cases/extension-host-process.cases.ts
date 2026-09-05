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
import { admissionFor, buildBuiltinRunner, eventually, fixturePackageManager, hostCompatibility, writeFixtureRunner, writeHandshakeMismatchRunner, writeResolvedExtension } from '../support/extension-host-fixtures.js'

describe('extension host processes', () => {
  let builtinRunnerPath: string

  beforeAll(async () => {
    builtinRunnerPath = await buildBuiltinRunner()
  }, 120_000)

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
})

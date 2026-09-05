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

export const hostCompatibility: ExtensionCompatibility = {
  kunVersion: '0.1.0',
  supportedManifestVersions: [1],
  supportedApiVersions: ['1.0.0']
}

export async function writeResolvedExtension(
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

export function fixturePackageManager(
  extensions: Map<string, ResolvedExtension>
): ExtensionPackageManager {
  return withFixtureActivation({
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
}

export function withFixtureActivation<T extends {
  resolveForActivation(extensionId: string, workspaceKey?: string): Promise<ResolvedExtension>
}>(fixture: T): T & Pick<ExtensionPackageManager, 'resolveActivation'> {
  return Object.assign(fixture, {
    async resolveActivation<U>(
      extensionId: string,
      workspaceKeys: readonly string[],
      captureFence: () => U
    ): Promise<{ resolvedScopes: ResolvedExtension[]; fence: U }> {
      const fence = captureFence()
      const keys: readonly (string | undefined)[] = workspaceKeys.length > 0
        ? workspaceKeys
        : [undefined]
      const resolvedScopes: ResolvedExtension[] = []
      for (const workspaceKey of keys) {
        resolvedScopes.push(await fixture.resolveForActivation(extensionId, workspaceKey))
      }
      return { resolvedScopes, fence }
    }
  })
}

export function admissionFor(extension: ResolvedExtension) {
  return manifestCompatibilityReport(extension.manifest, hostCompatibility)
}

export async function writeFixtureRunner(root: string): Promise<string> {
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

export async function writeHandshakeMismatchRunner(
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

export async function eventually(assertion: () => void | Promise<void>, timeoutMs = 2_000): Promise<void> {
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

async function buildBuiltinRunnerUncached(): Promise<string> {
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

let builtinRunnerPromise: Promise<string> | undefined

export function buildBuiltinRunner(): Promise<string> {
  builtinRunnerPromise ??= buildBuiltinRunnerUncached()
  return builtinRunnerPromise
}

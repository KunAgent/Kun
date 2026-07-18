import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExtensionIndexClient,
  ExtensionManager,
  ExtensionPackageManager,
  ExtensionPaths,
  ExtensionRegistry,
  packKunx,
  type ExtensionCompatibility
} from '../../extensions/index.js'
import { buildExtensionManagementRouter, type ExtensionManagementRoutes } from './extensions.js'

const compatibility: ExtensionCompatibility = {
  kunVersion: '0.1.0',
  supportedManifestVersions: [1],
  supportedApiVersions: ['1.0.0']
}

const cleanupRoots: string[] = []

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) {
    await makeWritable(root)
    await rm(root, { recursive: true, force: true })
  }
})

describe('extension management routes', () => {
  it('requires runtime authentication and bounds strict install payloads', async () => {
    const runtime = await createRuntime()
    const router = buildExtensionManagementRouter(runtime)

    const unauthorized = await dispatch(router, 'GET', '/v1/extensions')
    expect(unauthorized.status).toBe(401)
    runtime.insecure = true
    const insecureStillProtected = await dispatch(router, 'GET', '/v1/extensions')
    expect(insecureStillProtected.status).toBe(401)
    runtime.insecure = false

    const invalid = await dispatch(router, 'POST', '/v1/extensions/install', {
      source: 'archive',
      path: '/tmp/demo.kunx',
      grantedPermissions: [],
      unexpected: true
    }, true)
    expect(invalid.status).toBe(400)
    expect(invalid.body.code).toBe('validation_error')

    const oversized = await dispatch(router, 'POST', '/v1/extensions/install', {
      source: 'archive',
      path: `/${'x'.repeat(70 * 1024)}`,
      grantedPermissions: []
    }, true)
    expect(oversized.status).toBe(413)
  })

  it('projects launchable view metadata before workspace trust is granted', async () => {
    const runtime = await createRuntime()
    const router = buildExtensionManagementRouter(runtime)
    const source = join(cleanupRoots.at(-1)!, 'view-source')
    const archive = join(cleanupRoots.at(-1)!, 'view-demo.kunx')
    const permissions = ['ui.views', 'webview']
    await writeExtensionSource(source, '1.0.0', permissions, true)
    await packKunx(source, archive, { compatibility })
    await dispatch(router, 'POST', '/v1/extensions/install', {
      source: 'archive',
      path: archive,
      grantedPermissions: permissions
    }, true)
    const workspace = join(cleanupRoots.at(-1)!, 'view-workspace')
    await mkdir(workspace)

    const listed = await dispatch(
      router,
      'GET',
      `/v1/extensions?workspace_root=${encodeURIComponent(workspace)}`,
      undefined,
      true
    )

    expect(listed.status).toBe(200)
    expect(listed.body.extensions[0]).toMatchObject({
      id: 'acme.demo',
      workspaceTrusted: false,
      versions: [{
        icon: 'dist/icon.svg',
        views: [{ id: 'editor', title: 'Demo editor', point: 'views.rightSidebar' }]
      }]
    })

    const localized = await dispatch(
      router,
      'GET',
      `/v1/extensions?workspace_root=${encodeURIComponent(workspace)}&locale=zh-CN`,
      undefined,
      true
    )
    expect(localized.body.extensions[0].versions[0]).toMatchObject({
      displayName: '演示扩展',
      description: '本地化的演示扩展。',
      views: [{ id: 'editor', title: '演示编辑器', point: 'views.rightSidebar' }]
    })
    expect((await dispatch(
      router,
      'GET',
      '/v1/extensions?locale=not_a_locale',
      undefined,
      true
    )).status).toBe(400)
  })

  it('installs, scopes permissions and enablement, rolls back, diagnoses, and uninstalls', async () => {
    const runtime = await createRuntime()
    runtime.bundledSeedResults = [{
      extensionId: 'acme.demo',
      version: '3.0.0',
      outcome: 'skipped-permission-change'
    }]
    const beforePermissionChange = vi.fn(async () => undefined)
    runtime.packageManager.setLifecycle({
      ...runtime.manager.packageLifecycle(),
      beforePermissionChange
    })
    const router = buildExtensionManagementRouter(runtime)
    const source = join(cleanupRoots.at(-1)!, 'source')
    const v1Archive = join(cleanupRoots.at(-1)!, 'demo-1.kunx')
    await writeExtensionSource(source, '1.0.0', ['commands.register'])
    await packKunx(source, v1Archive, { compatibility })

    const inspected = await dispatch(router, 'POST', '/v1/extensions/inspect', {
      path: v1Archive
    }, true)
    expect(inspected.status).toBe(200)
    expect(inspected.body.inspection).toMatchObject({ id: 'acme.demo', version: '1.0.0' })

    const installed = await dispatch(router, 'POST', '/v1/extensions/install', {
      source: 'archive',
      path: v1Archive,
      grantedPermissions: ['commands.register']
    }, true)
    expect(installed.status).toBe(201)
    expect(installed.body.extension).toMatchObject({ id: 'acme.demo', version: '1.0.0' })

    const workspace = join(cleanupRoots.at(-1)!, 'workspace')
    await mkdir(workspace)
    const disabled = await dispatch(router, 'POST', '/v1/extensions/acme.demo/disable', {
      workspaceRoot: workspace
    }, true)
    const workspaceKey = runtime.packageManager.paths.workspaceKey(workspace)
    expect(disabled.body.extension.workspaceEnablement[workspaceKey]).toBe(false)
    expect(disabled.body.extension.globallyEnabled).toBe(true)

    const permissions = await dispatch(router, 'PUT', '/v1/extensions/acme.demo/permissions', {
      workspaceRoot: workspace,
      expectedVersion: '1.0.0',
      permissions: []
    }, true)
    expect(permissions.status).toBe(200)
    expect(permissions.body.extension.workspacePermissionGrants[workspaceKey]).toEqual([])
    expect(beforePermissionChange).toHaveBeenCalledWith('acme.demo', workspaceKey, workspace)

    await writeExtensionSource(source, '2.0.0', ['commands.register'])
    const v2Archive = join(cleanupRoots.at(-1)!, 'demo-2.kunx')
    await packKunx(source, v2Archive, { compatibility })
    await dispatch(router, 'POST', '/v1/extensions/install', {
      source: 'archive',
      path: v2Archive,
      grantedPermissions: ['commands.register']
    }, true)
    beforePermissionChange.mockClear()

    const stalePermissions = await dispatch(
      router,
      'PUT',
      '/v1/extensions/acme.demo/permissions',
      {
        workspaceRoot: workspace,
        expectedVersion: '1.0.0',
        permissions: ['commands.register']
      },
      true
    )
    expect(stalePermissions.status).toBe(409)
    expect(stalePermissions.body).toMatchObject({
      code: 'EXTENSION_VERSION_CONFLICT',
      details: { expectedVersion: '1.0.0', currentVersion: '2.0.0' }
    })
    expect((await runtime.registry.get('acme.demo'))?.workspacePermissionGrants[workspaceKey])
      .toEqual([])
    expect(beforePermissionChange).not.toHaveBeenCalled()

    const rollback = await dispatch(router, 'POST', '/v1/extensions/acme.demo/rollback', {}, true)
    expect(rollback.status).toBe(200)
    expect(rollback.body.extension).toMatchObject({
      selectedVersion: '1.0.0',
      previousSelectedVersion: '2.0.0'
    })

    const diagnostic = await dispatch(router, 'GET', '/v1/extensions/acme.demo/diagnostics', undefined, true)
    expect(diagnostic.status).toBe(200)
    expect(diagnostic.body.diagnostic).toMatchObject({
      extensionId: 'acme.demo',
      active: false,
      negotiatedApiVersion: '1.0.0',
      negotiatedRpcVersion: 1,
      compatibility: {
        extensionVersion: '1.0.0',
        manifestVersion: 1,
        api: {
          compatible: true,
          declaredApiVersion: '1.0.0',
          negotiatedApiVersion: '1.0.0'
        },
        kunEngine: { declared: '*', running: '0.1.0', compatible: true },
        rpc: { declared: 1, negotiated: 1, compatible: true },
        stateSchemaVersion: 0,
        diagnostics: []
      }
    })
    const diagnosticList = await dispatch(
      router,
      'GET',
      '/v1/extensions/diagnostics',
      undefined,
      true
    )
    expect(diagnosticList.status).toBe(200)
    expect(diagnosticList.body.diagnostics[0].host).toMatchObject({
      extensionId: 'acme.demo',
      negotiatedApiVersion: '1.0.0',
      negotiatedRpcVersion: 1,
      compatibility: { api: { compatible: true, negotiatedApiVersion: '1.0.0' } }
    })
    expect(diagnosticList.body.diagnostics[0].seed).toEqual({
      extensionId: 'acme.demo',
      version: '3.0.0',
      outcome: 'skipped-permission-change'
    })

    const list = await dispatch(router, 'GET', '/v1/extensions?limit=1', undefined, true)
    expect(list.status).toBe(200)
    expect(list.body.extensions).toHaveLength(1)

    const removed = await dispatch(router, 'DELETE', '/v1/extensions/acme.demo', undefined, true)
    expect(removed.status).toBe(200)
    expect(removed.body).toMatchObject({ dataPreserved: true })
    const missing = await dispatch(router, 'GET', '/v1/extensions/acme.demo', undefined, true)
    expect(missing.status).toBe(404)
  })
})

async function createRuntime(): Promise<ExtensionManagementRoutes> {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-routes-'))
  cleanupRoots.push(root)
  const paths = new ExtensionPaths({
    packageRoot: join(root, 'extensions'),
    dataRoot: join(root, 'data')
  })
  const registry = new ExtensionRegistry(paths)
  const packageManager = new ExtensionPackageManager(paths, registry, { compatibility })
  const manager = new ExtensionManager({ packageManager, paths })
  packageManager.setLifecycle(manager.packageLifecycle())
  return {
    packageManager,
    registry,
    manager,
    indexClient: new ExtensionIndexClient(),
    validation: { compatibility },
    runtimeToken: 'route-test-token',
    insecure: false
  }
}

async function dispatch(
  router: ReturnType<typeof buildExtensionManagementRouter>,
  method: string,
  path: string,
  body?: unknown,
  authorized = false
): Promise<{ status: number; body: Record<string, any> }> {
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      ...(authorized ? { authorization: 'Bearer route-test-token' } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const match = router.match(method, new URL(request.url).pathname)
  if (match === undefined) throw new Error(`route did not match: ${method} ${path}`)
  const response = await match.handler(request, { params: match.params })
  if (response instanceof Response) {
    return { status: response.status, body: await response.json() as Record<string, any> }
  }
  return { status: response.status, body: JSON.parse(response.body) as Record<string, any> }
}

async function writeExtensionSource(
  root: string,
  version: string,
  permissions: string[],
  withView = false
): Promise<void> {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'kun-extension.json'), `${JSON.stringify({
    publisher: 'acme',
    name: 'demo',
    displayName: 'Demo',
    description: 'Demo extension.',
    icon: 'dist/icon.svg',
    ...(withView ? {
      localizations: {
        'zh-CN': {
          displayName: '演示扩展',
          description: '本地化的演示扩展。',
          contributes: {
            'views.rightSidebar': { editor: { title: '演示编辑器' } }
          }
        }
      }
    } : {}),
    version,
    manifestVersion: 1,
    apiVersion: '1.0.0',
    engines: { kun: '*' },
    main: 'dist/main.mjs',
    activationEvents: withView ? ['onView:editor'] : ['onStartup'],
    contributes: withView
      ? {
          'views.rightSidebar': [{
            id: 'editor',
            title: 'Demo editor',
            entry: 'dist/index.html',
            icon: 'dist/icon.svg',
            localResourceRoots: ['dist']
          }]
        }
      : {},
    permissions,
    stateSchemaVersion: 0
  }, null, 2)}\n`)
  await writeFile(join(root, 'README.md'), '# Demo\n')
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(join(root, 'dist/main.mjs'), 'export async function activate() {}\n')
  await writeFile(join(root, 'dist/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
  if (withView) await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>Demo</title>\n')
}

async function makeWritable(root: string): Promise<void> {
  if (process.platform === 'win32') return
  const visit = async (path: string): Promise<void> => {
    const details = await stat(path).catch(() => undefined)
    if (details === undefined) return
    await chmod(path, details.isDirectory() ? 0o700 : 0o600).catch(() => undefined)
    if (!details.isDirectory()) return
    for (const entry of await readdir(path)) await visit(join(path, entry))
  }
  await visit(root)
}

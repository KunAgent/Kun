import { describe, expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ExtensionPaths, ExtensionRegistry, ExtensionPackageManager, parseExtensionManifest } from '../../extensions/index.js'
import { pluginRevision } from '../../extensions/enablement-control.js'
import type { ExtensionPlatformRuntime } from '../../server/routes/server-runtime.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { RemotePlugins } from './service.js'
import type { RemoteAuthority } from '../authorization/scopes.js'
import { receiptKey } from '../requests/receipts.js'
const scope: RemoteAuthority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant', scopes: ['personal', 'extensions.read', 'extensions.control'] }
async function fixture(beforeDisable = vi.fn(async () => {})) {
  const f = await remoteFixture(), paths = new ExtensionPaths({ packageRoot: join(f.root, 'plugins'), dataRoot: join(f.root, 'plugin-data') })
  const registry = new ExtensionRegistry(paths), packageManager = new ExtensionPackageManager(paths, registry, {
    compatibility: { kunVersion: '0.1.0', supportedManifestVersions: [1], supportedApiVersions: ['1.0.0'] } }, { beforeDisable })
  const manifest = parseExtensionManifest({ publisher: 'acme', name: 'demo', version: '1.0.0', displayName: 'Demo',
    manifestVersion: 1, stateSchemaVersion: 1, apiVersion: '1.0.0', engines: { kun: '*' }, main: 'dist/main.mjs', activationEvents: [], permissions: [], contributes: {} })
  await mkdir(paths.packageVersion('acme.demo', '1.0.0'), { recursive: true })
  await registry.registerVersion('acme.demo', { version: '1.0.0', packagePath: paths.packageVersion('acme.demo', '1.0.0'),
    archiveSha256: 'a'.repeat(64), integrity: { algorithm: 'sha256', files: {} }, source: { type: 'local', locator: 'local' },
    signatureStatus: 'unsigned', requestedPermissions: [], grantedPermissions: [], installedAt: new Date().toISOString(), manifest, mutable: false })
  f.runtime.extensionPlatform = { registry, paths, packageManager } as unknown as ExtensionPlatformRuntime
  const adapter = new RemotePlugins(f.runtime), revision = async () => pluginRevision((await registry.get('acme.demo'))!)
  const envelope = (p: unknown, id = 'enablement') => ({ ...f.envelope('plugin.setEnabled', p, id), ...scope })
  return { ...f, registry, packageManager, adapter, revision, envelope, beforeDisable }
}
describe('remote plugin CAS lifecycle', () => {
  it('requires independent control, applies once, and excludes private proof and override paths', async () => {
    const f = await fixture()
    try {
      await f.registry.setWorkspaceEnabled('acme.demo', 'a'.repeat(64), true)
      const p = { pluginId: 'acme.demo', expectedRevision: await f.revision(), enabled: false }, e = f.envelope(p)
      await expect(f.facade.execute({ ...e, scopes: ['personal', 'extensions.read'] })).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
      const first: any = await f.facade.execute(e)
      expect(first.receipt).toMatchObject({ status: 'applied', result: { plugin: { globalEnabled: false, hasWorkspaceOverrides: true } } })
      expect(await f.facade.execute(e)).toEqual(first); expect(f.beforeDisable).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(first)).not.toContain('enablementProofs'); expect(JSON.stringify(first)).not.toContain('aaaaaaaaaaaa')
      expect((await f.registry.publicSnapshot()).extensions['acme.demo']).not.toHaveProperty('enablementProofs')
      await expect(f.adapter.preflight(scope, p)).rejects.toThrow('REVISION_CONFLICT')
    } finally { await f.close() }
  })
  it('recovers only exact native proof, never guesses from current enabled state', async () => {
    const f = await fixture()
    try {
      const p = { pluginId: 'acme.demo', expectedRevision: await f.revision(), enabled: false }
      const receipt = { requestId: 'proof', method: 'plugin.setEnabled', fingerprint: 'unused', params: p,
        status: 'reconciliation_required' as const, createdAt: Date.now() }
      await f.packageManager.setGlobalEnabled('acme.demo', false)
      expect(await f.adapter.recover(scope, receipt)).toBeUndefined()
      const next = { ...p, expectedRevision: await f.revision() }, expected = await f.adapter.setEnabled(scope, next, 'proof')
      expect(await f.adapter.recover({ ...scope, scopes: ['extensions.read'] }, { ...receipt, params: next })).toEqual(expected)
      expect(await f.adapter.recover({ ...scope, deviceId: 'other-phone' }, { ...receipt, params: next })).toBeUndefined()
      expect(f.beforeDisable).toHaveBeenCalledTimes(2)
    } finally { await f.close() }
  })
  it('rejects a concurrent stale CAS and prevents native ABA', async () => {
    let release!: () => void
    const entered = vi.fn(), gate = new Promise<void>((resolve) => { release = resolve })
    const f = await fixture(vi.fn(async () => { entered(); await gate }))
    try {
      const original = await f.revision(), p = { pluginId: 'acme.demo', expectedRevision: original, enabled: false }
      const first = f.adapter.setEnabled(scope, p, 'first')
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce())
      const second = f.adapter.setEnabled({ ...scope, deviceId: 'second' }, p, 'second')
      release()
      const results = await Promise.allSettled([first, second])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(entered).toHaveBeenCalledOnce()
      await f.packageManager.setGlobalEnabled('acme.demo', true)
      expect(await f.revision()).not.toBe(original)
      expect((await f.registry.get('acme.demo'))!.enablementProofs).toMatchObject([{ requestId: receiptKey(scope, 'first') }])
    } finally { release?.(); await f.close() }
  })
  it('leaves lifecycle failures uncertain without success proof', async () => {
    const f = await fixture(vi.fn(async () => { throw new Error('host-failed-after-stop') }))
    try {
      const result: any = await f.facade.execute(f.envelope({ pluginId: 'acme.demo', expectedRevision: await f.revision(), enabled: false }))
      expect(result.receipt.status).toBe('reconciliation_required'); expect(result.receipt.error).toBeUndefined()
      expect((await f.registry.get('acme.demo'))?.enablementProofs).toBeUndefined()
    } finally { await f.close() }
  })
  it('bounds native proofs and treats a revision race after Host shutdown as uncertain', async () => {
    const f = await fixture()
    try {
      for (let i = 0; i < 65; i++) await f.registry.setGlobalEnabled('acme.demo', true, {
        requestId: 'mobile-' + i.toString(16).padStart(64, '0'), fingerprint: 'a'.repeat(64), expectedRevision: await f.revision() })
      const entry = (await f.registry.get('acme.demo'))!
      expect(entry.enablementProofs).toHaveLength(64)
      expect(entry.enablementProofs![0].requestId).toBe('mobile-' + '1'.padStart(64, '0'))
      f.packageManager.setLifecycle({ beforeDisable: async () => { await f.registry.setWorkspaceEnabled('acme.demo', 'b'.repeat(64), true) } })
      const result: any = await f.facade.execute(f.envelope({ pluginId: 'acme.demo', expectedRevision: await f.revision(), enabled: false }, 'late_cas'))
      expect(result.receipt.status).toBe('reconciliation_required'); expect(result.receipt.error).toBeUndefined()
      expect((await f.registry.get('acme.demo'))!.enablementProofs!.some((proof) => proof.requestId === receiptKey(scope, 'late_cas'))).toBe(false)
    } finally { await f.close() }
  })

})

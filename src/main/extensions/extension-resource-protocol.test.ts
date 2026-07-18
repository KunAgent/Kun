import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extensionResourceHeaders,
  parseKunExtensionUrl,
  registerKunExtensionSchemeAsPrivileged,
  resolveKunExtensionResource,
  type ExtensionResourceDescriptor
} from './extension-resource-protocol'

const roots: string[] = []

async function fixture(): Promise<ExtensionResourceDescriptor> {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-protocol-'))
  roots.push(root)
  await mkdir(join(root, 'dist', 'assets'), { recursive: true })
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html>')
  await writeFile(join(root, 'dist', 'assets', 'app.js'), 'export {}')
  await writeFile(join(root, 'dist', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  return {
    extensionId: 'acme.example',
    extensionVersion: '1.0.0',
    packageRoot: root,
    exactFiles: ['dist/index.html', 'dist/icon.svg'],
    localResourceRoots: ['dist/assets'],
    hostIconFiles: ['dist/icon.svg']
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('kun-extension protocol confinement', () => {
  it('registers a secure standard scheme without bypassing CSP', () => {
    const registerSchemesAsPrivileged = vi.fn()
    registerKunExtensionSchemeAsPrivileged({ registerSchemesAsPrivileged } as never)
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: 'kun-extension',
        privileges: expect.objectContaining({ secure: true, standard: true, bypassCSP: false })
      })
    ])
  })

  it('loads only exact files and files below declared roots', async () => {
    const descriptor = await fixture()
    const resolveDescriptor = async () => descriptor
    await expect(resolveKunExtensionResource(
      'kun-extension://acme.example/dist/index.html?kunViewSession=1234567890abcdef',
      resolveDescriptor
    )).resolves.toMatchObject({ relativePath: 'dist/index.html' })
    await expect(resolveKunExtensionResource(
      'kun-extension://acme.example/dist/assets/app.js',
      resolveDescriptor
    )).resolves.toMatchObject({ relativePath: 'dist/assets/app.js' })
    await expect(resolveKunExtensionResource(
      'kun-extension://acme.example/kun-extension.json',
      resolveDescriptor
    )).rejects.toThrow(/RESOURCE_NOT_DECLARED/)
  })

  it('allows cross-origin host embedding only for declared icon files', async () => {
    const descriptor = await fixture()
    await expect(resolveKunExtensionResource(
      'kun-extension://acme.example/dist/icon.svg?kunHostResource=icon',
      async () => descriptor
    )).resolves.toMatchObject({ relativePath: 'dist/icon.svg', hostResource: 'icon' })
    await expect(resolveKunExtensionResource(
      'kun-extension://acme.example/dist/index.html?kunHostResource=icon',
      async () => descriptor
    )).rejects.toThrow(/HOST_ICON_NOT_DECLARED/)
    expect(extensionResourceHeaders('dist/icon.svg', true)).toMatchObject({
      'Content-Type': 'image/svg+xml',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    })
    expect(extensionResourceHeaders('dist/icon.svg')).toMatchObject({
      'Cross-Origin-Resource-Policy': 'same-origin'
    })
  })

  it('rejects traversal, cross-extension descriptors and symlink escape', async () => {
    const descriptor = await fixture()
    expect(() => parseKunExtensionUrl(
      'kun-extension://acme.example/dist/%2e%2e/secret.txt'
    )).toThrow(/PATH_INVALID/)
    await expect(resolveKunExtensionResource(
      'kun-extension://other.example/dist/index.html',
      async () => descriptor
    )).rejects.toThrow(/EXTENSION_NOT_AVAILABLE/)

    const outside = await mkdtemp(join(tmpdir(), 'kun-extension-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.js'), 'secret')
    await symlink(join(outside, 'secret.js'), join(descriptor.packageRoot, 'dist', 'assets', 'link.js'))
    await expect(resolveKunExtensionResource(
      'kun-extension://acme.example/dist/assets/link.js',
      async () => descriptor
    )).rejects.toThrow(/RESOURCE_ROOT_ESCAPE/)
  })

  it('uses nosniff MIME types and a network-denying CSP', () => {
    expect(extensionResourceHeaders('dist/index.html')).toMatchObject({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    })
    expect(extensionResourceHeaders('dist/index.html')['Content-Security-Policy']).toContain(
      "connect-src 'none'"
    )
    expect(extensionResourceHeaders('dist/index.html')['Content-Security-Policy']).toContain(
      "img-src 'self' data: kun-media:"
    )
    expect(extensionResourceHeaders('dist/index.html')['Content-Security-Policy']).toContain(
      "media-src 'self' kun-media:"
    )
    expect(extensionResourceHeaders('dist/index.html')['Content-Security-Policy']).toContain(
      "frame-src 'none'"
    )
    expect(extensionResourceHeaders('dist/index.html', false, true)['Content-Security-Policy']).toContain(
      'frame-src https:'
    )
    expect(extensionResourceHeaders('payload.unknown')['Content-Type']).toBe(
      'application/octet-stream'
    )
  })
})

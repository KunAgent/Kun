import { describe, expect, it } from 'vitest'
import {
  isTrustedRendererSurfaceUrl,
  isTrustedRendererUrl,
  rendererSurfaceForUrl,
  trustedRendererSenderIsCurrent
} from './renderer-trust-policy'

const trusted = 'http://127.0.0.1:5173/index.html'

function windowFor(frame: { processId: number; routingId: number; url: string; detached?: boolean }) {
  const contents = { id: 7, mainFrame: frame }
  return {
    window: { isDestroyed: () => false, webContents: contents } as never,
    event: { sender: contents, senderFrame: frame } as never
  }
}

describe('renderer trust policy', () => {
  it('accepts the immutable dev entry with query and hash', () => {
    expect(isTrustedRendererUrl(`${trusted}?foo=1#settings`, trusted)).toBe(true)
    expect(rendererSurfaceForUrl(`${trusted}?storageRelocation=1`)).toBe('storage-relocation')
    expect(isTrustedRendererSurfaceUrl(
      `${trusted}?runtimeMigrationRecovery=1`,
      trusted,
      'runtime-data-recovery'
    )).toBe(true)
  })

  it('rejects external origins, credentials, data URLs, and wrong paths', () => {
    for (const candidate of [
      'https://example.com/index.html',
      'http://127.0.0.1:5174/index.html',
      'http://user:pass@127.0.0.1:5173/index.html',
      'data:text/html,<html></html>',
      'javascript:alert(1)',
      'http://127.0.0.1:5173/other.html',
      ''
    ]) {
      expect(isTrustedRendererUrl(candidate, trusted)).toBe(false)
    }
  })

  it('requires frame identity plus a matching trusted senderFrame.url', () => {
    const frame = { processId: 10, routingId: 20, url: trusted }
    const { window, event } = windowFor(frame)
    expect(trustedRendererSenderIsCurrent(event, window, {
      trustedRendererUrl: trusted,
      surface: 'workbench'
    })).toBe(true)

    const external = { processId: 10, routingId: 20, url: 'https://example.com' }
    const externalState = windowFor(external)
    expect(trustedRendererSenderIsCurrent(externalState.event, externalState.window, {
      trustedRendererUrl: trusted,
      surface: 'workbench'
    })).toBe(false)
  })

  it('does not allow one recovery surface to impersonate another', () => {
    expect(isTrustedRendererSurfaceUrl(
      `${trusted}?storageRelocation=1`,
      trusted,
      'runtime-data-recovery'
    )).toBe(false)
    expect(isTrustedRendererSurfaceUrl(
      `${trusted}?runtimeMigrationRecovery=1`,
      trusted,
      'workbench'
    )).toBe(false)
  })
})

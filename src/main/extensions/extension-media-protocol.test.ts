import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExtensionMediaProtocolRegistry,
  parseMediaByteRange,
  registerKunExtensionPlatformSchemesAsPrivileged,
  registerKunMediaSchemeAsPrivileged
} from './extension-media-protocol'
import { ExtensionViewSessionRegistry } from './extension-view-sessions'

const roots: string[] = []

type Handler = (request: Request) => Promise<Response> | Response

function protocolFixture() {
  let handler: Handler | undefined
  const protocol = {
    unhandle: vi.fn(),
    handle: vi.fn((_scheme: string, next: Handler) => {
      handler = next
    })
  }
  return { protocol, getHandler: () => handler }
}

async function fixture(options: {
  bytes?: Uint8Array
  now?: () => number
  maxRangeBytes?: number
  maxConcurrentStreamsPerLease?: number
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-media-protocol-'))
  roots.push(root)
  const path = join(root, 'source.mp4')
  const bytes = options.bytes ?? Uint8Array.from({ length: 256 }, (_, index) => index)
  await writeFile(path, bytes)
  const sessions = new ExtensionViewSessionRegistry(options.now)
  const pending = sessions.create({
    sessionId: 'view_12345678-1234-1234-1234-123456789abc',
    extensionId: 'acme.video',
    extensionVersion: '1.1.0',
    contributionId: 'extension:acme.video/editor',
    workspaceRoot: root,
    entryPath: 'dist/index.html',
    parentWebContentsId: 10
  })
  const target = protocolFixture()
  const registry = new ExtensionMediaProtocolRegistry({
    sessions,
    protocolForPartition: () => target.protocol,
    now: options.now,
    randomToken: () => 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    maxRangeBytes: options.maxRangeBytes,
    maxConcurrentStreamsPerLease: options.maxConcurrentStreamsPerLease
  })
  registry.prepare(pending)
  sessions.prepareAttach(10, pending.sourceUrl)
  const destroyedListeners: Array<() => void> = []
  const guestListeners = new Map<string, (...args: unknown[]) => void>()
  const guest = {
    id: 99,
    mainFrame: { processId: 123, routingId: 456 },
    once: (event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.push(listener)
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      guestListeners.set(event, listener)
      return guest
    },
    isDestroyed: () => false,
    close: vi.fn(),
    send: vi.fn()
  }
  sessions.bindNextGuest(10, guest as never)
  const lease = await registry.createLease({
    viewSessionId: pending.sessionId,
    extensionId: pending.extensionId,
    extensionVersion: pending.extensionVersion,
    contributionId: pending.contributionId,
    workspaceRoot: root,
    handleId: 'media_handle_0000000001',
    absolutePath: path,
    mimeType: 'video/mp4'
  })
  return {
    root,
    path,
    bytes,
    sessions,
    pending,
    registry,
    target,
    lease,
    guest,
    guestListeners,
    destroyedListeners
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('kun-media protocol', () => {
  it('registers a secure streaming scheme without bypassing CSP', () => {
    const registerSchemesAsPrivileged = vi.fn()
    registerKunMediaSchemeAsPrivileged({ registerSchemesAsPrivileged } as never)
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: 'kun-media',
        privileges: expect.objectContaining({
          standard: true,
          secure: true,
          stream: true,
          bypassCSP: false
        })
      })
    ])
  })

  it('registers both Extension schemes in the one permitted pre-ready call', () => {
    const registerSchemesAsPrivileged = vi.fn()
    registerKunExtensionPlatformSchemesAsPrivileged({ registerSchemesAsPrivileged } as never)
    expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({ scheme: 'kun-extension' }),
      expect.objectContaining({ scheme: 'kun-media' })
    ])
  })

  it('mints a path-free lease only for the exact active View binding', async () => {
    const state = await fixture()
    expect(state.lease).toMatchObject({
      handleId: 'media_handle_0000000001',
      mimeType: 'video/mp4'
    })
    expect(state.lease.url).toMatch(/^kun-media:\/\/lease\/[A-Za-z0-9_-]+$/)
    expect(JSON.stringify(state.lease)).not.toContain(state.root)
    await expect(state.registry.createLease({
      viewSessionId: state.pending.sessionId,
      extensionId: 'other.video',
      extensionVersion: state.pending.extensionVersion,
      contributionId: state.pending.contributionId,
      workspaceRoot: state.root,
      handleId: 'media_handle_0000000002',
      absolutePath: state.path
    })).rejects.toThrow(/MEDIA_VIEW_BINDING_INVALID/)
  })

  it('immediately revokes leases and active streams on cross-document main-frame navigation', async () => {
    const state = await fixture()
    const handler = state.target.getHandler()!
    state.guestListeners.get('did-start-navigation')?.({
      isMainFrame: true,
      isSameDocument: true
    })
    expect(state.registry.diagnostics().activeLeaseCount).toBe(1)

    const active = await handler(new Request(state.lease.url))
    expect(active.status).toBe(200)
    expect(state.registry.diagnostics().activeStreamCount).toBe(1)
    state.guestListeners.get('did-start-navigation')?.({
      isMainFrame: true,
      isSameDocument: false
    })
    await vi.waitFor(() => {
      expect(state.registry.diagnostics()).toMatchObject({
        activeLeaseCount: 0,
        activeStreamCount: 0
      })
    })
    expect((await handler(new Request(state.lease.url))).status).toBe(404)

    state.guest.mainFrame = { processId: 124, routingId: 457 }
    state.guestListeners.get('did-frame-navigate')?.(
      {},
      state.pending.sourceUrl,
      -1,
      '',
      true,
      124,
      457
    )
    expect(state.sessions.get(state.pending.sessionId)).toMatchObject({
      guestMainFrameProcessId: 124,
      guestMainFrameRoutingId: 457
    })
  })

  it('serves HEAD, full GET and single byte ranges with exact headers', async () => {
    const state = await fixture()
    const handler = state.target.getHandler()!

    const head = await handler(new Request(state.lease.url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    expect(head.headers.get('content-length')).toBe('256')
    expect(head.headers.get('content-type')).toBe('video/mp4')
    expect(head.headers.get('accept-ranges')).toBe('bytes')
    expect(head.headers.get('cross-origin-resource-policy')).toBe('cross-origin')

    const full = await handler(new Request(state.lease.url))
    expect(full.status).toBe(200)
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(state.bytes)

    const middle = await handler(new Request(state.lease.url, {
      headers: { Range: 'bytes=64-95' }
    }))
    expect(middle.status).toBe(206)
    expect(middle.headers.get('content-range')).toBe('bytes 64-95/256')
    expect(middle.headers.get('content-length')).toBe('32')
    expect(new Uint8Array(await middle.arrayBuffer())).toEqual(state.bytes.slice(64, 96))

    const suffix = await handler(new Request(state.lease.url, {
      headers: { Range: 'bytes=-8' }
    }))
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('content-range')).toBe('bytes 248-255/256')
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(state.bytes.slice(248))
  })

  it('returns bounded 416 responses for malformed, multiple, unsatisfiable and oversized ranges', async () => {
    const state = await fixture({ maxRangeBytes: 32 })
    const handler = state.target.getHandler()!
    for (const range of ['items=0-1', 'bytes=0-1,4-5', 'bytes=999-', 'bytes=0-64']) {
      const response = await handler(new Request(state.lease.url, { headers: { Range: range } }))
      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */256')
      expect(response.headers.get('content-length')).toBe('0')
      expect(await response.text()).toBe('')
    }
    expect(() => parseMediaByteRange(`bytes=${Number.MAX_SAFE_INTEGER}0-`, 256, 32)).toThrow()
  })

  it('uses a bounded stream window and enforces concurrent-reader quotas', async () => {
    const bytes = new Uint8Array(16 * 1024 * 1024).fill(7)
    const state = await fixture({ bytes, maxConcurrentStreamsPerLease: 1 })
    const handler = state.target.getHandler()!
    const first = await handler(new Request(state.lease.url))
    expect(first.status).toBe(200)
    expect(state.registry.diagnostics().activeStreamCount).toBe(1)

    const second = await handler(new Request(state.lease.url))
    expect(second.status).toBe(429)
    const reader = first.body!.getReader()
    const chunk = await reader.read()
    expect(chunk.value!.byteLength).toBeLessThanOrEqual(64 * 1024)
    await reader.cancel()
    await vi.waitFor(() => expect(state.registry.diagnostics().activeStreamCount).toBe(0))
  })

  it('rejects copied URLs in another isolated View and stale sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-media-protocol-isolation-'))
    roots.push(root)
    const path = join(root, 'source.mp4')
    await writeFile(path, new Uint8Array(256).fill(4))
    const sessions = new ExtensionViewSessionRegistry()
    const firstSession = sessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.video',
      extensionVersion: '1.1.0',
      contributionId: 'extension:acme.video/editor',
      workspaceRoot: root,
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    const firstTarget = protocolFixture()
    const secondTarget = protocolFixture()
    const secondSession = sessions.create({
      sessionId: 'view_abcdef12-1234-1234-1234-123456789abc',
      extensionId: 'acme.video',
      extensionVersion: '1.1.0',
      contributionId: 'extension:acme.video/editor',
      workspaceRoot: root,
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    const targets = new Map([
      [firstSession.partition, firstTarget],
      [secondSession.partition, secondTarget]
    ])
    const registry = new ExtensionMediaProtocolRegistry({
      sessions,
      protocolForPartition: (partition) => targets.get(partition)!.protocol,
      randomToken: () => 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789'
    })
    registry.prepare(firstSession)
    registry.prepare(secondSession)
    for (const [record, id] of [[firstSession, 91], [secondSession, 92]] as const) {
      sessions.prepareAttach(10, record.sourceUrl)
      sessions.bindNextGuest(10, {
        id,
        mainFrame: { processId: id + 100, routingId: id + 200 },
        once: vi.fn(),
        isDestroyed: () => false,
        close: vi.fn(),
        send: vi.fn()
      } as never)
    }
    const lease = await registry.createLease({
      viewSessionId: firstSession.sessionId,
      extensionId: firstSession.extensionId,
      extensionVersion: firstSession.extensionVersion,
      contributionId: firstSession.contributionId,
      workspaceRoot: root,
      handleId: 'media_handle_0000000001',
      absolutePath: path,
      mimeType: 'video/mp4'
    })
    const copied = await secondTarget.getHandler()!(new Request(lease.url))
    expect(copied.status).toBe(404)

    sessions.dispose(firstSession.sessionId)
    registry.disposeSession(firstSession.sessionId)
    const stale = await firstTarget.getHandler()!(new Request(lease.url))
    expect(stale.status).toBe(404)
  })

  it('revokes on expiry and file replacement without serving replacement bytes', async () => {
    let now = 1_000
    const state = await fixture({ now: () => now })
    now += 10 * 60 * 1_000
    const expired = await state.target.getHandler()!(new Request(state.lease.url))
    expect(expired.status).toBe(404)

    const replacementState = await fixture()
    const replacement = join(replacementState.root, 'replacement.mp4')
    await writeFile(replacement, new Uint8Array(replacementState.bytes.length).fill(99))
    await rename(replacement, replacementState.path)
    const changed = await replacementState.target.getHandler()!(
      new Request(replacementState.lease.url)
    )
    expect(changed.status).toBe(404)
    expect(replacementState.registry.diagnostics().activeLeaseCount).toBe(0)
  })

  it('aborts active streams and revokes URLs on View and extension lifecycle cleanup', async () => {
    const state = await fixture({ bytes: new Uint8Array(16 * 1024 * 1024).fill(3) })
    const response = await state.target.getHandler()!(new Request(state.lease.url))
    expect(state.registry.diagnostics().activeStreamCount).toBe(1)
    expect(state.registry.revokeForExtension('acme.video', 'permission-changed')).toBe(1)
    await vi.waitFor(() => expect(state.registry.diagnostics().activeStreamCount).toBe(0))
    expect((await state.target.getHandler()!(new Request(state.lease.url))).status).toBe(404)
    await expect(response.arrayBuffer()).rejects.toThrow()
  })
})

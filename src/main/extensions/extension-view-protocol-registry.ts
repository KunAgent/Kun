import type { Protocol } from 'electron'
import type { ResolvedExtensionView } from './extension-descriptor-resolver'
import {
  KUN_EXTENSION_SCHEME,
  parseKunExtensionUrl,
  registerKunExtensionProtocol,
  type ExtensionResourceDescriptor
} from './extension-resource-protocol'
import type { ExtensionViewSessionRecord } from './extension-view-sessions'
import type { ExtensionMediaProtocolRegistry } from './extension-media-protocol'

type ProtocolHandler = Pick<Protocol, 'handle' | 'unhandle'>

type PreparedViewProtocol = {
  protocol: ProtocolHandler
  partition: string
  extensionId: string
  extensionVersion: string
  entryPath: string
}

export class ExtensionViewProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ExtensionViewProtocolError'
  }
}

/**
 * Owns the custom-protocol handler for every isolated Extension View partition.
 *
 * Electron protocol handlers are Session-scoped. Each View uses a unique in-memory
 * partition, so registering only on `electron.protocol` (defaultSession) cannot
 * serve its first navigation. The descriptor is snapshotted from the resolved View
 * to prevent an already-open View from switching package versions or reading the
 * resources declared by unrelated contributions.
 */
export class ExtensionViewProtocolRegistry {
  private readonly registrations = new Map<string, PreparedViewProtocol>()

  constructor(
    private readonly protocolForPartition: (partition: string) => ProtocolHandler,
    private readonly onDenied?: (detail: {
      extensionId?: string
      code: string
      sessionId?: string
    }) => void,
    private readonly mediaProtocols?: ExtensionMediaProtocolRegistry
  ) {}

  prepare(record: ExtensionViewSessionRecord, view: ResolvedExtensionView): void {
    if (this.registrations.has(record.sessionId)) {
      throw new ExtensionViewProtocolError(
        'EXTENSION_VIEW_PROTOCOL_DUPLICATE',
        'View protocol is already prepared.'
      )
    }
    if (
      record.extensionId !== view.extensionId ||
      record.extensionVersion !== view.extensionVersion ||
      record.entryPath !== view.entry
    ) {
      throw new ExtensionViewProtocolError(
        'EXTENSION_VIEW_PROTOCOL_MISMATCH',
        'View protocol descriptor does not match the View Session.'
      )
    }

    const descriptor: ExtensionResourceDescriptor = {
      extensionId: view.extensionId,
      extensionVersion: view.extensionVersion,
      packageRoot: view.packageRoot,
      exactFiles: [view.entry],
      localResourceRoots: [...view.localResourceRoots]
    }
    const protocol = this.protocolForPartition(record.partition)
    try {
      registerKunExtensionProtocol({
        protocol,
        resolveDescriptor: async (extensionId) =>
          extensionId === descriptor.extensionId ? descriptor : undefined,
        onDenied: (detail) => this.onDenied?.({ ...detail, sessionId: record.sessionId })
      })
      this.mediaProtocols?.prepare(record)
    } catch (error) {
      try {
        protocol.unhandle(KUN_EXTENSION_SCHEME)
      } catch {
        // Keep failed preparation out of the registry and permit a clean retry.
      }
      this.mediaProtocols?.disposeSession(record.sessionId)
      throw error
    }
    this.registrations.set(record.sessionId, {
      protocol,
      partition: record.partition,
      extensionId: record.extensionId,
      extensionVersion: record.extensionVersion,
      entryPath: record.entryPath
    })
  }

  assertPrepared(record: ExtensionViewSessionRecord): void {
    const prepared = this.registrations.get(record.sessionId)
    if (
      !prepared ||
      prepared.partition !== record.partition ||
      prepared.extensionId !== record.extensionId ||
      prepared.extensionVersion !== record.extensionVersion ||
      prepared.entryPath !== record.entryPath ||
      prepared.protocol !== this.protocolForPartition(record.partition)
    ) {
      throw new ExtensionViewProtocolError(
        'EXTENSION_VIEW_PROTOCOL_NOT_PREPARED',
        'View protocol is not prepared for this isolated partition.'
      )
    }
    this.mediaProtocols?.assertPrepared(record)
  }

  isPreparedInitialNavigation(protocol: ProtocolHandler, rawUrl: string): boolean {
    let parsed: ReturnType<typeof parseKunExtensionUrl>
    try {
      parsed = parseKunExtensionUrl(rawUrl)
    } catch {
      return false
    }
    if (!parsed.viewSessionId) return false
    const prepared = this.registrations.get(parsed.viewSessionId)
    return Boolean(
      prepared &&
      prepared.protocol === protocol &&
      prepared.extensionId === parsed.extensionId &&
      prepared.entryPath === parsed.relativePath
    )
  }

  dispose(sessionId: string): boolean {
    const prepared = this.registrations.get(sessionId)
    const mediaDisposed = this.mediaProtocols?.disposeSession(sessionId) ?? false
    if (!prepared) return mediaDisposed
    this.registrations.delete(sessionId)
    try {
      prepared.protocol.unhandle(KUN_EXTENSION_SCHEME)
    } catch {
      // The in-memory Session may already be gone during application shutdown.
    }
    return true
  }

  disposeAll(): void {
    for (const sessionId of [...this.registrations.keys()]) this.dispose(sessionId)
    this.mediaProtocols?.disposeAll()
  }
}

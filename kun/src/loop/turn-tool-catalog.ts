import { buildToolCatalogFingerprint, type ToolCatalogFingerprint } from '../cache/tool-catalog-fingerprint.js'
import type { ToolHost } from '../ports/tool-host.js'

export type ListedTool = Awaited<ReturnType<ToolHost['listTools']>>[number]
export type ToolCatalogSnapshot = Pick<ToolCatalogFingerprint, 'fingerprint' | 'toolNames' | 'toolHashes'>
export type ToolCatalogDrift =
  | { kind: 'none' }
  | { kind: 'additive'; previous: ToolCatalogSnapshot }
  | { kind: 'breaking'; previous: ToolCatalogSnapshot }

type FrozenTurnToolCatalog = {
  tools: ListedTool[]
  snapshot: ToolCatalogSnapshot
  lastReportedLiveFingerprint?: string
}

export class TurnToolCatalogFreezer {
  private readonly catalogs = new Map<string, FrozenTurnToolCatalog>()

  constructor(private readonly maxCatalogs = 256) {}

  resolve(threadId: string, turnId: string, liveTools: ListedTool[]): {
    tools: ListedTool[]
    pendingDrift: ToolCatalogDrift
    pendingCatalog?: ToolCatalogFingerprint
  } {
    const key = JSON.stringify([threadId, turnId])
    const liveCatalog = buildToolCatalogFingerprint(liveTools)
    const existing = this.catalogs.get(key)
    if (existing) {
      this.catalogs.delete(key)
      this.catalogs.set(key, existing)
      if (
        existing.snapshot.fingerprint === liveCatalog.fingerprint ||
        existing.lastReportedLiveFingerprint === liveCatalog.fingerprint
      ) {
        return { tools: existing.tools, pendingDrift: { kind: 'none' } }
      }
      existing.lastReportedLiveFingerprint = liveCatalog.fingerprint
      const pendingDrift = isAdditiveToolCatalogChange(existing.snapshot, liveCatalog)
        ? { kind: 'additive' as const, previous: existing.snapshot }
        : { kind: 'breaking' as const, previous: existing.snapshot }
      return { tools: existing.tools, pendingDrift, pendingCatalog: liveCatalog }
    }

    const tools = liveTools.map((tool) => ({
      ...tool,
      inputSchema: structuredClone(tool.inputSchema)
    }))
    const snapshot = buildToolCatalogFingerprint(tools)
    this.catalogs.set(key, { tools, snapshot })
    if (this.catalogs.size > this.maxCatalogs) {
      const oldest = this.catalogs.keys().next().value
      if (oldest !== undefined) this.catalogs.delete(oldest)
    }
    return { tools, pendingDrift: { kind: 'none' } }
  }
}

export function isAdditiveToolCatalogChange(
  previous: ToolCatalogSnapshot,
  current: ToolCatalogSnapshot
): boolean {
  let added = false
  for (const name of current.toolNames) {
    if (!previous.toolHashes[name]) added = true
  }
  if (!added) return false
  for (const name of previous.toolNames) {
    const previousHash = previous.toolHashes[name]
    const currentHash = current.toolHashes[name]
    if (!previousHash || !currentHash || previousHash !== currentHash) return false
  }
  return true
}

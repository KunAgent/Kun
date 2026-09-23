/**
 * Per-document source map (implementation §3.3).
 *
 * Each top-level ProseMirror block carries a `blockId` attribute. At parse
 * time we register the node's verbatim source fragment (sliced via mdast
 * position offsets) plus its semantic signature. At serialize time a block
 * whose signature still matches emits the original source byte-for-byte;
 * edited blocks serialize through mdast-util-to-markdown.
 *
 * The map also caches per-block serialization output so unchanged edited
 * blocks are not re-serialized on every keystroke save.
 */
export type WorkBlockStyle = {
  /** Bullet list marker actually used: `-`, `*`, or `+`. */
  bulletMarker?: string
  /** Ordered list delimiter actually used: `.` or `)`. */
  orderedMarker?: string
  /** Fence marker used by a code block: backtick or tilde runs. */
  fence?: '`' | '~'
  /** Line-ending style of the source document. */
  eol?: '\n' | '\r\n'
}

type SourceEntry = {
  /** Verbatim source fragment of this block (no trailing blank lines). */
  source: string
  /** Canonical semantic signature captured at parse time. */
  signature: string
}

type CacheEntry = { signature: string; output: string }

export class WorkSourceMap {
  private entries = new Map<string, SourceEntry>()
  private styles = new Map<string, WorkBlockStyle>()
  private serializeCache = new Map<string, CacheEntry>()
  private counter = 0

  nextBlockId(): string {
    this.counter += 1
    return `w${this.counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  }

  /** Register a parsed block's verbatim source + signature. */
  register(blockId: string, source: string, signature: string): void {
    this.entries.set(blockId, { source, signature })
    this.serializeCache.delete(blockId)
  }

  /** Original source for a block whose signature still matches. */
  sourceFor(blockId: string | undefined, signature: string): string | undefined {
    if (!blockId) return undefined
    const entry = this.entries.get(blockId)
    return entry && entry.signature === signature ? entry.source : undefined
  }

  signatureOf(blockId: string | undefined): string | undefined {
    if (!blockId) return undefined
    return this.entries.get(blockId)?.signature
  }

  setStyle(blockId: string, style: WorkBlockStyle): void {
    const prev = this.styles.get(blockId) ?? {}
    this.styles.set(blockId, { ...prev, ...style })
  }

  styleOf(blockId: string | undefined): WorkBlockStyle {
    if (!blockId) return {}
    return this.styles.get(blockId) ?? {}
  }

  /** Serialized output for an edited block, only valid while `signature` matches. */
  cachedSerialize(blockId: string | undefined, signature: string): string | undefined {
    if (!blockId) return undefined
    const entry = this.serializeCache.get(blockId)
    return entry && entry.signature === signature ? entry.output : undefined
  }

  cacheSerialize(blockId: string | undefined, signature: string, output: string): void {
    if (!blockId) return
    this.serializeCache.set(blockId, { signature, output })
  }

  /**
   * Merge another map's entries (used by the diff review, where rejected
   * chunks re-insert blocks parsed under a separate context so they must
   * still serialize back to their own verbatim source).
   */
  absorb(other: WorkSourceMap): void {
    for (const [id, entry] of other.entries) {
      this.entries.set(id, entry)
    }
    for (const [id, style] of other.styles) {
      this.styles.set(id, style)
    }
  }

  /**
   * After a full serialize pass, forget source entries for ids no longer
   * present in the document so the map does not grow unboundedly.
   */
  retain(liveBlockIds: Set<string>): void {
    for (const id of this.entries.keys()) {
      if (!liveBlockIds.has(id)) {
        this.entries.delete(id)
        this.styles.delete(id)
        this.serializeCache.delete(id)
      }
    }
  }
}

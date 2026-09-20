const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function stableHash(value: string): string {
  let hash = FNV_OFFSET
  for (const character of value.normalize('NFC')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(36)
}

/** Opaque URL key: host paths remain in the Work store and never enter browser history. */
export function workFileResourceKey(workspaceRoot: string, path: string): string {
  return `f-${stableHash(`${workspaceRoot}\0${path}`)}`
}

export function workWhiteboardResourceKey(id: string): string {
  return `b-${stableHash(id)}`
}

export interface AvatarAssetEntry {
  png: string
  webp: Record<string, string>
}

export interface AvatarManifest {
  version: string
  canvas: number
  anchors: { faceBox: number[] }
  assets: Record<string, AvatarAssetEntry>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Resolve only the declared, bundled families; incomplete builds must fail visibly. */
export function loadAvatarManifest(index: unknown, groups: Record<string, unknown>): AvatarManifest {
  if (!isRecord(index) || index.schemaVersion !== 1 || typeof index.version !== 'string' || !index.version ||
    typeof index.canvas !== 'number' || !Number.isFinite(index.canvas) || index.canvas <= 0 ||
    !isRecord(index.anchors) || !Array.isArray(index.anchors.faceBox) || index.anchors.faceBox.length !== 4 ||
    !index.anchors.faceBox.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
    !Array.isArray(index.assetManifests) || !index.assetManifests.length) {
    throw new Error('Invalid avatar manifest index')
  }
  const assets: Record<string, AvatarAssetEntry> = Object.create(null)
  const loaded = new Set<string>()
  for (const path of index.assetManifests) {
    if (typeof path !== 'string' || !/^manifests\/[a-z]+(?:-[a-z]+)*\.json$/.test(path)) {
      throw new Error(`Invalid avatar manifest family: ${String(path)}`)
    }
    if (loaded.has(path)) throw new Error(`Duplicate avatar manifest family: ${path}`)
    loaded.add(path)
    if (!Object.hasOwn(groups, path)) throw new Error(`Missing avatar manifest family: ${path}`)
    const group = groups[path]
    if (!isRecord(group) || !Object.keys(group).length) throw new Error(`Invalid avatar manifest family: ${path}`)
    for (const [key, entry] of Object.entries(group)) {
      if (Object.hasOwn(assets, key)) throw new Error(`Duplicate avatar asset: ${key}`)
      if (!isRecord(entry) || typeof entry.png !== 'string' || !entry.png || !isRecord(entry.webp) ||
        !Object.keys(entry.webp).length || !Object.values(entry.webp).every((value) => typeof value === 'string' && value.length > 0)) {
        throw new Error(`Invalid avatar asset: ${key} (${path})`)
      }
      assets[key] = { png: entry.png, webp: entry.webp as Record<string, string> }
    }
  }
  return { version: index.version, canvas: index.canvas, anchors: { faceBox: index.anchors.faceBox as number[] }, assets }
}

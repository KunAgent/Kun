import { engineError } from './errors.js'
import {
  MediaAssetSchema,
  MediaFolderSchema,
  PROJECT_LIMITS,
  VideoProjectSchema,
  type MediaAsset,
  type MediaFolder,
  type VideoProject
} from './schema.js'

export const MEDIA_LIBRARY_LIMITS = Object.freeze({
  batchImport: 64,
  pageSize: 100,
  searchLength: 256
})

export type MediaLibraryMutation = {
  project: VideoProject
  changedAssetIds: string[]
  changedFolderIds: string[]
}

export type MediaLibraryPage = {
  assets: MediaAsset[]
  offset: number
  limit: number
  total: number
  hiddenBefore: number
  hiddenAfter: number
}

export function createMediaFolder(project: VideoProject, folder: MediaFolder): MediaLibraryMutation {
  MediaFolderSchema.parse(folder)
  const next = structuredClone(project)
  const folders = next.mediaFolders ??= []
  if (folders.length >= PROJECT_LIMITS.mediaFolders) invalid('Media folder limit reached')
  if (folders.some(({ id }) => id === folder.id)) invalid(`Media folder already exists: ${folder.id}`)
  if (folder.parentId && !folders.some(({ id }) => id === folder.parentId)) {
    invalid(`Parent media folder does not exist: ${folder.parentId}`)
  }
  folders.push(structuredClone(folder))
  folders.sort(compareFolders)
  return mutation(VideoProjectSchema.parse(next), [], [folder.id])
}

export function updateMediaFolder(
  project: VideoProject,
  folderId: string,
  patch: { name?: string; parentId?: string | null }
): MediaLibraryMutation {
  const next = structuredClone(project)
  const folders = next.mediaFolders ??= []
  const folder = folders.find(({ id }) => id === folderId)
  if (!folder) invalid(`Media folder does not exist: ${folderId}`)
  if (patch.name !== undefined) folder.name = patch.name
  if (patch.parentId !== undefined) {
    if (patch.parentId === folderId) invalid('A media folder cannot contain itself')
    if (patch.parentId === null) delete folder.parentId
    else folder.parentId = patch.parentId
  }
  MediaFolderSchema.parse(folder)
  folders.sort(compareFolders)
  return mutation(VideoProjectSchema.parse(next), [], [folder.id])
}

export function deleteMediaFolder(
  project: VideoProject,
  folderId: string,
  moveContentsToFolderId?: string
): MediaLibraryMutation {
  const next = structuredClone(project)
  const folders = next.mediaFolders ??= []
  const folder = folders.find(({ id }) => id === folderId)
  if (!folder) invalid(`Media folder does not exist: ${folderId}`)
  if (moveContentsToFolderId === folderId) invalid('Folder contents cannot move to the folder being deleted')
  if (moveContentsToFolderId && !folders.some(({ id }) => id === moveContentsToFolderId)) {
    invalid(`Destination media folder does not exist: ${moveContentsToFolderId}`)
  }
  const childFolders = folders.filter(({ parentId }) => parentId === folderId)
  const assets = next.assets.filter(({ folderId: owner }) => owner === folderId)
  if ((childFolders.length > 0 || assets.length > 0) && moveContentsToFolderId === undefined) {
    invalid('A non-empty media folder requires an explicit destination before deletion')
  }
  for (const child of childFolders) {
    if (moveContentsToFolderId) child.parentId = moveContentsToFolderId
    else delete child.parentId
  }
  for (const asset of assets) {
    if (moveContentsToFolderId) asset.folderId = moveContentsToFolderId
    else delete asset.folderId
  }
  next.mediaFolders = folders.filter(({ id }) => id !== folderId).sort(compareFolders)
  return mutation(
    VideoProjectSchema.parse(next),
    assets.map(({ id }) => id),
    [folderId, ...childFolders.map(({ id }) => id)]
  )
}

export function planBatchMediaImport(
  project: VideoProject,
  assets: readonly MediaAsset[]
): MediaLibraryMutation {
  if (assets.length < 1 || assets.length > MEDIA_LIBRARY_LIMITS.batchImport) {
    invalid(`Media import batch must contain 1-${MEDIA_LIBRARY_LIMITS.batchImport} assets`)
  }
  if (project.assets.length + assets.length > PROJECT_LIMITS.assets) invalid('Media asset limit reached')
  const existingIds = new Set(project.assets.map(({ id }) => id))
  const batchIds = new Set<string>()
  const folders = new Set((project.mediaFolders ?? []).map(({ id }) => id))
  const parsed = assets.map((asset) => {
    const value = MediaAssetSchema.parse(asset)
    if (existingIds.has(value.id) || batchIds.has(value.id)) invalid(`Media asset already exists: ${value.id}`)
    if (value.folderId && !folders.has(value.folderId)) invalid(`Media folder does not exist: ${value.folderId}`)
    if ((value.kind === 'image' || value.kind === 'animation') && !value.still) {
      invalid(`Visual still/animation asset requires image metadata: ${value.id}`)
    }
    if (value.kind === 'image' && value.still?.animated) invalid(`Still image cannot be marked animated: ${value.id}`)
    if (value.kind === 'animation' && !value.still?.animated) invalid(`Animation must be marked animated: ${value.id}`)
    batchIds.add(value.id)
    return value
  })
  const next = structuredClone(project)
  next.assets.push(...parsed)
  next.assets.sort(compareAssets)
  return mutation(VideoProjectSchema.parse(next), parsed.map(({ id }) => id), [])
}

export function organizeMediaAssets(
  project: VideoProject,
  assetIds: readonly string[],
  folderId?: string
): MediaLibraryMutation {
  if (assetIds.length < 1 || assetIds.length > MEDIA_LIBRARY_LIMITS.batchImport) {
    invalid(`Organize batch must contain 1-${MEDIA_LIBRARY_LIMITS.batchImport} assets`)
  }
  const next = structuredClone(project)
  if (folderId && !(next.mediaFolders ?? []).some(({ id }) => id === folderId)) {
    invalid(`Media folder does not exist: ${folderId}`)
  }
  const requested = new Set(assetIds)
  if (requested.size !== assetIds.length) invalid('Organize batch contains duplicate asset IDs')
  for (const assetId of requested) {
    const asset = next.assets.find(({ id }) => id === assetId)
    if (!asset) invalid(`Media asset does not exist: ${assetId}`)
    if (folderId) asset.folderId = folderId
    else delete asset.folderId
  }
  return mutation(VideoProjectSchema.parse(next), [...requested].sort(), [])
}

export function relinkMediaLibraryAsset(
  project: VideoProject,
  assetId: string,
  replacement: Pick<MediaAsset, 'mediaHandleId' | 'workspaceRelativePath' | 'sourceIdentity' | 'availability'>
): MediaLibraryMutation {
  const next = structuredClone(project)
  const asset = next.assets.find(({ id }) => id === assetId)
  if (!asset) invalid(`Media asset does not exist: ${assetId}`)
  if (!replacement.mediaHandleId && !replacement.workspaceRelativePath) {
    invalid('Relink requires an opaque media handle or workspace-relative source')
  }
  asset.mediaHandleId = replacement.mediaHandleId
  asset.workspaceRelativePath = replacement.workspaceRelativePath
  asset.sourceIdentity = replacement.sourceIdentity
  asset.availability = replacement.availability ?? 'online'
  delete asset.recovery
  return mutation(VideoProjectSchema.parse(next), [asset.id], [])
}

export function mediaLibraryPage(
  project: VideoProject,
  input: { folderId?: string; query?: string; offset?: number; limit?: number } = {}
): MediaLibraryPage {
  const query = input.query?.trim().toLocaleLowerCase() ?? ''
  if (query.length > MEDIA_LIBRARY_LIMITS.searchLength) invalid('Media search query exceeds its limit')
  if (input.folderId && !(project.mediaFolders ?? []).some(({ id }) => id === input.folderId)) {
    invalid(`Media folder does not exist: ${input.folderId}`)
  }
  const offset = input.offset ?? 0
  const limit = input.limit ?? MEDIA_LIBRARY_LIMITS.pageSize
  if (!Number.isSafeInteger(offset) || offset < 0) invalid('Media page offset is invalid')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MEDIA_LIBRARY_LIMITS.pageSize) {
    invalid(`Media page limit must be 1-${MEDIA_LIBRARY_LIMITS.pageSize}`)
  }
  const filtered = project.assets
    .filter((asset) => input.folderId ? asset.folderId === input.folderId : true)
    .filter((asset) => query ? asset.name.toLocaleLowerCase().includes(query) : true)
    .sort(compareAssets)
  return {
    assets: structuredClone(filtered.slice(offset, offset + limit)),
    offset,
    limit,
    total: filtered.length,
    hiddenBefore: Math.min(offset, filtered.length),
    hiddenAfter: Math.max(0, filtered.length - offset - limit)
  }
}

function mutation(project: VideoProject, assets: string[], folders: string[]): MediaLibraryMutation {
  return {
    project,
    changedAssetIds: [...new Set(assets)].sort(),
    changedFolderIds: [...new Set(folders)].sort()
  }
}

function compareAssets(left: MediaAsset, right: MediaAsset): number {
  return String(left.folderId ?? '').localeCompare(String(right.folderId ?? '')) ||
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
}

function compareFolders(left: MediaFolder, right: MediaFolder): number {
  return String(left.parentId ?? '').localeCompare(String(right.parentId ?? '')) ||
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}

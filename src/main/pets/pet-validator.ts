import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  PET_MANIFEST_MAX_BYTES,
  PET_SPRITESHEET_MAX_BYTES,
  type PetSource,
  type PetSpriteVersion
} from '../../shared/pets'
import { assertSpritesheetDimensions, decodePetImage } from './pet-image'
import { isUnsafePetRelativePath, resolveContainedFile } from './pet-paths'

export type ValidatedPetPackage = {
  sourceId: string
  displayName: string
  description: string
  spriteVersionNumber: PetSpriteVersion
  spritesheetPath: string
  warnings: string[]
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export async function validatePetPackage(petDir: string, folderName: string): Promise<ValidatedPetPackage> {
  const manifestPath = path.join(petDir, 'pet.json')
  const info = await stat(manifestPath)
  if (!info.isFile() || info.size > PET_MANIFEST_MAX_BYTES) {
    throw new Error('pet.json exceeds 64 KiB or is not a file')
  }
  const raw = await readFile(manifestPath, 'utf8')
  if (Buffer.byteLength(raw) > PET_MANIFEST_MAX_BYTES) throw new Error('pet.json exceeds 64 KiB')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('pet.json is not valid JSON')
  }
  const manifest = readManifest(parsed, folderName)
  const spritesheetPath = await resolveContainedFile(petDir, manifest.spritesheetPath)
  const spriteStat = await stat(spritesheetPath)
  if (spriteStat.size > PET_SPRITESHEET_MAX_BYTES) throw new Error('spritesheet exceeds 16 MiB')
  const extension = path.extname(spritesheetPath).toLowerCase()
  if (extension !== '.png' && extension !== '.webp') throw new Error('spritesheet must be PNG or WebP')
  const bytes = await readFile(spritesheetPath)
  const image = decodePetImage(bytes)
  assertSpritesheetDimensions(image, manifest.spriteVersionNumber)
  return { ...manifest, spritesheetPath }
}

function readManifest(value: unknown, folderName: string): Omit<ValidatedPetPackage, 'spritesheetPath' | 'warnings'> & {
  spritesheetPath: string
  warnings: string[]
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('pet.json must be an object')
  const candidate = value as Record<string, unknown>
  for (const key of ['id', 'displayName', 'description', 'spritesheetPath'] as const) {
    if (typeof candidate[key] !== 'string' || candidate[key].trim() === '') {
      throw new Error(`missing ${key}`)
    }
  }
  const id = (candidate.id as string).trim()
  const displayName = (candidate.displayName as string).trim()
  const description = (candidate.description as string).trim()
  const spritesheetPath = (candidate.spritesheetPath as string).trim()
  if (!ID_PATTERN.test(id)) throw new Error('id must contain only lowercase letters, digits, and hyphens')
  if (displayName.length > 80 || description.length > 400) throw new Error('display name or description is too long')
  const version = candidate.spriteVersionNumber === undefined ? 1 : candidate.spriteVersionNumber
  if (version !== 1 && version !== 2) throw new Error('spriteVersionNumber only supports 1 or 2')
  if (isUnsafePetRelativePath(spritesheetPath)) throw new Error('spritesheetPath must be a relative path inside the pet directory')
  const warnings: string[] = []
  if (folderName !== id) warnings.push(`folder ${folderName} does not match id ${id}`)
  return { sourceId: id, displayName, description, spriteVersionNumber: version, spritesheetPath, warnings }
}

export function spritesheetFileName(sourcePath: string): 'spritesheet.png' | 'spritesheet.webp' {
  return path.extname(sourcePath).toLowerCase() === '.webp' ? 'spritesheet.webp' : 'spritesheet.png'
}

export function petSourceLabel(source: PetSource): string {
  if (source === 'kun-builtin') return 'Built-in'
  if (source === 'kun-local') return 'Local'
  return 'Codex'
}

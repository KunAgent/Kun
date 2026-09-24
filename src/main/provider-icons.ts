import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppSettingsV1 } from '../shared/app-settings'

/**
 * Custom provider icons (plan §6.13). Icons are content-addressed under
 * `userData/provider-icons/<sha256>.<ext>`; a profile references one through
 * `iconId`. SVG is allowed but must only ever be rendered via `<img>` (no
 * inline injection). Unreferenced icons older than one hour are pruned.
 */
const MAX_ICON_BYTES = 1024 * 1024
const ICON_TTL_MS = 60 * 60 * 1_000

const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}
const EXT_TO_MIME = new Map(Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]))

export function providerIconsDir(userDataPath = app.getPath('userData')): string {
  return join(userDataPath, 'provider-icons')
}

function iconPathFor(dir: string, iconId: string): string | null {
  const match = /^[0-9a-f]{16,64}\.(png|jpg|webp|svg)$/.exec(iconId)
  if (!match) return null
  return join(dir, iconId)
}

export type ProviderIconImportResult =
  | { ok: true; iconId: string }
  | { ok: false; message: string }

/** Validates and stores an uploaded icon. `dataBase64` is raw icon bytes. */
export async function importProviderIcon(
  input: { mime: string; dataBase64: string },
  userDataPath = app.getPath('userData')
): Promise<ProviderIconImportResult> {
  const ext = MIME_TO_EXT[input.mime]
  if (!ext) {
    return { ok: false, message: 'Only PNG, JPEG, WebP, and SVG icons are supported.' }
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(input.dataBase64, 'base64')
  } catch {
    return { ok: false, message: 'The icon payload is not valid base64.' }
  }
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) {
    return { ok: false, message: 'The icon must be between 1 byte and 1 MB.' }
  }
  if (ext === 'svg') {
    // Cheap sniff: an SVG icon must look like XML markup, not a renamed binary.
    const head = bytes.subarray(0, 256).toString('utf8').trimStart()
    if (!head.startsWith('<')) {
      return { ok: false, message: 'The SVG icon is not valid markup.' }
    }
  }
  const iconId = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`
  const dir = providerIconsDir(userDataPath)
  await mkdir(dir, { recursive: true })
  const path = join(dir, iconId)
  const existing = await stat(path).catch(() => null)
  if (!existing) await writeFile(path, bytes)
  return { ok: true, iconId }
}

/** Returns a data URL for the renderer `<img>` surface, or null if missing. */
export async function providerIconDataUrl(
  iconId: string,
  userDataPath = app.getPath('userData')
): Promise<string | null> {
  const dir = providerIconsDir(userDataPath)
  const path = iconPathFor(dir, iconId)
  if (!path) return null
  const ext = iconId.slice(iconId.lastIndexOf('.') + 1)
  const mime = EXT_TO_MIME.get(ext)
  if (!mime) return null
  const bytes = await readFile(path).catch(() => null)
  if (!bytes || bytes.length > MAX_ICON_BYTES) return null
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function referencedIconIds(settings: AppSettingsV1): Set<string> {
  const ids = new Set<string>()
  for (const provider of settings.provider?.providers ?? []) {
    if (provider.iconId) ids.add(provider.iconId)
  }
  return ids
}

/**
 * Deletes stored icons no profile references once they are older than one
 * hour — the grace period keeps icons alive between upload and profile save.
 */
export async function pruneProviderIcons(
  settings: AppSettingsV1,
  userDataPath = app.getPath('userData'),
  now = Date.now()
): Promise<void> {
  const dir = providerIconsDir(userDataPath)
  const referenced = referencedIconIds(settings)
  const entries = await readdir(dir).catch(() => [] as string[])
  for (const entry of entries) {
    if (referenced.has(entry)) continue
    if (!/^[0-9a-f]{16,64}\.(png|jpg|webp|svg)$/.test(entry)) continue
    const path = join(dir, entry)
    const info = await stat(path).catch(() => null)
    if (!info || now - info.mtimeMs < ICON_TTL_MS) continue
    await unlink(path).catch(() => undefined)
  }
}

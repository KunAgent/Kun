import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { uiPluginsRootDir } from './ui-plugin-service'

type SeedInput = {
  kunHomeDir: string
  pluginId: string
  markerVersion: number
  legacyMarkers?: string[]
  seed: () => Promise<{ ok: true } | { ok: false; errors: string[] }>
}

type SeedGuardInput = {
  seed: (kunHomeDir: string) => Promise<void>
  onError: (error: unknown) => void
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function seedBundledUiPluginOnce(
  input: SeedInput
): Promise<'seeded' | 'skipped'> {
  const root = uiPluginsRootDir(input.kunHomeDir)
  const marker = join(root, `.bundled-${input.pluginId}-v${input.markerVersion}`)
  const candidates = [
    marker,
    ...(input.legacyMarkers ?? []).map((name) => join(root, name))
  ]
  if ((await Promise.all(candidates.map(exists))).some(Boolean)) return 'skipped'

  const result = await input.seed()
  if (!result.ok) throw new Error(result.errors.join('; '))

  await mkdir(root, { recursive: true })
  await writeFile(marker, `${input.pluginId}\n`, 'utf8')
  return 'seeded'
}

/** Deduplicates concurrent startup calls while allowing only the failed plugin to retry. */
export function createBundledUiPluginSeedGuard(
  input: SeedGuardInput
): (kunHomeDir: string) => Promise<void> {
  let seedPromise: Promise<void> | null = null

  return (kunHomeDir) => {
    if (seedPromise) return seedPromise

    const attempt = input.seed(kunHomeDir).catch((error) => {
      if (seedPromise === attempt) seedPromise = null
      input.onError(error)
    })
    seedPromise = attempt
    return attempt
  }
}

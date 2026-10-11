import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  MarketInstallSkillRequest,
  MarketInstallSkillResult
} from '../../../shared/market/market-types'
import { expandHomePath, normalizeSkillFolderName } from '../workspace-paths'
import { readCappedBody } from './market-body'
import { readSkillProvenance, writeSkillProvenance } from './market-provenance'
import { isAllowedDownloadUrl, type MarketFetch } from './market-source'
import type { MarketService } from './market-service'
import { extractSkillArchive } from './market-zip-extract'

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000
const STAGING_DIR = '.kun-market-staging'

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

function failure(message: string, code: 'exists' | 'failed' = 'failed'): MarketInstallSkillResult {
  return { ok: false, code, message }
}

/**
 * Downloads one market skill archive and installs it as `<root>/<skillId>/`.
 * The archive is unpacked into a staging folder inside the root first and
 * moved into place, so a failed install never leaves a half-written skill.
 */
export async function installMarketSkill(
  request: MarketInstallSkillRequest,
  deps: { service: MarketService; fetcher: MarketFetch; now?: () => Date }
): Promise<MarketInstallSkillResult> {
  const source = deps.service.getSource(request.sourceId)
  if (!source) return failure(`Unknown market source "${request.sourceId}".`)
  const catalog = await deps.service.getCatalog(request.sourceId, 'auto')
  if (!catalog.ok) return failure(catalog.message)
  const entry = catalog.catalog.skills.find((skill) => skill.id === request.skillId)
  if (!entry) return failure(`"${request.skillId}" is not in the ${source.info.label.en ?? source.info.id} catalog.`)
  if (!isAllowedDownloadUrl(entry.downloadUrl, source.allowedDownloadHosts)) {
    return failure(`Refusing to download "${entry.id}" from an untrusted address.`)
  }
  const rootPath = expandHomePath(request.rootPath)
  if (!rootPath) return failure('Skill directory is required.')

  let folderName: string
  try {
    folderName = normalizeSkillFolderName(entry.id)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
  const target = join(rootPath, folderName)
  const replacing = await exists(target)
  if (replacing) {
    if (!request.overwrite) {
      return failure(`A skill named "${folderName}" already exists in this directory.`, 'exists')
    }
    const provenance = await readSkillProvenance(target)
    if (provenance?.sourceId !== request.sourceId) {
      return failure(`"${folderName}" was not installed from this market, so it is left untouched.`)
    }
  }

  const staging = join(rootPath, STAGING_DIR, `${folderName}-${randomBytes(4).toString('hex')}`)
  const previous = `${staging}.previous`
  try {
    const response = await deps.fetcher(entry.downloadUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    })
    if (!response.ok) return failure(`Download failed (HTTP ${response.status}).`)
    if (response.url && !isAllowedDownloadUrl(response.url, source.allowedDownloadHosts)) {
      return failure(`Refusing a download that was redirected to an untrusted address.`)
    }
    const archive = await readCappedBody(response, MAX_ARCHIVE_BYTES)
    await mkdir(staging, { recursive: true })
    await extractSkillArchive(archive, staging)
    await writeSkillProvenance(staging, {
      sourceId: request.sourceId,
      skillId: entry.id,
      ...(entry.version ? { version: entry.version } : {}),
      installedAt: (deps.now?.() ?? new Date()).toISOString(),
      downloadUrl: entry.downloadUrl
    })
    if (replacing) await rename(target, previous)
    try {
      await rename(staging, target)
    } catch (error) {
      if (replacing) await rename(previous, target).catch(() => undefined)
      throw error
    }
    if (replacing) await rm(previous, { recursive: true, force: true })
    return { ok: true, path: join(target, 'SKILL.md'), ...(entry.version ? { version: entry.version } : {}) }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    // Drops the shared staging folder once the last install is done with it.
    await rmdir(join(rootPath, STAGING_DIR)).catch(() => undefined)
  }
}

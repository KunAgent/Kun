import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MARKET_PROVENANCE_FILE,
  type MarketSkillProvenance
} from '../../../shared/market/market-types'

export async function writeSkillProvenance(
  skillDir: string,
  provenance: MarketSkillProvenance
): Promise<void> {
  await writeFile(
    join(skillDir, MARKET_PROVENANCE_FILE),
    `${JSON.stringify(provenance, null, 2)}\n`,
    'utf8'
  )
}

/** Reads a skill folder's market provenance; `null` when it was not installed from a market. */
export async function readSkillProvenance(skillDir: string): Promise<MarketSkillProvenance | null> {
  try {
    const parsed = JSON.parse(await readFile(join(skillDir, MARKET_PROVENANCE_FILE), 'utf8')) as Partial<MarketSkillProvenance>
    if (typeof parsed.sourceId !== 'string' || !parsed.sourceId || typeof parsed.skillId !== 'string') {
      return null
    }
    return {
      sourceId: parsed.sourceId,
      skillId: parsed.skillId,
      ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
      installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : '',
      downloadUrl: typeof parsed.downloadUrl === 'string' ? parsed.downloadUrl : ''
    }
  } catch {
    return null
  }
}

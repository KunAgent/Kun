import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveExpertPlugins } from './expert-plugin-resolver.js'

/**
 * ISSUE-012 regression: every top-level plugin under experts/plugins must map to
 * an expert or team, with zero validation failures. Previously 33/305 plugins
 * failed strict manifest validation because they omitted required LocalizedText
 * fields; the compat mapper in normalizeManifestInput now synthesizes them.
 */
describe('Expert plugin compatibility (real plugins)', () => {
  // Resolve the repo-root experts/plugins dir relative to this test file.
  const pluginRoot = join(process.cwd(), '..', 'experts', 'plugins')
  const hasPlugins = existsSync(pluginRoot)

  /**
   * Reviewed whitelist of top-level dirs that legitimately do NOT map 1:1 to a
   * new expert/team id (ISSUE-012 acceptance allows a reviewed whitelist):
   * - ai-shifu-expert: manifest name is 'ai-shifu', so it maps under that id
   *   (dir name ≠ manifest name — accounted for, just a naming mismatch).
   * - operation-policies: shared policy/rule markdown, not an expert plugin
   *   (no plugin.json manifest).
   */
  const ACCOUNTED_WHITELIST = new Set(['ai-shifu-expert', 'operation-policies'])

  it.runIf(hasPlugins)('loads all top-level plugins with zero validation errors', async () => {
    const entries = await readdir(pluginRoot, { withFileTypes: true })
    const topLevelDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    const topLevelPluginCount = topLevelDirs.length

    const result = await resolveExpertPlugins([pluginRoot])
    const mappedIds = new Set([
      ...result.experts.map((e) => e.id),
      ...result.teams.map((t) => t.id)
    ])

    // Surface any failures for debugging before asserting.
    if (result.validationErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('Plugin validation errors:', result.validationErrors.slice(0, 10))
    }

    expect(topLevelPluginCount).toBeGreaterThan(0)
    // Zero manifest validation failures (was 33/305 before the compat mapper).
    expect(result.validationErrors).toHaveLength(0)

    // Every top-level dir must be accounted for: either its id maps, or it is
    // on the reviewed whitelist. Unaccounted count must be 0.
    const unaccounted = topLevelDirs.filter(
      (dir) => !mappedIds.has(dir) && !ACCOUNTED_WHITELIST.has(dir)
    )
    expect(unaccounted).toEqual([])
  })

  it.runIf(hasPlugins)('maps previously-failing minimal manifests', async () => {
    const result = await resolveExpertPlugins([pluginRoot])
    const ids = new Set([
      ...result.experts.map((e) => e.id),
      ...result.teams.map((t) => t.id)
    ])

    // These four were in the report's failure sample; they must now map.
    for (const id of ['data', 'data-analysis', 'deep-research', 'design-to-code']) {
      // Only assert when the plugin dir exists in this checkout.
      if (existsSync(join(pluginRoot, id))) {
        expect(ids.has(id)).toBe(true)
      }
    }
  })
})

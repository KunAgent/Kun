/**
 * ISSUE-002 / ISSUE-016: Config round-trip acceptance test.
 *
 * Verifies the extensions bag survives the full CLI config parse chain:
 *   config.json (serve.extensions) -> parseServeOptions() -> ServeOptions.extensions
 *
 * The QA report found parseServeOptions() silently dropped the extensions
 * field. This test is the CI gate that keeps all 4 feature configs intact.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseServeOptions } from '../cli/serve.js'

describe('Config round-trip (extensions passthrough)', () => {
  let dir: string
  let configPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-config-'))
    configPath = join(dir, 'config.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('preserves all feature configs through parseServeOptions', async () => {
    const extensions = {
      experts: {
        pluginRoots: ['./experts/plugins'],
        customExpertsDir: '~/.kun/experts/custom'
      },
      moa: {
        presets: [],
        defaultPresetId: 'balanced-local',
        enableTracing: true
      },
      automation: {
        enabled: true,
        employees: [],
        schedules: []
      },
      design: {
        librariesRoot: 'design/design_libraries',
        runtimeSkillsRoot: 'design/runtime-skills',
        staticSkillsRoot: 'design/skills'
      }
    }

    await writeFile(
      configPath,
      JSON.stringify({
        serve: {
          host: '127.0.0.1',
          port: 4123,
          dataDir: dir,
          apiKey: 'test-key',
          extensions
        }
      })
    )

    const options = parseServeOptions([`--config=${configPath}`], {})

    // The extensions bag must survive verbatim.
    expect(options.extensions).toBeDefined()
    expect(options.extensions).toEqual(extensions)

    // Each feature's config must be individually intact.
    const ext = options.extensions as typeof extensions
    expect(ext.experts.pluginRoots).toEqual(['./experts/plugins'])
    expect(ext.moa.defaultPresetId).toBe('balanced-local')
    expect(ext.moa.enableTracing).toBe(true)
    expect(ext.automation.enabled).toBe(true)
    expect(ext.design.librariesRoot).toBe('design/design_libraries')
  })

  it('defaults extensions to empty object when absent', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        serve: {
          host: '127.0.0.1',
          port: 4123,
          dataDir: dir,
          apiKey: 'test-key'
        }
      })
    )

    const options = parseServeOptions([`--config=${configPath}`], {})
    // Absent extensions must not crash and must be a usable empty bag.
    expect(options.extensions).toEqual({})
  })

  it('keeps unknown feature ids in the passthrough bag (no strict rejection)', async () => {
    const extensions = {
      experts: { pluginRoots: [] },
      // A hypothetical future feature the central schema does not know about.
      futureFeature: { someKey: 'someValue' }
    }

    await writeFile(
      configPath,
      JSON.stringify({
        serve: {
          host: '127.0.0.1',
          port: 4123,
          dataDir: dir,
          apiKey: 'test-key',
          extensions
        }
      })
    )

    const options = parseServeOptions([`--config=${configPath}`], {})
    const ext = options.extensions as Record<string, unknown>
    expect(ext.futureFeature).toEqual({ someKey: 'someValue' })
  })
})

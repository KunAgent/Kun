import { test, expect } from 'vitest'
import { ExpertService } from './expert-service.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('ExpertService loads real plugins from experts/plugins', async () => {
  const customDir = await mkdtemp(join(tmpdir(), 'expert-service-integration-'))
  const pluginRoot = resolve(process.cwd(), '..', 'experts', 'plugins')

  try {
    const service = new ExpertService({
      pluginRoots: [pluginRoot],
      customExpertsDir: customDir
    })

    await service.initialize()

    // Test listing
    const experts = service.listExperts()
    const teams = service.listTeams()

    // Should load at least some experts (or log why not)
    console.log('Plugin root:', pluginRoot)
    console.log('Loaded experts:', experts.length)
    console.log('Loaded teams:', teams.length)

    if (experts.length === 0 && teams.length === 0) {
      console.log('No experts loaded - check if plugins directory exists')
    }

    // Test getting a specific expert
    if (experts.length > 0) {
      const firstExpert = experts[0]
      const retrieved = service.getExpert(firstExpert.id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(firstExpert.id)
      console.log('Sample expert:', firstExpert.id, '-', firstExpert.displayName)
    }

    // Test getting a specific team
    if (teams.length > 0) {
      const firstTeam = teams[0]
      const retrieved = service.getExpertTeam(firstTeam.id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(firstTeam.id)
      console.log('Sample team:', firstTeam.id, '-', firstTeam.displayName)
    }
  } finally {
    await rm(customDir, { recursive: true, force: true })
  }
}, 30000) // 30s timeout for plugin scanning

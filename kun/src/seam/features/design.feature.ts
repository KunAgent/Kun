import type { KunExtension } from '../types.js'
import type { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { DesignLibraryService } from '../../design/services/design-library-service.js'
import { SkillService } from '../../design/services/skill-service.js'
import {
  DesignComponentSearchSchema,
  DesignAssetSearchSchema
} from '../../design/contracts/design-library-types.js'
import { SkillSearchSchema, SkillExecutionContextSchema } from '../../design/contracts/skill-types.js'
import { z } from 'zod'
import { resolve } from 'node:path'
import { authenticated } from '../auth.js'

const DesignConfigSchema = z.object({
  librariesRoot: z.string().default('design/design_libraries'),
  runtimeSkillsRoot: z.string().default('design/runtime-skills'),
  staticSkillsRoot: z.string().default('design/skills'),
  defaultLibrary: z.string().optional()
})

export const designExtension: KunExtension = {
  id: 'design',

  async initializeServices(featureConfig: unknown, runtime: ServerRuntime) {
    const config = DesignConfigSchema.parse(featureConfig || {})

    // Resolve paths relative to process.cwd()
    const librariesRoot = resolve(process.cwd(), config.librariesRoot)
    const runtimeSkillsRoot = resolve(process.cwd(), config.runtimeSkillsRoot)
    const staticSkillsRoot = resolve(process.cwd(), config.staticSkillsRoot)

    const libraryService = new DesignLibraryService({ librariesRoot })
    const skillService = new SkillService({ runtimeSkillsRoot, staticSkillsRoot })

    // Await scans explicitly to ensure resources are loaded before routes are registered
    await libraryService.scanLibraries()
    await skillService.scanSkills()

    return {
      libraryService,
      skillService,
      config
    }
  },

  registerRoutes(router: Router, runtime: ServerRuntime) {
    const services = runtime.extensions?.design as {
      libraryService: DesignLibraryService
      skillService: SkillService
      config: z.infer<typeof DesignConfigSchema>
    } | undefined

    if (!services) {
      console.warn('[design] Services not initialized, skipping route registration')
      return
    }

    const { libraryService, skillService } = services

    // GET /v1/design/libraries - List all design libraries
    router.add('GET', '/v1/design/libraries', authenticated(async (req, context) => {
      const libraries = libraryService.listLibraries()
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ libraries })
      }
    }, runtime))

    // GET /v1/design/libraries/:id - Get library by ID
    router.add('GET', '/v1/design/libraries/:id', authenticated(async (req, context) => {
      const libraryId = context.params.id
      const library = libraryService.getLibrary(libraryId)

      if (!library) {
        return {
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Library not found' })
        }
      }

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ library })
      }
    }, runtime))

    // POST /v1/design/libraries/:id/reload - Reload library
    router.add('POST', '/v1/design/libraries/:id/reload', authenticated(async (req, context) => {
      const libraryId = context.params.id
      try {
        const library = await libraryService.reloadLibrary(libraryId)
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ library })
        }
      } catch (err) {
        return {
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))

    // POST /v1/design/components/search - Search components
    router.add('POST', '/v1/design/components/search', authenticated(async (req, context) => {
      try {
        const bodyText = await req.text()
        const search = DesignComponentSearchSchema.parse(JSON.parse(bodyText))
        const components = libraryService.searchComponents(search)
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ components, total: components.length })
        }
      } catch (err) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))

    // GET /v1/design/components/:id - Get component by ID
    router.add('GET', '/v1/design/components/:id', authenticated(async (req, context) => {
      const componentId = context.params.id
      const component = libraryService.getComponent(componentId)

      if (!component) {
        return {
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Component not found' })
        }
      }

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ component })
      }
    }, runtime))

    // POST /v1/design/assets/search - Search assets
    router.add('POST', '/v1/design/assets/search', authenticated(async (req, context) => {
      try {
        const bodyText = await req.text()
        const search = DesignAssetSearchSchema.parse(JSON.parse(bodyText))
        const assets = libraryService.searchAssets(search)
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assets, total: assets.length })
        }
      } catch (err) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))

    // GET /v1/design/assets/:id - Get asset by ID
    router.add('GET', '/v1/design/assets/:id', authenticated(async (req, context) => {
      const assetId = context.params.id
      const asset = libraryService.getAsset(assetId)

      if (!asset) {
        return {
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Asset not found' })
        }
      }

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asset })
      }
    }, runtime))

    // GET /v1/design/skills - List all runtime skills
    router.add('GET', '/v1/design/skills', authenticated(async (req, context) => {
      const skills = skillService.listRuntimeSkills()
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skills })
      }
    }, runtime))

    // POST /v1/design/skills/search - Search skills
    router.add('POST', '/v1/design/skills/search', authenticated(async (req, context) => {
      try {
        const bodyText = await req.text()
        const search = SkillSearchSchema.parse(JSON.parse(bodyText))
        const skills = skillService.searchRuntimeSkills(search)
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skills, total: skills.length })
        }
      } catch (err) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))

    // GET /v1/design/skills/:id - Get skill by ID
    router.add('GET', '/v1/design/skills/:id', authenticated(async (req, context) => {
      const skillId = decodeURIComponent(context.params.id)
      const skill = skillService.getRuntimeSkill(skillId)

      if (!skill) {
        return {
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Skill not found' })
        }
      }

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill })
      }
    }, runtime))

    // POST /v1/design/skills/execute - Execute skill (inject into context)
    router.add('POST', '/v1/design/skills/execute', authenticated(async (req, context) => {
      try {
        const bodyText = await req.text()
        const execContext = SkillExecutionContextSchema.parse(JSON.parse(bodyText))
        const result = skillService.executeSkill(execContext)
        return {
          status: result.success ? 200 : 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ result })
        }
      } catch (err) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))

    // POST /v1/design/skills/reload - Reload all skills
    router.add('POST', '/v1/design/skills/reload', authenticated(async (req, context) => {
      try {
        await skillService.reloadSkills()
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ success: true })
        }
      } catch (err) {
        return {
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))
  }
}

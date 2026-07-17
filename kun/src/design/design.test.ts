import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DesignLibraryService } from './services/design-library-service.js'
import { SkillService } from './services/skill-service.js'
import type { DesignLibraryMetadata } from './contracts/design-library-types.js'

describe('Design Domain Integration', () => {
  const testRoot = join(process.cwd(), '.test-design-data')
  const librariesRoot = join(testRoot, 'libraries')
  const runtimeSkillsRoot = join(testRoot, 'runtime-skills')
  const staticSkillsRoot = join(testRoot, 'skills')

  let libraryService: DesignLibraryService
  let skillService: SkillService

  beforeAll(async () => {
    // Create test directories
    await mkdir(librariesRoot, { recursive: true })
    await mkdir(runtimeSkillsRoot, { recursive: true })
    await mkdir(staticSkillsRoot, { recursive: true })

    // Create test design library
    const testLibraryPath = join(librariesRoot, 'test-lib')
    await mkdir(testLibraryPath, { recursive: true })

    const manifest: DesignLibraryMetadata = {
      id: 'test-lib',
      name: 'Test Design Library',
      version: '1.0.0',
      description: 'Test library for integration tests',
      author: 'Test Author',
      license: 'MIT',
      homepage: 'https://example.com',
      repository: 'https://github.com/example/test-lib',
      tags: ['test', 'design'],
      category: 'component-library'
    }

    await writeFile(
      join(testLibraryPath, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )

    // Create test components
    const componentsDir = join(testLibraryPath, 'components')
    await mkdir(componentsDir, { recursive: true })

    await writeFile(
      join(componentsDir, 'button.json'),
      JSON.stringify({
        id: 'test-lib/button',
        name: 'Button',
        displayName: 'Primary Button',
        description: 'A primary action button',
        category: 'actions',
        tags: ['button', 'action', 'primary'],
        framework: 'react',
        props: [
          { name: 'label', type: 'string', required: true },
          { name: 'onClick', type: 'function', required: true },
          { name: 'disabled', type: 'boolean', required: false, default: 'false' }
        ],
        variants: ['primary', 'secondary', 'ghost'],
        usage: 'Use for primary actions',
        examples: ['<Button label="Click me" onClick={handler} />']
      }, null, 2)
    )

    // Create test assets
    const assetsDir = join(testLibraryPath, 'assets')
    await mkdir(assetsDir, { recursive: true })

    await writeFile(
      join(assetsDir, 'logo.json'),
      JSON.stringify({
        id: 'test-lib/logo',
        name: 'Logo',
        type: 'icon',
        category: 'branding',
        tags: ['logo', 'brand'],
        path: 'assets/logo.svg',
        format: 'svg',
        usage: 'Company logo for headers'
      }, null, 2)
    )

    // Create test runtime skill
    await writeFile(
      join(runtimeSkillsRoot, 'test-skill.md'),
      `---
name: Test Skill
description: A test skill for integration tests
category: design-patterns
tags: ["test", "pattern"]
difficulty: beginner
---

# Test Skill

This is a test skill content.

## Usage

Use this skill for testing purposes.

\`\`\`typescript
const example = "test code"
\`\`\`

## References

[Test Link](https://example.com)
`
    )

    // Create test static skill
    await writeFile(
      join(staticSkillsRoot, 'static-skill.md'),
      `# Static Skill

This is a static skill for reference.
`
    )

    // Initialize services
    libraryService = new DesignLibraryService({
      librariesRoot,
      autoScan: false
    })

    skillService = new SkillService({
      runtimeSkillsRoot,
      staticSkillsRoot,
      autoScan: false
    })

    await libraryService.scanLibraries()
    await skillService.scanSkills()
  })

  afterAll(async () => {
    // Clean up test data
    await rm(testRoot, { recursive: true, force: true })
  })

  describe('DesignLibraryService', () => {
    it('should scan and load design libraries', () => {
      const libraries = libraryService.listLibraries()
      expect(libraries).toHaveLength(1)
      expect(libraries[0].id).toBe('test-lib')
      expect(libraries[0].name).toBe('Test Design Library')
    })

    it('should get library by id', () => {
      const library = libraryService.getLibrary('test-lib')
      expect(library).toBeDefined()
      expect(library?.id).toBe('test-lib')
      expect(library?.componentsCount).toBe(1)
      expect(library?.assetsCount).toBe(1)
    })

    it('should search components by query', () => {
      const results = libraryService.searchComponents({
        query: 'button',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Button')
      expect(results[0].category).toBe('actions')
    })

    it('should search components by category', () => {
      const results = libraryService.searchComponents({
        query: '',
        category: 'actions',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results).toHaveLength(1)
      expect(results[0].category).toBe('actions')
    })

    it('should search components by framework', () => {
      const results = libraryService.searchComponents({
        query: '',
        framework: 'react',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results).toHaveLength(1)
      expect(results[0].framework).toBe('react')
    })

    it('should search components by tags', () => {
      const results = libraryService.searchComponents({
        query: '',
        tags: ['button'],
        limit: 10,
        offset: 0
      })

      expect(results).toHaveLength(1)
      expect(results[0].tags).toContain('button')
    })

    it('should get component by id', () => {
      const component = libraryService.getComponent('test-lib/button')
      expect(component).toBeDefined()
      expect(component?.name).toBe('Button')
      expect(component?.props).toHaveLength(3)
    })

    it('should search assets by query', () => {
      const results = libraryService.searchAssets({
        query: 'logo',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Logo')
    })

    it('should search assets by type', () => {
      const results = libraryService.searchAssets({
        query: '',
        type: 'icon',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('icon')
    })

    it('should get asset by id', () => {
      const asset = libraryService.getAsset('test-lib/logo')
      expect(asset).toBeDefined()
      expect(asset?.name).toBe('Logo')
      expect(asset?.format).toBe('svg')
    })
  })

  describe('SkillService', () => {
    it('should scan and load runtime skills', () => {
      const skills = skillService.listRuntimeSkills()
      expect(skills.length).toBeGreaterThan(0)

      const testSkill = skills.find(s => s.name.includes('Test Skill'))
      expect(testSkill).toBeDefined()
      expect(testSkill?.category).toBe('design-patterns')
    })

    it('should load static skills', () => {
      const skills = skillService.listStaticSkills()
      expect(skills.length).toBeGreaterThan(0)

      const staticSkill = skills.find(s => s.name.includes('Static Skill'))
      expect(staticSkill).toBeDefined()
    })

    it('should get runtime skill by id', () => {
      const skills = skillService.listRuntimeSkills()
      const testSkill = skills.find(s => s.name.includes('Test Skill'))

      if (testSkill) {
        const skill = skillService.getRuntimeSkill(testSkill.id)
        expect(skill).toBeDefined()
        expect(skill?.name).toContain('Test Skill')
      }
    })

    it('should search skills by query', () => {
      const results = skillService.searchRuntimeSkills({
        query: 'test',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results.length).toBeGreaterThan(0)
      const testSkill = results.find(s => s.name.includes('Test Skill'))
      expect(testSkill).toBeDefined()
    })

    it('should search skills by category', () => {
      const results = skillService.searchRuntimeSkills({
        query: '',
        category: 'design-patterns',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results.length).toBeGreaterThan(0)
    })

    it('should search skills by difficulty', () => {
      const results = skillService.searchRuntimeSkills({
        query: '',
        difficulty: 'beginner',
        limit: 10,
        offset: 0,
        tags: []
      })

      expect(results.length).toBeGreaterThan(0)
    })

    it('should execute skill and inject content', () => {
      const skills = skillService.listRuntimeSkills()
      const testSkill = skills.find(s => s.name.includes('Test Skill'))

      if (testSkill) {
        const result = skillService.executeSkill({
          skillId: testSkill.id,
          userPrompt: '',
          additionalContext: { test: 'context' }
        })

        expect(result.success).toBe(true)
        expect(result.injectedContent).toContain('Test Skill')
        expect(result.injectedContent).toContain('test code')
      }
    })

    it('should parse skill sections', () => {
      const skills = skillService.listRuntimeSkills()
      const testSkill = skills.find(s => s.name.includes('Test Skill'))

      if (testSkill) {
        expect(testSkill.sections.length).toBeGreaterThan(0)
        expect(testSkill.sections.some(s => s.title === 'Usage')).toBe(true)
      }
    })

    it('should parse code examples', () => {
      const skills = skillService.listRuntimeSkills()
      const testSkill = skills.find(s => s.name.includes('Test Skill'))

      if (testSkill) {
        expect(testSkill.codeExamples.length).toBeGreaterThan(0)
        expect(testSkill.codeExamples[0].language).toBe('typescript')
      }
    })

    it('should parse references', () => {
      const skills = skillService.listRuntimeSkills()
      const testSkill = skills.find(s => s.name.includes('Test Skill'))

      if (testSkill) {
        expect(testSkill.references.length).toBeGreaterThan(0)
        expect(testSkill.references[0].title).toBe('Test Link')
      }
    })
  })
})

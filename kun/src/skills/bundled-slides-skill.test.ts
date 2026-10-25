import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSkillPackage } from './skill-runtime-support.js'

const SLIDES_ROOT = resolve(process.cwd(), '..', 'resources', 'bundled-skills', 'slides')

describe('bundled slides skill', () => {
  it('loads with every declared reference and the deck tool playbook', async () => {
    const skill = await loadSkillPackage(SLIDES_ROOT, false, 'builtin')
    expect(skill).not.toBeNull()
    expect(skill!.id).toBe('slides')
    expect(skill!.triggers.commands).toEqual(expect.arrayContaining(['/slides', '/ppt']))
    expect(skill!.triggers.promptPatterns).toEqual(expect.arrayContaining(['PPT', '演示文稿', '幻灯片']))
    expect(skill!.assets.length).toBeGreaterThan(40)
    for (const asset of skill!.assets) {
      expect((await readFile(asset, 'utf8')).trim().length).toBeGreaterThan(0)
    }
    for (const tool of ['ppt_preview', 'ppt_export', 'ppt_import_asset', 'load_skill_asset']) {
      expect(skill!.entry).toContain(`\`${tool}\``)
    }
    expect(skill!.entry).not.toContain('ppt_agent')
  })

  it('points every reference the playbook names at a declared asset', async () => {
    const skill = await loadSkillPackage(SLIDES_ROOT, false, 'builtin')
    const named = [...skill!.entry.matchAll(/`(references\/[^`<>]+\.md)`/g)].map((match) => match[1])
    expect(named.length).toBeGreaterThan(5)
    for (const path of named) {
      expect(skill!.assets.some((asset) => asset.replaceAll('\\', '/').endsWith(`/${path}`))).toBe(true)
    }
  })
})

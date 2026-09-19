import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/bundled-skills/excalidraw-diagram')

describe('excalidraw-diagram bundled skill', () => {
  it('declares a Kun-authored Excalidraw canvas skill above diagram-design', () => {
    const manifest = JSON.parse(readFileSync(join(skillRoot, 'skill.json'), 'utf8')) as {
      id: string
      entry: string
      priority: number
      triggers: { commands: string[]; promptPatterns: string[]; fileTypes?: string[] }
      assets: string[]
    }
    expect(manifest.id).toBe('excalidraw-diagram')
    expect(manifest.entry).toBe('SKILL.md')
    expect(manifest.priority).toBeGreaterThan(20)
    expect(manifest.triggers.commands).toContain('/excalidraw')
    expect(manifest.triggers.promptPatterns).toEqual(expect.arrayContaining([
      'excalidraw',
      '手绘白板'
    ]))
    expect(manifest.triggers.fileTypes).toContain('.excalidraw')
    expect(manifest.triggers.promptPatterns.join(' ')).not.toMatch(/流程图|diagram(?!-)/)
    expect(manifest.assets).toEqual([
      'references/kun-scene.md',
      'references/color-palette.md',
      'references/element-templates.md',
      'references/json-schema.md'
    ])
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
    expect(skill).toContain('design_apply_excalidraw')
    expect(skill).toContain('Do not use Python, Playwright')
    expect(skill).not.toContain('uv run')
    expect(skill).not.toContain('esm.sh')
    expect(readFileSync(join(skillRoot, 'LICENSE.txt'), 'utf8')).toContain('MIT License')
  })
})

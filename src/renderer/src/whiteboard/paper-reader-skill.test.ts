import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/bundled-skills/paper-reader')

describe('paper-reader bundled skill', () => {
  it('declares the manifest expected by the interpretation flow', () => {
    const manifest = JSON.parse(readFileSync(join(skillRoot, 'skill.json'), 'utf8')) as {
      id: string
      entry: string
      priority: number
      triggers: { commands: string[]; promptPatterns: string[] }
      assets: string[]
    }
    expect(manifest.id).toBe('paper-reader')
    expect(manifest.entry).toBe('SKILL.md')
    expect(manifest.priority).toBe(25)
    expect(manifest.triggers.commands).toContain('/paper-read')
    expect(manifest.triggers.promptPatterns).toEqual(expect.arrayContaining([
      '论文解读',
      'paper-reader',
      '精读论文'
    ]))
    expect(manifest.assets).toEqual([
      'references/figure-rules.md',
      'references/whiteboard-rules.md'
    ])
    for (const asset of manifest.assets) {
      expect(readFileSync(join(skillRoot, asset), 'utf8').length).toBeGreaterThan(0)
    }
    expect(readFileSync(join(skillRoot, 'LICENSE.txt'), 'utf8')).toContain('MIT License')
  })

  it('pins the interpretation contracts in SKILL.md', () => {
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
    // Input contract
    expect(skill).toContain('paper.json')
    expect(skill).toContain('paper.md')
    expect(skill).toContain('figures/index.json')
    // Output contract: never mutate unit files
    expect(skill).toContain('Never modify `paper.json`, `NOTES.md`, the PDF, or `figures/`')
    // Structure + endings
    expect(skill).toContain('重点难点速查')
    expect(skill).toContain('一句话总结')
    // Hard rules
    expect(skill).toContain('论文未明确说明')
    expect(skill).toContain('[p.N](<id>.pdf#page=N)')
    expect(skill).not.toContain('Sources / 参考文献 block**') // sanity: rule phrased as "Do not append"
    // Whiteboard flow referenced, not inlined
    expect(skill).toContain('references/whiteboard-rules.md')
    expect(skill).toContain('references/figure-rules.md')
    expect(skill.split('\n').length).toBeLessThanOrEqual(120)
  })

  it('pins the exportPath procedure in the whiteboard reference', () => {
    const rules = readFileSync(join(skillRoot, 'references/whiteboard-rules.md'), 'utf8')
    expect(rules).toContain('design_open_excalidraw')
    expect(rules).toContain('design_apply_excalidraw')
    expect(rules).toContain('exportPath')
    expect(rules).toContain('assets/<title>.png')
    expect(rules).toContain('.kun-whiteboards/<boardId>/excalidraw.json')
  })
})

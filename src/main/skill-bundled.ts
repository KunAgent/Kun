import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Built-in "design system & craft" skill. Seeded once into ~/.kun/skills/ on
 * first launch (idempotent seed marker, mirrors ensureBundledUiPlugins). The
 * Kun runtime discovers it from the skills root and the agent can load it
 * (auto-activated on design prompts, or via load_skill). Deleting it is honored
 * — it is not force-recreated. Appears after the next runtime restart.
 */

const BUNDLED_SEED_MARKER = '.bundled-skills-seed-v1'
const SKILL_ID = 'design-system'

const SKILL_MANIFEST = {
  id: SKILL_ID,
  name: 'Design system & craft',
  version: '1.0.0',
  description:
    'Brand-grade visual craft for design work — design-system-first thinking and anti-AI-slop rules.',
  entry: 'SKILL.md',
  triggers: {
    commands: ['/design'],
    promptPatterns: ['design', 'mockup', 'prototype', 'ui', 'design system', '设计', '原型', '界面', '配色'],
    fileTypes: []
  },
  priority: 0
}

const SKILL_INSTRUCTIONS = `---
id: design-system
name: Design system & craft
description: Brand-grade visual craft for design work — design-system-first thinking and anti-AI-slop rules.
---

# Design system & craft

Hold this bar on any visual work — HTML mockups, prototypes, real UI.

## 1. Design system is the source of truth
- If \`.kun-design/DESIGN_SYSTEM.md\` exists in the workspace, read it first and honor it: brand color, tone, type, radius, density, the named preset. It is the contract shared between the design canvas and the code.
- Derive every visual decision from tokens (color, spacing scale, radius, type scale), not ad-hoc values. Keep them consistent across the whole artifact.

## 2. Avoid generic AI tells
These read as "AI made this" — do not ship them:
- Cream / sand / beige default backgrounds; default to a deliberate neutral that fits the brand.
- Purple→blue diagonal gradients as a hero default.
- Bounce / elastic / overshoot easing. Use calm, short, standard easing.
- Endlessly nested cards (a card inside a card inside a card).
- Low-contrast gray text on colored or tinted backgrounds.
- Emoji as iconography in a serious product.

## 3. Craft baseline
- **Contrast & a11y**: verify text contrast (WCAG AA); never rely on color alone; provide a \`prefers-reduced-motion\` fallback for any animation.
- **Type**: a real type scale (not two sizes); generous line-height for body; tighten headings.
- **Spacing**: one spacing scale, applied rhythmically; align to a grid; let content breathe.
- **Hierarchy**: one clear focal point per view; size/weight/color do the work, not borders everywhere.
- **Motion**: purposeful and subtle; entrance/feedback only; respect reduced-motion.
- **Responsive**: design mobile and desktop intentionally, not just a squished desktop.

## 4. Output
- Single-file, self-contained HTML is the canvas format: inline CSS, real fonts, real components, no external build.
- Make it runnable as-is. Prefer system fonts or a single well-chosen web font.
- When the user iterates, change only what they asked for — keep the rest stable.
`

let seedPromise: Promise<void> | null = null

export function ensureBundledSkills(kunHomeDir: string): Promise<void> {
  seedPromise ??= (async () => {
    const skillsRoot = join(kunHomeDir, 'skills')
    const markerPath = join(skillsRoot, BUNDLED_SEED_MARKER)
    try {
      await stat(markerPath)
      return
    } catch {
      // not seeded yet
    }
    let seeded = false
    try {
      const skillDir = join(skillsRoot, SKILL_ID)
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'skill.json'), `${JSON.stringify(SKILL_MANIFEST, null, 2)}\n`, 'utf8')
      await writeFile(join(skillDir, 'SKILL.md'), SKILL_INSTRUCTIONS, 'utf8')
      seeded = true
    } catch (error) {
      console.error('[skill] failed to seed bundled design skill:', error)
    }
    // Only stamp the marker on success so a failed seed retries next launch.
    if (seeded) {
      try {
        await mkdir(skillsRoot, { recursive: true })
        await writeFile(markerPath, `${SKILL_ID}\n`, 'utf8')
      } catch {
        // marker write failure is acceptable; seed retries next launch
      }
    }
  })()
  return seedPromise
}

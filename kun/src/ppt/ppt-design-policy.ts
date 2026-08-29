import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'

export const PPT_CORE_DESIGN_POLICY_VERSION = '1.0.0' as const
export const PPT_CORE_DESIGN_POLICY_PATH = 'core-design-policy-v1.md' as const
export const PPT_CORE_DESIGN_POLICY_RULES_PATH = 'core-design-policy-v1.rules.json' as const

export const PptPolicyExceptionRule = z.enum([
  'cards-for-hierarchy',
  'equal-panel-grid',
  'generic-tech-gradient',
  'glow-or-glass',
  'decorative-particles',
  'ornamental-grid',
  'mixed-icon-system',
  'tiny-type'
])
export type PptPolicyExceptionRule = z.infer<typeof PptPolicyExceptionRule>

export const PptVisualEffect = z.enum(['glow', 'glass', 'particles', 'ornamental-grid'])
export type PptVisualEffect = z.infer<typeof PptVisualEffect>

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export const PptCoreDesignPolicyRules = z.object({
  version: z.literal(PPT_CORE_DESIGN_POLICY_VERSION),
  markdown: z.object({
    path: z.literal(PPT_CORE_DESIGN_POLICY_PATH),
    sha256: Sha256
  }).strict(),
  contrast: z.object({
    foregroundBackgroundMinimum: z.number().min(1).max(21),
    foregroundGradientStopMinimum: z.number().min(1).max(21)
  }).strict(),
  colorFamilies: z.record(z.string().min(1), z.object({
    hueRanges: z.array(z.tuple([
      z.number().min(0).max(360),
      z.number().min(0).max(360)
    ])).min(1),
    minimumSaturation: z.number().min(0).max(1),
    evidenceTerms: z.array(z.string().min(1)).min(1)
  }).strict()),
  backgroundRestrictions: z.array(z.object({
    kind: z.literal('gradient'),
    containsColorFamilies: z.array(z.string().min(1)).min(2),
    evidenceTerms: z.array(z.string().min(1)).min(1),
    exceptionRule: PptPolicyExceptionRule
  }).strict()),
  effectRestrictions: z.array(z.object({
    effect: PptVisualEffect,
    evidenceTerms: z.array(z.string().min(1)).min(1),
    exceptionRule: PptPolicyExceptionRule
  }).strict())
}).strict().superRefine((rules, ctx) => {
  for (const [index, restriction] of rules.backgroundRestrictions.entries()) {
    for (const family of restriction.containsColorFamilies) {
      if (!(family in rules.colorFamilies)) {
        ctx.addIssue({
          code: 'custom',
          path: ['backgroundRestrictions', index, 'containsColorFamilies'],
          message: `unknown color family ${family}`
        })
      }
    }
  }
  const effects = new Set<string>()
  for (const [index, restriction] of rules.effectRestrictions.entries()) {
    if (effects.has(restriction.effect)) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectRestrictions', index, 'effect'],
        message: `duplicate effect restriction ${restriction.effect}`
      })
    }
    effects.add(restriction.effect)
  }
  for (const effect of PptVisualEffect.options) {
    if (!effects.has(effect)) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectRestrictions'],
        message: `missing effect restriction ${effect}`
      })
    }
  }
})
export type PptCoreDesignPolicyRules = z.infer<typeof PptCoreDesignPolicyRules>

export type PptCoreDesignPolicy = {
  version: typeof PPT_CORE_DESIGN_POLICY_VERSION
  path: typeof PPT_CORE_DESIGN_POLICY_PATH
  rulesPath: typeof PPT_CORE_DESIGN_POLICY_RULES_PATH
  sha256: string
  markdownSha256: string
  rulesSha256: string
  content: string
  rulesContent: string
  rules: PptCoreDesignPolicyRules
}

/** Load and verify the canonical policy bundled with the PPT toolchain. */
export async function loadPptCoreDesignPolicy(toolchainDirectory: string): Promise<PptCoreDesignPolicy> {
  const referenceDirectory = resolve(toolchainDirectory, 'reference')
  const [rawContent, rawRulesContent] = await Promise.all([
    readFile(resolve(referenceDirectory, PPT_CORE_DESIGN_POLICY_PATH), 'utf8'),
    readFile(resolve(referenceDirectory, PPT_CORE_DESIGN_POLICY_RULES_PATH), 'utf8')
  ])
  const content = canonicalText(rawContent)
  const rulesContent = canonicalText(rawRulesContent)
  const declaredVersion = /^Policy-Version:\s*(\S+)\s*$/m.exec(content)?.[1]
  if (declaredVersion !== PPT_CORE_DESIGN_POLICY_VERSION) {
    throw new Error(
      `PPT core design policy version mismatch: expected ${PPT_CORE_DESIGN_POLICY_VERSION}, got ${declaredVersion || 'missing'}`
    )
  }
  const declaredRulesPath = /^Policy-Rules:\s*(\S+)\s*$/m.exec(content)?.[1]
  if (declaredRulesPath !== PPT_CORE_DESIGN_POLICY_RULES_PATH) {
    throw new Error(
      `PPT core design policy rules path mismatch: expected ${PPT_CORE_DESIGN_POLICY_RULES_PATH}, got ${declaredRulesPath || 'missing'}`
    )
  }
  const markdownSha256 = sha256(content)
  let parsedRules: unknown
  try {
    parsedRules = JSON.parse(rulesContent)
  } catch (error) {
    throw new Error(`PPT core design policy rules are invalid JSON: ${errorMessage(error)}`)
  }
  const rules = PptCoreDesignPolicyRules.parse(parsedRules)
  if (rules.markdown.sha256 !== markdownSha256) {
    throw new Error(
      `PPT core design policy Markdown hash mismatch: expected ${rules.markdown.sha256}, got ${markdownSha256}`
    )
  }
  const rulesSha256 = sha256(rulesContent)
  return {
    version: PPT_CORE_DESIGN_POLICY_VERSION,
    path: PPT_CORE_DESIGN_POLICY_PATH,
    rulesPath: PPT_CORE_DESIGN_POLICY_RULES_PATH,
    sha256: sha256(`${markdownSha256}\0${rulesSha256}`),
    markdownSha256,
    rulesSha256,
    content,
    rulesContent,
    rules
  }
}

/** Format policy content for the host-owned child control prompt. */
export function formatPptCoreDesignPolicyControl(policy: PptCoreDesignPolicy): string {
  return [
    `<PPT_CORE_DESIGN_POLICY version="${policy.version}" sha256="${policy.sha256}">`,
    policy.content.trim(),
    '</PPT_CORE_DESIGN_POLICY>',
    `<PPT_CORE_DESIGN_RULES path="${policy.rulesPath}" sha256="${policy.rulesSha256}">`,
    policy.rulesContent.trim(),
    '</PPT_CORE_DESIGN_RULES>'
  ].join('\n')
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function canonicalText(content: string): string {
  return content.replace(/\r\n?/g, '\n')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

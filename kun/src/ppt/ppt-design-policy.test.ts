import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatPptCoreDesignPolicyControl,
  loadPptCoreDesignPolicy,
  PPT_CORE_DESIGN_POLICY_PATH,
  PPT_CORE_DESIGN_POLICY_RULES_PATH
} from './ppt-design-policy.js'

const toolchain = resolve(process.cwd(), '..', 'resources', 'ppt-toolchain')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PPT core design policy binding', () => {
  it('loads one versioned identity bound to both Markdown and machine rules hashes', async () => {
    const policy = await loadPptCoreDesignPolicy(toolchain)
    expect(policy).toMatchObject({
      version: '1.0.0',
      path: PPT_CORE_DESIGN_POLICY_PATH,
      rulesPath: PPT_CORE_DESIGN_POLICY_RULES_PATH,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      markdownSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      rulesSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      rules: {
        version: '1.0.0',
        markdown: { path: PPT_CORE_DESIGN_POLICY_PATH },
        contrast: {
          foregroundBackgroundMinimum: 4.5,
          foregroundGradientStopMinimum: 4.5
        }
      }
    })
    expect(policy.rules.markdown.sha256).toBe(policy.markdownSha256)
    expect(policy.sha256).not.toBe(policy.markdownSha256)
    expect(policy.sha256).not.toBe(policy.rulesSha256)
    expect(formatPptCoreDesignPolicyControl(policy)).toContain('<PPT_CORE_DESIGN_RULES')
  })

  it('rejects Markdown drift until the companion hash is deliberately updated', async () => {
    const root = await copiedToolchain()
    const markdownPath = join(root, 'reference', PPT_CORE_DESIGN_POLICY_PATH)
    await writeFile(markdownPath, `${await readFile(markdownPath, 'utf8')}\nDrift.\n`)
    await expect(loadPptCoreDesignPolicy(root)).rejects.toThrow('Markdown hash mismatch')
  })

  it('rejects a companion rules version that drifts from the Markdown policy version', async () => {
    const root = await copiedToolchain()
    const rulesPath = join(root, 'reference', PPT_CORE_DESIGN_POLICY_RULES_PATH)
    const rules = JSON.parse(await readFile(rulesPath, 'utf8')) as Record<string, unknown>
    rules.version = '2.0.0'
    await writeFile(rulesPath, `${JSON.stringify(rules, null, 2)}\n`)
    await expect(loadPptCoreDesignPolicy(root)).rejects.toThrow()
  })

  it('keeps policy identity stable across LF and CRLF checkouts', async () => {
    const expected = await loadPptCoreDesignPolicy(toolchain)
    const root = await copiedToolchain()
    await Promise.all([PPT_CORE_DESIGN_POLICY_PATH, PPT_CORE_DESIGN_POLICY_RULES_PATH].map(async (path) => {
      const filePath = join(root, 'reference', path)
      const content = await readFile(filePath, 'utf8')
      await writeFile(filePath, content.replace(/\r?\n/g, '\r\n'))
    }))

    const actual = await loadPptCoreDesignPolicy(root)
    expect(actual.sha256).toBe(expected.sha256)
    expect(actual.markdownSha256).toBe(expected.markdownSha256)
    expect(actual.rulesSha256).toBe(expected.rulesSha256)
  })
})

async function copiedToolchain(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-ppt-policy-'))
  temporaryRoots.push(root)
  const reference = join(root, 'reference')
  await mkdir(reference, { recursive: true })
  await Promise.all([PPT_CORE_DESIGN_POLICY_PATH, PPT_CORE_DESIGN_POLICY_RULES_PATH].map(async (path) => {
    await writeFile(
      join(reference, path),
      await readFile(resolve(toolchain, 'reference', path), 'utf8')
    )
  }))
  return root
}

import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { expandHomePath, FastContextConfigSchema, LabConfigSchema, LabPptAgentConfigSchema, readKunConfigFile, RuntimeTuningConfigSchema } from './kun-config.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

describe('RuntimeTuningConfigSchema streamIdleTimeoutMs', () => {
  it('accepts a custom timeout, including 0 to disable the guard', () => {
    expect(RuntimeTuningConfigSchema.safeParse({ streamIdleTimeoutMs: 300_000 }).success).toBe(true)
    expect(RuntimeTuningConfigSchema.safeParse({ streamIdleTimeoutMs: 0 }).success).toBe(true)
  })

  it('rejects negative or fractional timeouts', () => {
    expect(RuntimeTuningConfigSchema.safeParse({ streamIdleTimeoutMs: -1 }).success).toBe(false)
    expect(RuntimeTuningConfigSchema.safeParse({ streamIdleTimeoutMs: 1.5 }).success).toBe(false)
  })
})

describe('RuntimeTuningConfigSchema turn admission', () => {
  it('accepts a bounded positive global turn concurrency cap', () => {
    expect(RuntimeTuningConfigSchema.safeParse({
      turnLimits: { maxConcurrentTurns: 4 }
    }).success).toBe(true)
  })

  it('rejects zero, fractions, and excessive global turn caps', () => {
    expect(RuntimeTuningConfigSchema.safeParse({
      turnLimits: { maxConcurrentTurns: 0 }
    }).success).toBe(false)
    expect(RuntimeTuningConfigSchema.safeParse({
      turnLimits: { maxConcurrentTurns: 1.5 }
    }).success).toBe(false)
    expect(RuntimeTuningConfigSchema.safeParse({
      turnLimits: { maxConcurrentTurns: 257 }
    }).success).toBe(false)
  })
})

describe('RuntimeTuningConfigSchema Agent Perspective capture', () => {
  it('defaults an existing llmDebug block to enabled', () => {
    expect(RuntimeTuningConfigSchema.parse({
      llmDebug: {}
    }).llmDebug).toEqual({ enabled: true })
  })

  it('preserves explicit facility and new-thread capture defaults', () => {
    expect(RuntimeTuningConfigSchema.parse({
      llmDebug: { enabled: true, defaultThreadCaptureEnabled: true }
    }).llmDebug).toEqual({ enabled: true, defaultThreadCaptureEnabled: true })
    expect(RuntimeTuningConfigSchema.parse({
      llmDebug: { enabled: false, defaultThreadCaptureEnabled: false }
    }).llmDebug).toEqual({ enabled: false, defaultThreadCaptureEnabled: false })
  })
})

describe('default subagent parallelism', () => {
  it('defaults max parallel subagent runs to 256', () => {
    expect(DEFAULT_KUN_CAPABILITIES_CONFIG.subagents.maxParallel).toBe(256)
  })

  it('defaults proactive retry to three main-agent attempts', () => {
    expect(DEFAULT_KUN_CAPABILITIES_CONFIG.subagents.proactiveRetry).toEqual({
      enabled: true,
      maxAttempts: 3
    })
  })
})

describe('expandHomePath', () => {
  it('expands Windows-style home-relative paths', () => {
    expect(expandHomePath('~\\kun\\config.json')).toBe(join(homedir(), 'kun', 'config.json'))
  })

  it('leaves non-home tilde prefixes untouched', () => {
    expect(expandHomePath('~other/config.json')).toBe('~other/config.json')
  })
})

describe('readKunConfigFile provider compatibility', () => {
  async function withConfigFile(contents: string, run: (path: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'kun-config-'))
    const path = join(dir, 'config.json')
    await writeFile(path, contents, 'utf8')
    try {
      await run(path)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('accepts providers.modelProfiles written by the current GUI', async () => {
    await withConfigFile(JSON.stringify({
      serve: {
        providers: {
          deepseek: {
            kind: 'http',
            baseUrl: 'https://api.deepseek.com',
            modelProfiles: {
              'deepseek-v4-pro': { contextWindowTokens: 128_000 }
            }
          }
        }
      }
    }), async (path) => {
      const loaded = readKunConfigFile(path)
      const profile = loaded.config.serve?.providers?.deepseek?.modelProfiles
      expect(profile?.['deepseek-v4-pro']?.contextWindowTokens).toBe(128_000)
    })
  })

  it('migrates the legacy gemini-cli-subscription kind idempotently', async () => {
    await withConfigFile(JSON.stringify({
      serve: {
        providers: {
          'gemini-cli-subscription': {
            kind: 'gemini-cli-subscription',
            modelProfiles: { 'gemini-2.5-flash': { contextWindowTokens: 1_000_000 } }
          }
        }
      }
    }), async (path) => {
      const loaded = readKunConfigFile(path)
      expect(loaded.config.serve?.providers?.['gemini-cli-subscription']?.kind)
        .toBe('gemini-cli-api')
    })
  })

  it('fails closed with the offending provider path for unknown kinds', async () => {
    await withConfigFile(JSON.stringify({
      serve: {
        providers: {
          mystery: { kind: 'not-a-kind', baseUrl: 'https://example.test' }
        }
      }
    }), async (path) => {
      let message = ''
      try {
        readKunConfigFile(path)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('Invalid Kun config')
      expect(message).toContain('providers')
      expect(message).toContain('mystery')
      expect(message).toContain('kind')
    })
  })
})

describe('LabPptAgentConfigSchema', () => {
  it('defaults to enabled with follow-main model and no fast', () => {
    const parsed = LabPptAgentConfigSchema.parse({})
    expect(parsed).toEqual({ enabled: true, fast: false, imageFirst: true })
  })

  it('accepts a paired model override with reasoning effort', () => {
    const parsed = LabPptAgentConfigSchema.parse({
      enabled: true,
      model: 'gpt-5.4',
      providerId: 'codex-2',
      reasoningEffort: 'high',
      fast: true
    })
    expect(parsed.model).toBe('gpt-5.4')
    expect(parsed.providerId).toBe('codex-2')
    expect(parsed.reasoningEffort).toBe('high')
    expect(parsed.fast).toBe(true)
  })

  it('rejects a half-configured model override', () => {
    expect(LabPptAgentConfigSchema.safeParse({ model: 'gpt-5.4' }).success).toBe(false)
    expect(LabPptAgentConfigSchema.safeParse({ providerId: 'codex-2' }).success).toBe(false)
  })

  it('defaults pptAgent inside LabConfigSchema', () => {
    const lab = LabConfigSchema.parse({})
    expect(lab.pptAgent).toEqual({ enabled: true, fast: false, imageFirst: true })
  })

  it('defaults Fast Context at the config root', () => {
    expect(FastContextConfigSchema.parse({})).toEqual({ enabled: true, fast: false })
  })
})

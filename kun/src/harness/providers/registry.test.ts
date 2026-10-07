import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUILTIN_HARNESSES } from '../builtin-harnesses.js'
import { EXPANDED_HARNESS_UPDATE_RECIPES } from '../expanded-harness-update-recipes.js'
import { legacyProviderKindFor } from '../harness-provider-kind.js'
import { PROVIDER_MODULES, providerModule } from './registry.js'

/**
 * Pipeline stages dispatch to provider modules. Engine knowledge lives in the
 * modules and their credential libraries; these files must stay engine-neutral.
 */
const PIPELINE_FILES = [
  '../harness-catalog.ts',
  '../harness-detector.ts',
  '../harness-installation.ts',
  '../harness-login-probes.ts',
  '../harness-readiness.ts',
  '../harness-readiness-profile.ts',
  '../harness-runtime.ts',
  '../harness-secret-env.ts',
  '../harness-turn-permissions.ts',
  '../harness-update-check.ts',
  '../harness-update-recipes.ts',
  '../harness-updates.ts',
  '../native-agent-network.ts',
  '../acp-handshake-probe.ts',
  '../acp-model-catalog.ts',
  '../resolve-turn-harness.ts',
  '../../runtime/acp/acp-credential-env.ts',
  '../../runtime/acp/acp-runtime-support.ts',
  '../../runtime/acp/acp-session-manager.ts'
]

describe('provider module registry', () => {
  it('keeps one module per engine in catalog order', () => {
    const ids = PROVIDER_MODULES.map((module) => module.definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(BUILTIN_HARNESSES.map((definition) => definition.id)).toEqual(ids)
    expect(ids.slice(0, 12)).toEqual(['deepseek-harness', 'kun', 'claude-code', 'cursor', 'antigravity', 'gemini-cli',
      'codex', 'pi', 'opencode', 'codemaker', 'opencode2', 'devin'])
    for (const id of ids) expect(providerModule(id)?.definition.id).toBe(id)
    expect(providerModule('custom-agent')).toBeUndefined()
  })

  it('agrees with the renderer-safe native account manifest', () => {
    for (const module of PROVIDER_MODULES) {
      expect(legacyProviderKindFor(module.definition.id), module.definition.id).toBe(module.nativeAccount?.kind)
    }
  })

  it('attaches every curated update recipe to an engine', () => {
    for (const id of Object.keys(EXPANDED_HARNESS_UPDATE_RECIPES)) {
      expect(providerModule(id)?.update, id).toBe(EXPANDED_HARNESS_UPDATE_RECIPES[id])
    }
  })

  it('keeps pipeline stages free of engine ids', () => {
    const engineIds = PROVIDER_MODULES.map((module) => module.definition.id).filter((id) => id !== 'kun')
    for (const file of PIPELINE_FILES) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      const found = engineIds.filter((id) => source.includes(`'${id}'`) || source.includes(`"${id}"`))
      expect(found, file).toEqual([])
    }
  })
})

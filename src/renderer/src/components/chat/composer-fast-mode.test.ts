import { describe, expect, it } from 'vitest'
import type { ModelProviderModelProfileV1 } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  composerFastModeState,
  composerSupportsCodexFastMode,
  modelProviderSupportsCodexFastMode,
  serviceTierForComposerSelection
} from './composer-fast-mode'

function profile(
  serviceTiers?: ('priority' | 'flex')[],
  aliases?: string[]
): ModelProviderModelProfileV1 {
  return {
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    ...(aliases ? { aliases } : {}),
    ...(serviceTiers ? { serviceTiers } : {})
  }
}

const CODEX_GROUP: ModelProviderModelGroup = {
  providerId: 'codex-2',
  presetSource: 'codex',
  label: 'ChatGPT subscription 2',
  modelIds: ['gpt-6-astra', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-6-vega'],
  modelProfiles: {
    'gpt-6-astra': profile(['priority'], ['astra']),
    'gpt-5.4': profile(),
    'gpt-5.4-mini': profile([]),
    'gpt-6-vega': profile(['flex'])
  }
}

const OPENAI_GROUP: ModelProviderModelGroup = {
  providerId: 'custom-openai',
  label: 'Custom OpenAI',
  modelIds: ['gpt-6-astra'],
  modelProfiles: { 'gpt-6-astra': profile(['priority']) }
}

describe('composer Fast mode state', () => {
  it('supports a Codex model with priority and only then sends the tier', () => {
    expect(composerFastModeState([CODEX_GROUP], 'gpt-6-astra', 'codex-2')).toBe('supported')
    expect(composerSupportsCodexFastMode([CODEX_GROUP], 'gpt-6-astra', 'codex-2')).toBe(true)
    expect(serviceTierForComposerSelection(true, [CODEX_GROUP], 'gpt-6-astra', 'codex-2'))
      .toBe('priority')
    expect(serviceTierForComposerSelection(false, [CODEX_GROUP], 'gpt-6-astra', 'codex-2'))
      .toBeUndefined()
  })

  it('treats an undeclared tier list as unknown and never sends the tier', () => {
    expect(composerFastModeState([CODEX_GROUP], 'gpt-5.4', 'codex-2')).toBe('unknown')
    expect(serviceTierForComposerSelection(true, [CODEX_GROUP], 'gpt-5.4', 'codex-2'))
      .toBeUndefined()
  })

  it('treats a declared tier list without priority as unsupported', () => {
    expect(composerFastModeState([CODEX_GROUP], 'gpt-5.4-mini', 'codex-2')).toBe('unsupported')
    expect(composerFastModeState([CODEX_GROUP], 'gpt-6-vega', 'codex-2')).toBe('unsupported')
    expect(serviceTierForComposerSelection(true, [CODEX_GROUP], 'gpt-6-vega', 'codex-2'))
      .toBeUndefined()
  })

  it('resolves aliases and legacy Codex provider ids', () => {
    expect(composerFastModeState([CODEX_GROUP], 'astra', 'codex-2')).toBe('supported')
    const legacyGroup: ModelProviderModelGroup = {
      providerId: 'codex',
      label: 'Codex',
      modelIds: ['gpt-6-astra'],
      modelProfiles: { 'gpt-6-astra': profile(['priority']) }
    }
    expect(composerFastModeState([legacyGroup], 'gpt-6-astra', 'codex')).toBe('supported')
  })

  it('keeps non-Codex providers hidden even with a priority profile', () => {
    expect(composerFastModeState([OPENAI_GROUP], 'gpt-6-astra', 'custom-openai')).toBe('hidden')
    expect(composerSupportsCodexFastMode([OPENAI_GROUP], 'gpt-6-astra', 'custom-openai'))
      .toBe(false)
    expect(serviceTierForComposerSelection(true, [OPENAI_GROUP], 'gpt-6-astra', 'custom-openai'))
      .toBeUndefined()
  })

  it('hides Fast without a matching provider group or model', () => {
    expect(composerFastModeState([CODEX_GROUP], '', 'codex-2')).toBe('hidden')
    expect(composerFastModeState([CODEX_GROUP], 'gpt-6-astra', '')).toBe('hidden')
    expect(composerFastModeState([CODEX_GROUP], 'gpt-6-astra', 'missing-provider')).toBe('hidden')
  })

  it('keeps provider-level support checks independent of the group projection', () => {
    const provider = {
      id: 'codex-2',
      presetSource: { presetId: 'codex', mode: 'api' as const },
      modelProfiles: {
        'gpt-6-astra': profile(['priority']),
        'gpt-5.4-mini': profile([])
      }
    }
    expect(modelProviderSupportsCodexFastMode(provider, 'gpt-6-astra')).toBe(true)
    expect(modelProviderSupportsCodexFastMode(provider, 'gpt-5.4-mini')).toBe(false)
    expect(modelProviderSupportsCodexFastMode({
      id: 'custom-openai',
      presetSource: undefined,
      modelProfiles: { 'gpt-6-astra': profile(['priority']) }
    }, 'gpt-6-astra')).toBe(false)
  })
})

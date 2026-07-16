import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { MoaConfigAdapter } from './moa-config.js'
import { BUILTIN_MOA_PRESETS } from '../contracts/moa-types.js'

describe('MoaConfigAdapter', () => {
  it('persists saved presets and reloads them after restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-moa-'))
    try {
      const adapter = new MoaConfigAdapter({ rawConfig: {}, dataDir })
      await adapter.initialize()
      await adapter.savePreset({
        id: 'review-board',
        name: 'Review Board',
        description: 'Saved preset',
        layers: [
          { type: 'proposer', models: ['default/reviewer-a', 'default/reviewer-b'] },
          { type: 'aggregator', models: ['default/aggregator'] }
        ],
        costMultiplier: 3,
        enabled: true
      })

      const restarted = new MoaConfigAdapter({ rawConfig: {}, dataDir })
      await restarted.initialize()
      expect(restarted.getPreset('review-board')).toMatchObject({ name: 'Review Board' })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('rejects recursive MoA references', async () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })
    await expect(adapter.savePreset({
      id: 'recursive', name: 'Recursive', description: '',
      layers: [
        { type: 'proposer', models: ['moa:balanced-local'] },
        { type: 'aggregator', models: ['default/agg'] }
      ],
      costMultiplier: 2,
      enabled: true
    })).rejects.toThrow('cannot reference another MoA')
  })

  it('should_load_builtin_presets_by_default', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    const presets = adapter.getPresets()
    // Only the single-provider default preset is enabled out of the box;
    // cross-provider presets are disabled until credentials are configured.
    expect(presets.find(p => p.id === 'balanced-local')).toBeDefined()
  })

  it('should_filter_disabled_presets', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    const presets = adapter.getPresets()
    // Cross-provider presets are disabled by default.
    expect(presets.find(p => p.id === 'research-6-proposer')).toBeUndefined()
    expect(presets.find(p => p.id === 'quality-3-proposer')).toBeUndefined()
  })

  it('should_get_preset_by_id', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    const preset = adapter.getPreset('balanced-local')
    expect(preset).toBeDefined()
    expect(preset!.name).toBe('Balanced (Self-MoA, default provider)')
    expect(preset!.layers.length).toBe(2)
  })

  it('should_return_undefined_for_disabled_preset', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    const preset = adapter.getPreset('research-6-proposer')
    expect(preset).toBeUndefined() // Disabled by default
  })

  it('should_merge_user_presets_with_builtins', () => {
    const adapter = new MoaConfigAdapter({
      rawConfig: {
        presets: [
          {
            id: 'custom-preset',
            name: 'Custom Preset',
            description: 'User-defined preset',
            layers: [
              {
                type: 'proposer',
                models: ['custom-model-1', 'custom-model-2']
              },
              {
                type: 'aggregator',
                models: ['custom-agg']
              }
            ],
            costMultiplier: 5,
            enabled: true
          }
        ]
      }
    })

    const presets = adapter.getPresets()
    const customPreset = presets.find(p => p.id === 'custom-preset')
    expect(customPreset).toBeDefined()
    expect(customPreset!.name).toBe('Custom Preset')

    // Builtin default preset should still be available
    expect(presets.find(p => p.id === 'balanced-local')).toBeDefined()
  })

  it('should_allow_user_preset_to_override_builtin', () => {
    const adapter = new MoaConfigAdapter({
      rawConfig: {
        presets: [
          {
            id: 'balanced-local',
            name: 'Overridden Balanced',
            description: 'User override',
            layers: [
              {
                type: 'proposer',
                models: ['override-model']
              },
              {
                type: 'aggregator',
                models: ['override-agg']
              }
            ],
            costMultiplier: 99,
            enabled: true
          }
        ]
      }
    })

    const preset = adapter.getPreset('balanced-local')
    expect(preset).toBeDefined()
    expect(preset!.name).toBe('Overridden Balanced')
    expect(preset!.costMultiplier).toBe(99)
  })

  it('should_parse_model_reference_with_provider', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    const parsed = adapter.parseModelReference('openai/gpt-4o')
    expect(parsed.providerId).toBe('openai')
    expect(parsed.modelId).toBe('gpt-4o')
  })

  it('should_parse_model_reference_without_provider', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    const parsed = adapter.parseModelReference('claude-3-5-sonnet-20241022')
    expect(parsed.providerId).toBeUndefined()
    expect(parsed.modelId).toBe('claude-3-5-sonnet-20241022')
  })

  it('should_return_default_preset_from_config', () => {
    const adapter = new MoaConfigAdapter({
      rawConfig: {
        defaultPresetId: 'balanced-local'
      }
    })

    const defaultPreset = adapter.getDefaultPreset()
    expect(defaultPreset).toBeDefined()
    expect(defaultPreset!.id).toBe('balanced-local')
  })

  it('should_report_preset_providers_excluding_default', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    // balanced-local uses bare modelIds (default provider) -> no explicit providers
    const balanced = adapter.getPreset('balanced-local')!
    expect(adapter.getPresetProviders(balanced)).toEqual([])
  })

  it('should_disable_presets_with_unconfigured_providers', () => {
    const adapter = new MoaConfigAdapter({
      rawConfig: {
        presets: [
          {
            id: 'needs-anthropic',
            name: 'Needs Anthropic',
            description: 'Cross-provider preset',
            layers: [
              { type: 'proposer', models: ['anthropic/claude-3-5-sonnet-20241022'] },
              { type: 'aggregator', models: ['anthropic/claude-3-5-sonnet-20241022'] }
            ],
            costMultiplier: 3,
            enabled: true
          }
        ]
      }
    })

    // Only the default provider is configured; anthropic is missing.
    const disabled = adapter.validateProviders(['default'])
    expect(disabled.find(d => d.presetId === 'needs-anthropic')).toBeDefined()
    expect(disabled.find(d => d.presetId === 'needs-anthropic')!.missing).toContain('anthropic')
    // The preset must now be filtered out of the enabled list.
    expect(adapter.getPreset('needs-anthropic')).toBeUndefined()
  })

  it('should_keep_presets_when_providers_are_configured', () => {
    const adapter = new MoaConfigAdapter({
      rawConfig: {
        presets: [
          {
            id: 'needs-anthropic',
            name: 'Needs Anthropic',
            description: 'Cross-provider preset',
            layers: [
              { type: 'proposer', models: ['anthropic/claude-3-5-sonnet-20241022'] },
              { type: 'aggregator', models: ['anthropic/claude-3-5-sonnet-20241022'] }
            ],
            costMultiplier: 3,
            enabled: true
          }
        ]
      }
    })

    const disabled = adapter.validateProviders(['default', 'anthropic'])
    expect(disabled.find(d => d.presetId === 'needs-anthropic')).toBeUndefined()
    expect(adapter.getPreset('needs-anthropic')).toBeDefined()
  })

  it('should_fallback_to_first_preset_if_no_default_configured', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    const defaultPreset = adapter.getDefaultPreset()
    expect(defaultPreset).toBeDefined()
    // Should be first enabled preset (quality-3-proposer or fast-2-proposer)
  })

  it('should_return_tracing_enabled_from_config', () => {
    const adapter = new MoaConfigAdapter({
      rawConfig: {
        enableTracing: true
      }
    })

    expect(adapter.isTracingEnabled()).toBe(true)
  })

  it('should_default_tracing_to_false', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    expect(adapter.isTracingEnabled()).toBe(false)
  })

  it('should_return_max_concurrent_proposers_from_config', () => {
    const adapter = new MoaConfigAdapter({
      rawConfig: {
        maxConcurrentProposers: 8
      }
    })

    expect(adapter.getMaxConcurrentProposers()).toBe(8)
  })

  it('should_default_max_concurrent_proposers_to_4', () => {
    const adapter = new MoaConfigAdapter({ rawConfig: {} })

    expect(adapter.getMaxConcurrentProposers()).toBe(4)
  })
})

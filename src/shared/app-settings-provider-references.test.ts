import { describe, expect, it } from 'vitest'
import type { ModelProviderProfileV1 } from './app-settings-types'
import {
  listModelProviderReferences,
  modelProviderReferenceKinds
} from './app-settings-provider-references'
import { normalizeAppSettings } from './app-settings'

function profile(id: string): ModelProviderProfileV1 {
  return {
    id,
    name: id,
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    useProxy: false,
    models: ['m1'],
    modelProfiles: {}
  }
}

const settingsWith = (patch: Record<string, unknown>) => normalizeAppSettings({
  ...patch,
  provider: {
    providers: [profile('prov-a'), profile('prov-b'), profile('prov-c')],
    ...((patch.provider as Record<string, unknown> | undefined) ?? {})
  }
} as never)

describe('listModelProviderReferences', () => {
  it('finds kun default route and pinned model references', () => {
    const settings = settingsWith({
      agents: {
        kun: {
          providerId: 'prov-a',
          smallModelProviderId: 'prov-a',
          titleModelProviderId: 'prov-a',
          approvalReview: { mode: 'fixed', providerId: 'prov-a', model: 'm1' },
          contextCompaction: { summaryProviderId: 'prov-a' }
        }
      }
    })
    const kinds = modelProviderReferenceKinds(settings, 'prov-a')
    for (const kind of ['chat', 'smallModel', 'titleModel', 'approvalReview', 'contextCompaction']) {
      expect(kinds).toContain(kind)
    }
  })

  it('finds media and lab surface references', () => {
    const settings = settingsWith({
      agents: {
        kun: {
          imageGeneration: { providerId: 'prov-a' },
          speechToText: { providerId: 'prov-a' },
          textToSpeech: { providerId: 'prov-a' },
          musicGeneration: { providerId: 'prov-a' },
          videoGeneration: { providerId: 'prov-a' },
          promptOptimization: { providerId: 'prov-a' },
          fastContext: { providerId: 'prov-a', model: 'm1' },
          lab: {
            pptAgent: { providerId: 'prov-a', model: 'm1' },
            autoPlanBuild: { scheduledDefaults: { providerId: 'prov-a' } }
          },
          graph: { workerModel: { mode: 'fixed', providerId: 'prov-a', model: 'm1' } }
        }
      }
    })
    const kinds = modelProviderReferenceKinds(settings, 'prov-a')
    for (const kind of [
      'image', 'speech', 'textToSpeech', 'music', 'video',
      'promptOptimization', 'fastContext', 'pptAgent', 'autoPlanBuild', 'graph'
    ]) {
      expect(kinds).toContain(kind)
    }
  })

  it('finds subagent, write, design, im, schedule, and workflow references with details', () => {
    const settings = settingsWith({
      agents: {
        kun: { subagents: { profiles: [{ name: 'Reviewer', providerId: 'prov-a' }] } }
      },
      write: { inlineCompletion: { inheritProvider: false, providerId: 'prov-a' } },
      design: { providerId: 'prov-a' },
      claw: {
        im: { providerId: 'prov-a' },
        channels: [{ id: 'ch1', label: 'ops', providerId: 'prov-a' }]
      },
      schedule: {
        providerId: 'prov-a',
        tasks: [{ id: 't1', title: 'Nightly', providerId: 'prov-a' }]
      },
      workflow: {
        providerId: 'prov-a',
        workflows: [{
          id: 'w1',
          name: 'Flow',
          nodes: [{ id: 'n1', type: 'ai-agent', config: { providerId: 'prov-a' } }]
        }]
      }
    })
    const references = listModelProviderReferences(settings, 'prov-a')
    const kinds = references.map((ref) => ref.kind)
    for (const kind of ['subagent', 'write', 'design', 'im', 'schedule', 'workflow']) {
      expect(kinds).toContain(kind)
    }
    expect(references).toContainEqual({ kind: 'subagent', detail: 'Reviewer' })
    expect(references).toContainEqual({ kind: 'schedule', detail: 'Nightly' })
    expect(references).toContainEqual({ kind: 'workflow', detail: 'Flow' })
  })

  it('finds route-pool targets and failover member/fallback references', () => {
    const settings = settingsWith({
      provider: {
        routePools: [{
          id: 'pool1',
          name: 'Balanced',
          modelId: 'm1',
          targets: [{ providerId: 'prov-a', modelId: 'm1' }]
        }],
        failover: [
          { providerId: 'prov-b', accounts: [{ providerId: 'prov-a' }] },
          { providerId: 'prov-c', fallbackTargets: [{ providerId: 'prov-a', modelId: 'm1' }] }
        ]
      }
    })
    const references = listModelProviderReferences(settings, 'prov-a')
    expect(references).toContainEqual({ kind: 'routePool', detail: 'Balanced' })
    expect(references.filter((ref) => ref.kind === 'failover').length).toBeGreaterThanOrEqual(2)
  })

  it('ignores inherited write completion and non-fixed bindings', () => {
    const settings = settingsWith({
      write: { inlineCompletion: { inheritProvider: true, providerId: 'prov-a' } },
      agents: {
        kun: {
          approvalReview: { mode: 'inherit' },
          graph: { workerModel: { mode: 'inherit' } }
        }
      }
    })
    expect(listModelProviderReferences(settings, 'prov-a')).toEqual([])
  })

  it('returns no references for a different or empty provider id', () => {
    const settings = settingsWith({ agents: { kun: { providerId: 'prov-a' } } })
    expect(listModelProviderReferences(settings, 'prov-b')).toEqual([])
    expect(listModelProviderReferences(settings, '')).toEqual([])
  })
})

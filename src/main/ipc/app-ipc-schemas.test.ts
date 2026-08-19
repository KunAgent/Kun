import {
  describe,
  expect,
  it
} from 'vitest'
import {
  appBadgeCountSchema,
  cursorSubscriptionDiscoveryPayloadSchema,
  modelProviderCredentialRevealPayloadSchema,
  modelsDevCatalogPayloadSchema,
  notificationPayloadSchema,
  runtimeRequestPayloadSchema,
  settingsPatchSchema,
  skillGithubImportPayloadSchema,
  skillListPayloadSchema
} from './app-ipc-schemas'

describe('app-ipc-schemas runtime', () => {
  it('accepts only bounded non-negative integer app badge counts', () => {
    expect(appBadgeCountSchema.parse(0)).toBe(0)
    expect(appBadgeCountSchema.parse(42)).toBe(42)
    expect(appBadgeCountSchema.parse(999)).toBe(999)
    expect(() => appBadgeCountSchema.parse(-1)).toThrow()
    expect(() => appBadgeCountSchema.parse(1.5)).toThrow()
    expect(() => appBadgeCountSchema.parse(1_000)).toThrow()
    expect(() => appBadgeCountSchema.parse({ count: 1 })).toThrow()
  })

  it('accepts only modeled completion notification sources', () => {
    expect(notificationPayloadSchema.parse({
      threadId: 'thread-main',
      source: 'main-agent',
      title: 'Kun',
      body: 'Done'
    }).source).toBe('main-agent')
    expect(notificationPayloadSchema.parse({
      threadId: 'thread-child',
      source: 'subagent',
      title: 'Kun',
      body: 'Done'
    }).source).toBe('subagent')
    expect(() => notificationPayloadSchema.parse({
      threadId: 'thread-other',
      source: 'extension',
      title: 'Kun',
      body: 'Done'
    })).toThrow()
  })

  it('accepts only a bounded Cursor API key for subscription discovery', () => {
    expect(cursorSubscriptionDiscoveryPayloadSchema.parse({
      apiKey: ' cursor-key '
    })).toEqual({ apiKey: 'cursor-key' })
    expect(cursorSubscriptionDiscoveryPayloadSchema.parse({
      providerId: ' cursor-subscription '
    })).toEqual({ providerId: 'cursor-subscription' })
    expect(() => cursorSubscriptionDiscoveryPayloadSchema.parse({
      apiKey: 'cursor-key',
      endpoint: 'https://private.cursor.example'
    })).toThrow()
    expect(() => cursorSubscriptionDiscoveryPayloadSchema.parse({ apiKey: '' })).toThrow()
  })

  it('accepts only one bounded provider identity for credential reveal', () => {
    expect(modelProviderCredentialRevealPayloadSchema.parse({
      providerId: ' deepseek '
    })).toEqual({ providerId: 'deepseek' })
    expect(() => modelProviderCredentialRevealPayloadSchema.parse({ providerId: '' })).toThrow()
    expect(() => modelProviderCredentialRevealPayloadSchema.parse({
      providerId: 'deepseek',
      credential: 'must-not-cross-the-request-boundary'
    })).toThrow()
  })

  it('accepts only provider identity and refresh fields for models.dev lookup', () => {
    expect(modelsDevCatalogPayloadSchema.parse({
      providerId: 'xiaomi-token-plan',
      baseUrl: ' https://token-plan-cn.xiaomimimo.com/v1 ',
      forceRefresh: true,
      modelHints: [{ id: 'gpt-5.5', aliases: ['gpt-latest'] }]
    })).toEqual({
      providerId: 'xiaomi-token-plan',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      forceRefresh: true,
      modelHints: [{ id: 'gpt-5.5', aliases: ['gpt-latest'] }]
    })
    expect(modelsDevCatalogPayloadSchema.parse({
      providerId: 'cursor-subscription',
      baseUrl: '',
      modelHints: [{ id: 'gemini-3.6-flash' }]
    })).toEqual({
      providerId: 'cursor-subscription',
      baseUrl: '',
      modelHints: [{ id: 'gemini-3.6-flash' }]
    })
    expect(() => modelsDevCatalogPayloadSchema.parse({
      providerId: 'xiaomi-token-plan',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      apiKey: 'must-not-cross-this-boundary'
    })).toThrow()
  })

  it('accepts a named local model gateway provider', () => {
    expect(settingsPatchSchema.parse({
      provider: {
        localGateway: { enabled: true, name: ' Team Relay ' }
      }
    }).provider?.localGateway).toEqual({ enabled: true, name: 'Team Relay' })
  })

  it('normalizes runtime request paths', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: 'v1/threads?limit=1',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/threads?limit=1')
  })

  it('accepts the Kun runtime info endpoint', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: '/v1/runtime/info',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/runtime/info')
  })

  it('accepts the Kun runtime tool diagnostics endpoint', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: '/v1/runtime/tools',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/runtime/tools')
  })

  it('accepts only the modeled Kun model connection operations', () => {
    for (const payload of [
      { path: '/v1/model-connections', method: 'GET' },
      { path: '/v1/model-connections', method: 'PATCH', body: '{}' },
      { path: '/v1/model-connections/events?since_revision=1', method: 'GET' },
      { path: '/v1/model-connections/connect', method: 'POST', body: '{}' },
      { path: '/v1/model-connections/select', method: 'POST', body: '{}' },
      { path: '/v1/model-connections/oauth/start', method: 'POST', body: '{}' },
      { path: '/v1/model-connections/oauth/session_1', method: 'GET' },
      { path: '/v1/model-connections/oauth/session_1', method: 'DELETE' },
      {
        path: '/v1/model-connections/oauth/session_1/submit',
        method: 'POST',
        body: '{}'
      },
      { path: '/v1/model-connections/claude/sdk', method: 'GET' },
      { path: '/v1/model-connections/claude/sdk/install', method: 'POST', body: '{}' },
      { path: '/v1/model-connections/provider-a', method: 'PATCH', body: '{}' },
      { path: '/v1/model-connections/provider-a', method: 'DELETE' },
      {
        path: '/v1/model-connections/provider-a/credential',
        method: 'PUT',
        body: '{}'
      },
      { path: '/v1/model-connections/provider-a/credential', method: 'DELETE' },
      {
        path: '/v1/model-connections/provider-a/credential/fence',
        method: 'POST',
        body: '{}'
      },
      {
        path: '/v1/model-connections/provider-a/credential/commit',
        method: 'POST',
        body: '{}'
      },
      { path: '/v1/model-connections/provider-a/probe', method: 'POST', body: '{}' }
    ] as const) {
      expect(runtimeRequestPayloadSchema.parse(payload).path).toBe(payload.path)
    }
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/model-connections/events',
      method: 'DELETE'
    })).toThrow(/runtime request path is not allowed/)
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/model-connections/provider-a/credential/fence',
      method: 'GET'
    })).toThrow(/runtime request path is not allowed/)
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/model-connections/provider-a/credential/finalize',
      method: 'POST',
      body: '{}'
    })).toThrow(/runtime request path is not allowed/)
  })

  it('accepts only the modeled Kun route diagnostics operations', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/model-routes',
      method: 'GET'
    }).path).toBe('/v1/model-routes')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/model-routes/kimi%20pool/test',
      method: 'POST'
    }).path).toBe('/v1/model-routes/kimi%20pool/test')
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/model-routes',
      method: 'DELETE'
    })).toThrow(/runtime request path is not allowed/)
  })

  it('accepts Kun supply-chain audit endpoints', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/supply-chain/audit',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/supply-chain/audit')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/supply-chain/update-check',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/supply-chain/update-check')
  })

  it('accepts Kun MCP OAuth status and token reset endpoints', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/mcp/oauth',
      method: 'GET'
    }).path).toBe('/v1/mcp/oauth')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/mcp/oauth/google_drive',
      method: 'DELETE'
    }).path).toBe('/v1/mcp/oauth/google_drive')
  })

  it('accepts the Kun skills endpoint', () => {
    const payload = runtimeRequestPayloadSchema.parse({
      path: '/v1/skills',
      method: 'GET'
    })

    expect(payload.path).toBe('/v1/skills')
  })

  it('accepts Kun attachment and memory endpoints', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/attachments',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/attachments')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/attachments/att_1/content?thread_id=thr_1',
      method: 'GET'
    }).path).toBe('/v1/attachments/att_1/content?thread_id=thr_1')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/memory',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/memory')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/memory/mem_1',
      method: 'PATCH',
      body: '{}'
    }).path).toBe('/v1/memory/mem_1')
  })

  it('accepts the read-only node graph endpoint and rejects writes to it', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/node-graph',
      method: 'GET'
    }).path).toBe('/v1/node-graph')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/node-graph?workspace=%2Frepo&changed_files=false&refresh=true',
      method: 'GET'
    }).path).toBe('/v1/node-graph?workspace=%2Frepo&changed_files=false&refresh=true')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/node-graph/folder?root=%2FUsers%2Fme%2Fvault',
      method: 'GET'
    }).path).toBe('/v1/node-graph/folder?root=%2FUsers%2Fme%2Fvault')
    // Node Graph is a projection; no method other than GET may reach it.
    for (const path of ['/v1/node-graph', '/v1/node-graph/folder']) {
      for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
        expect(() => runtimeRequestPayloadSchema.parse({
          path,
          method,
          body: '{}'
        })).toThrow(/runtime request path is not allowed/)
      }
    }
  })

  it('accepts https GitHub skill import URLs and rejects other schemes', () => {
    expect(skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'https://github.com/acme/skills/tree/main/review'
    })).toEqual({
      rootPath: '/tmp/skills',
      url: 'https://github.com/acme/skills/tree/main/review'
    })
    // Scheme-less input is allowed (the importer normalizes it to https).
    expect(skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'github.com/acme/skills'
    }).url).toBe('github.com/acme/skills')
    // Dangerous / non-https explicit schemes are rejected at the boundary.
    expect(() => skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'http://github.com/acme/skills'
    })).toThrow()
    expect(() => skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'file:///etc/passwd'
    })).toThrow()
    expect(() => skillGithubImportPayloadSchema.parse({
      rootPath: '/tmp/skills',
      url: 'javascript:alert(1)'
    })).toThrow()
  })

  it('accepts skill list payloads with an optional workspace root', () => {
    expect(skillListPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace '
    })).toEqual({ workspaceRoot: '/tmp/workspace' })
    expect(skillListPayloadSchema.parse({})).toEqual({})
  })

  it('accepts Kun thread goal endpoints', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/goal',
      method: 'GET'
    }).path).toBe('/v1/threads/thr_1/goal')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/goal',
      method: 'POST',
      body: '{}'
    }).path).toBe('/v1/threads/thr_1/goal')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/goal',
      method: 'DELETE'
    }).path).toBe('/v1/threads/thr_1/goal')
  })

  it('accepts only GET requests for bounded Kun thread timeline pages', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/timeline?before=item_42&limit=300',
      method: 'GET'
    }).path).toBe('/v1/threads/thr_1/timeline?before=item_42&limit=300')
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/timeline',
      method: 'POST',
      body: '{}'
    })).toThrow(/runtime request path is not allowed/)
  })

  it('accepts only the modeled knowledge-base status and reindex operations', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr%2Fone/knowledge-bases',
      method: 'GET'
    }).path).toBe('/v1/threads/thr%2Fone/knowledge-bases')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/knowledge-bases/kb%2Fdocs/reindex',
      method: 'POST'
    }).path).toBe('/v1/threads/thr_1/knowledge-bases/kb%2Fdocs/reindex')

    for (const payload of [
      { path: '/v1/threads/thr_1/knowledge-bases', method: 'PATCH', body: '{}' },
      { path: '/v1/threads/thr_1/knowledge-bases/kb_docs/reindex', method: 'GET' },
      { path: '/v1/threads/thr_1/knowledge-bases/kb_docs/delete', method: 'POST' }
    ] as const) {
      expect(() => runtimeRequestPayloadSchema.parse(payload)).toThrow(
        /runtime request path is not allowed/
      )
    }
  })

  it('accepts the Kun delegation profiles endpoint', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/delegation/profiles',
      method: 'GET'
    }).path).toBe('/v1/delegation/profiles')
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/delegation/profiles?workspace=%2Ftmp%2Fproject',
      method: 'GET'
    }).path).toBe('/v1/delegation/profiles?workspace=%2Ftmp%2Fproject')
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/delegation/profiles',
      method: 'POST'
    })).toThrow(/runtime request path is not allowed/)
  })

  it('accepts only POST requests for one encoded Kun subagent abort endpoint', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/delegation/abort/child%2Fone',
      method: 'POST'
    }).path).toBe('/v1/delegation/abort/child%2Fone')
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/delegation/abort/child%2Fone',
      method: 'GET'
    })).toThrow(/runtime request path is not allowed/)
  })

  it('accepts only the modeled Kun Graph workbench endpoints', () => {
    for (const payload of [
      { path: '/v1/graphs?thread_id=thread_1', method: 'GET' },
      { path: '/v1/graph-drafts?thread_id=thread_1', method: 'GET' },
      { path: '/v1/graph-drafts/draft%201', method: 'GET' },
      {
        path: '/v1/graph-drafts/draft_1/resume',
        method: 'POST',
        body: '{"expectedRevision":2}'
      },
      {
        path: '/v1/graph-drafts/draft_1/cancel',
        method: 'POST',
        body: '{"expectedRevision":2}'
      },
      { path: '/v1/graphs/run%201', method: 'GET' },
      { path: '/v1/graphs/run_1/supervision', method: 'GET' },
      { path: '/v1/graphs/run_1/supervision/wake', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/events?since_seq=3', method: 'GET' },
      { path: '/v1/graphs/run_1/artifacts/artifact%201?offset=0', method: 'GET' },
      { path: '/v1/graphs/run_1/start', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/pause', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/resume', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/cleanup', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/cancel', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/retry', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/steer', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/patch', method: 'POST', body: '{}' },
      { path: '/v1/graphs/run_1/reviews', method: 'POST', body: '{}' },
      {
        path: '/v1/graph-projects/identity?workspace=%2Ftmp%2Fproject',
        method: 'GET'
      },
      {
        path: '/v1/graph-projects/project_1/agents?include_archived=true',
        method: 'GET'
      },
      { path: '/v1/graph-projects/project_1/evidence', method: 'GET' },
      { path: '/v1/graph-projects/project_1/scores', method: 'GET' },
      { path: '/v1/graph-projects/project_1/audit', method: 'GET' },
      { path: '/v1/graph-projects/project_1/candidates', method: 'GET' },
      { path: '/v1/graph-projects/project_1/jobs', method: 'GET' },
      {
        path: '/v1/graph-projects/project_1/agents/profile_1/lifecycle',
        method: 'POST',
        body: '{}'
      },
      {
        path: '/v1/graph-projects/project_1/agents/profile_1/export',
        method: 'GET'
      },
      {
        path: '/v1/graph-projects/project_1/agents/import',
        method: 'POST',
        body: '{}'
      },
      {
        path: '/v1/graph-projects/project_1/agents/merge',
        method: 'POST',
        body: '{}'
      },
      {
        path: '/v1/graph-projects/project_1/candidates/candidate_1/action',
        method: 'POST',
        body: '{}'
      },
      {
        path: '/v1/graph-projects/project_1/consolidate',
        method: 'POST',
        body: '{}'
      }
    ] as const) {
      expect(runtimeRequestPayloadSchema.parse(payload).path).toBe(payload.path)
    }

    for (const payload of [
      { path: '/v1/graphs', method: 'POST' },
      { path: '/v1/graph-drafts', method: 'POST' },
      { path: '/v1/graph-drafts/draft_1', method: 'DELETE' },
      { path: '/v1/graph-drafts/draft_1/resume', method: 'GET' },
      { path: '/v1/graph-drafts/draft_1/cancel', method: 'DELETE' },
      { path: '/v1/graphs/run_1/start', method: 'DELETE' },
      { path: '/v1/graphs/run_1/supervision', method: 'POST' },
      { path: '/v1/graphs/run_1/supervision/wake', method: 'GET' },
      { path: '/v1/graph-projects/identity', method: 'POST' },
      {
        path: '/v1/graph-projects/project_1/agents/profile_1/lifecycle',
        method: 'GET'
      },
      { path: '/v1/graphs/run_1/secrets', method: 'GET' },
      { path: '/v1/graph-projects/project_1/admin', method: 'GET' }
    ] as const) {
      expect(() => runtimeRequestPayloadSchema.parse(payload)).toThrow(
        /runtime request path is not allowed/
      )
    }
  })

  it('accepts the Kun thread review endpoint', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/review',
      method: 'POST',
      body: '{"target":{"kind":"uncommittedChanges"}}'
    }).path).toBe('/v1/threads/thr_1/review')
  })

  it('accepts the read-only Kun turn status endpoint', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/turns/turn_1',
      method: 'GET'
    }).path).toBe('/v1/threads/thr_1/turns/turn_1')
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/threads/thr_1/turns/turn_1',
      method: 'DELETE'
    })).toThrow(/runtime request path is not allowed/)
  })

  it('accepts the LLM debug rounds endpoint', () => {
    expect(runtimeRequestPayloadSchema.parse({
      path: '/v1/debug/llm-rounds',
      method: 'GET'
    }).path).toBe('/v1/debug/llm-rounds')
  })

  it('rejects runtime request paths outside the modeled Kun API surface', () => {
    expect(() =>
      runtimeRequestPayloadSchema.parse({
        path: '/v1/runtime/secrets',
        method: 'GET'
      })
    ).toThrow(/runtime request path is not allowed/)
  })

  it('rejects runtime request methods that do not match the modeled endpoint', () => {
    expect(() =>
      runtimeRequestPayloadSchema.parse({
        path: '/v1/usage',
        method: 'POST'
      })
    ).toThrow(/runtime request path is not allowed/)
  })

  it('keeps approval decisions off the generic runtime request bridge', () => {
    expect(() =>
      runtimeRequestPayloadSchema.parse({
        path: '/v1/approvals/appr_1',
        method: 'POST',
        body: '{"decision":"allow"}'
      })
    ).toThrow(/runtime request path is not allowed/)
  })

  it('keeps extension workbench and configuration operations off the generic runtime bridge', () => {
    for (const payload of [
      { path: '/v1/extensions/workbench', method: 'GET' },
      {
        path: '/v1/extensions/configuration/snapshot',
        method: 'POST',
        body: '{"contributionIds":[]}'
      },
      {
        path: '/v1/extensions/configuration',
        method: 'PUT',
        body: '{}'
      }
    ] as const) {
      expect(() => runtimeRequestPayloadSchema.parse(payload)).toThrow(
        /runtime request path is not allowed/
      )
    }
  })

})

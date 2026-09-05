import { describe, expect, it } from 'vitest'
import {
  GLOBAL_SUBAGENT_PROVIDER_IDS,
  GLOBAL_SUBAGENT_TOOL_NAMES,
  withGlobalSubagentTools
} from './subagent-global-tool-policy.js'

describe('global subagent tool policy', () => {
  it('adds Fast Context after an ordinary profile allow-list is narrowed', () => {
    expect(withGlobalSubagentTools({ allowedToolNames: ['read'] }))
      .toEqual(['read', 'fast_context'])
    expect(GLOBAL_SUBAGENT_TOOL_NAMES).toEqual(['fast_context'])
    expect(GLOBAL_SUBAGENT_PROVIDER_IDS).toEqual(['fast-context'])
  })

  it('keeps parent tool and provider capability snapshots authoritative', () => {
    expect(withGlobalSubagentTools({
      allowedToolNames: ['read'],
      parentAllowedToolNames: ['read']
    })).toEqual(['read'])
    expect(withGlobalSubagentTools({
      allowedToolNames: ['read'],
      parentAllowedProviderIds: ['builtin']
    })).toEqual(['read'])
  })

  it('honors explicit tool and provider deny-lists', () => {
    expect(withGlobalSubagentTools({
      allowedToolNames: ['read'],
      blockedToolNames: ['fast_context']
    })).toEqual(['read'])
    expect(withGlobalSubagentTools({
      allowedToolNames: ['read'],
      parentBlockedProviderIds: ['fast-context']
    })).toEqual(['read'])
  })

  it('does not recursively add Fast Context to its retrieval child', () => {
    expect(withGlobalSubagentTools({
      allowedToolNames: ['grep', 'glob', 'read'],
      fastContext: true
    })).toEqual(['grep', 'glob', 'read'])
  })
})

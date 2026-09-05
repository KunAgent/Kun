import { describe, expect, it } from 'vitest'
import { graphPathScopedToolNames } from './graph-security-policy.js'

describe('Graph scoped tool policy', () => {
  it('removes process and whole-workspace tools from narrow assignments', () => {
    expect(graphPathScopedToolNames(
      [
        'read',
        'write',
        'bash',
        'background_shell',
        'repo_map',
        'fast_context',
        'graph_control_run',
        'graph_worker_progress'
      ],
      ['src'],
      ['src/generated']
    )).toEqual(['read', 'write', 'fast_context'])
  })

  it('preserves the authorized tool snapshot for a full-workspace assignment', () => {
    expect(graphPathScopedToolNames(
      [
        'read',
        'bash',
        'background_shell',
        'repo_map',
        'fast_context',
        'graph_supervise_node',
        'graph_worker_submit_result'
      ],
      ['.'],
      ['.']
    )).toEqual(['read', 'bash', 'background_shell', 'repo_map', 'fast_context'])
  })
})

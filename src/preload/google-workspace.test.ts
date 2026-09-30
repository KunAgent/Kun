import { describe, expect, it, vi } from 'vitest'
import { createGoogleWorkspacePreloadApi } from './google-workspace'
import { GOOGLE_WORKSPACE_CHANNELS } from '../shared/google-workspace'

describe('Google Workspace preload bridge', () => {
  it('exposes only fixed no-argument IPC channels', async () => {
    const invoke = vi.fn(async () => ({}))
    const api = createGoogleWorkspacePreloadApi({ invoke } as never)
    for (const key of Object.keys(api) as (keyof typeof api)[]) {
      await (api[key] as (...args: unknown[]) => Promise<unknown>)('https://evil.test')
      expect(invoke).toHaveBeenLastCalledWith(GOOGLE_WORKSPACE_CHANNELS[key])
    }
  })
})

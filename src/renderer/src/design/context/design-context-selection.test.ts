import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDesignContextSelection, saveDesignContextSelection } from './design-context-selection'

describe('design context selection persistence', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns an empty versioned selection when the workspace file is absent', async () => {
    vi.stubGlobal('window', { kunGui: { readWorkspaceFile: vi.fn(async () => ({ ok: false, message: 'missing' })) } })
    await expect(loadDesignContextSelection('/workspace')).resolves.toEqual({ version: 1, selected: [] })
  })

  it('writes the versioned selection under .kun-design', async () => {
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true, path: '', savedAt: '' }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    await saveDesignContextSelection('/workspace', {
      version: 1,
      selected: [{ contributionId: 'skill:a11y', version: '1', enabled: true }]
    })
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      path: '.kun-design/context.json',
      content: expect.stringContaining('skill:a11y')
    })
  })
})

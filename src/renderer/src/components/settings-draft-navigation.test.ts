import { describe, expect, it, vi } from 'vitest'
import { resolveSettingsDraftExit } from './settings-draft-navigation'

describe('settings draft exit', () => {
  it('keeps the editor open without changing a draft', async () => {
    const controller = { save: vi.fn(async () => true), discard: vi.fn() }
    expect(await resolveSettingsDraftExit('keep', controller)).toBe('keep')
    expect(controller.save).not.toHaveBeenCalled()
    expect(controller.discard).not.toHaveBeenCalled()
  })

  it('leaves only after a successful save and stays after a failed save', async () => {
    const controller = { save: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), discard: vi.fn() }
    expect(await resolveSettingsDraftExit('save', controller)).toBe('save-failed')
    expect(await resolveSettingsDraftExit('save', controller)).toBe('leave')
    expect(controller.discard).not.toHaveBeenCalled()
  })

  it('discards the local draft before leaving', async () => {
    const controller = { save: vi.fn(async () => true), discard: vi.fn() }
    expect(await resolveSettingsDraftExit('discard', controller)).toBe('leave')
    expect(controller.discard).toHaveBeenCalledOnce()
    expect(controller.save).not.toHaveBeenCalled()
  })
})

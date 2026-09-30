import { afterEach, expect, it, vi } from 'vitest'
import { confirmDialog } from './confirm-dialog'

afterEach(() => vi.unstubAllGlobals())

it('keeps a failed desktop confirmation cancelled instead of opening a system fallback', async () => {
  const systemConfirm = vi.fn(() => true)
  vi.stubGlobal('window', { kunGui: { confirmDialog: vi.fn().mockRejectedValue(new Error('Window failed')) },
    confirm: systemConfirm })
  await expect(confirmDialog('Delete this item?')).resolves.toBe(false)
  expect(systemConfirm).not.toHaveBeenCalled()
})

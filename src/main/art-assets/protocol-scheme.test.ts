import { expect, it, vi } from 'vitest'
import { registerAppSchemes } from '../privileged-schemes'
it('registers artwork and existing protocols in one Electron call', () => {
  const registerSchemesAsPrivileged = vi.fn()
  registerAppSchemes({ registerSchemesAsPrivileged })
  expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
  expect(registerSchemesAsPrivileged.mock.calls[0][0].map((x: { scheme: string }) => x.scheme)).toEqual([
    'kun-extension', 'kun-media', 'kun-workspace-preview', 'kun-app', 'kun-asset'
  ])
})

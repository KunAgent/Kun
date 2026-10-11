import { expect, it, vi } from 'vitest'
import { paperApi } from './paper-api'

const invoke = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

it('exposes paper workspace bootstrap as a fixed no-argument channel', async () => {
  await (paperApi.paperWorkspaceEnsure as (...args: unknown[]) => Promise<unknown>)({ workspaceRoot: '/other' })
  expect(invoke).toHaveBeenCalledExactlyOnceWith('paper-workspace:ensure')
})

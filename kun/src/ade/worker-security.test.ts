import { describe, expect, it } from 'vitest'
import { ChildSecuritySnapshot } from '../delegation/delegation-runtime-contracts.js'
import { workerWorkspaceSecurity } from './worker-security.js'
import { canWritePath } from '../adapters/tool/sandbox-policy.js'

const parent = ChildSecuritySnapshot.parse({ sandboxRoot: '/repo/parent', memoryEnabled: false })
describe('worker workspace security ceiling', () => {
  it('binds unrestricted workspace writes to exactly the isolated checkout', () => {
    const next = workerWorkspaceSecurity(parent, '/repo/worker')
    expect(next.allowedWritePaths).toEqual(['/repo/worker'])
    const context = { workspace: next.sandboxRoot, allowedWritePaths: next.allowedWritePaths, sandboxMode: 'workspace-write' as const }
    expect(canWritePath('/repo/worker/output.txt', context).ok).toBe(true)
    expect(canWritePath('/repo/parent/output.txt', context).ok).toBe(false)
  })
  it('maps narrow relative and absolute ceilings without granting the rest of the checkout', () => {
    const next = workerWorkspaceSecurity({ ...parent, allowedWritePaths: ['src/generated'], allowedReadPaths: ['/repo/parent/src'],
      allowedToolNames: ['read', 'write'] }, '/repo/worker')
    expect(next.allowedWritePaths).toEqual(['/repo/worker/src/generated'])
    expect(next.allowedReadPaths).toEqual(['/repo/worker/src'])
    expect(next.allowedToolNames).toEqual(['read', 'write'])
    const context = { workspace: next.sandboxRoot, allowedWritePaths: next.allowedWritePaths, sandboxMode: 'danger-full-access' as const }
    expect(canWritePath('/repo/worker/src/generated/file', context).ok).toBe(true)
    expect(canWritePath('/repo/worker/src/other', context).ok).toBe(false)
  })
  it('preserves an empty write ceiling and never translates an external or ancestor grant', () => {
    expect(workerWorkspaceSecurity({ ...parent, allowedWritePaths: [] }, '/repo/worker').allowedWritePaths).toEqual([])
    expect(workerWorkspaceSecurity({ ...parent, allowedWritePaths: ['../sibling', '/repo'] }, '/repo/worker').allowedWritePaths).toEqual([])
  })
})

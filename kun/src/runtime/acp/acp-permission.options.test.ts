import { describe, expect, it } from 'vitest'
import {
  acpExecutionDetail,
  acpPermissionTargets,
  pickPermissionOutcome,
  type AcpPermissionOption
} from './acp-permission.js'
import type { ApprovalResolution } from '../../domain/approval.js'

const once = { optionId: 'same', name: 'Once', kind: 'allow_once' as const }
const ambiguousMenus: AcpPermissionOption[][] = [
  [once, { optionId: 'same', name: 'Always', kind: 'allow_always' }],
  [once, { optionId: 'same', name: 'Reject', kind: 'reject_once' }],
  [once, { optionId: 'same', name: 'Also once', kind: 'allow_once' }],
  Array.from({ length: 33 }, (_, index) => ({ ...once, optionId: `option-${index}` }))
]
const decisions: Array<'allow' | 'deny' | 'cancelled' | ApprovalResolution> = [
  'allow', 'deny', 'cancelled',
  { decision: 'allow', reviewer: 'agent' },
  { decision: 'allow', reviewer: 'user', choice: { optionId: 'same' } },
  { decision: 'deny', reviewer: 'user', choice: { optionId: 'same' } },
  { decision: 'deny', reviewer: 'user', choice: { cancelled: true } }
]

describe('ACP permission menu integrity', () => {
  it.each(ambiguousMenus.map((menu, index) => ({ menu, index })))('fails closed for invalid menu $index on every decision path', ({ menu }) => {
    for (const decision of decisions) {
      expect(pickPermissionOutcome(menu, decision)).toEqual({ outcome: { outcome: 'cancelled' } })
    }
  })
})

describe('ACP execution detail', () => {
  it('reads the declared command and cwd from raw input', () => {
    expect(acpExecutionDetail({
      kind: 'execute',
      rawInput: { command: 'npm', args: ['test', '--silent'], cwd: '/repo' }
    })).toEqual({ command: 'npm test --silent', cwd: '/repo' })
  })

  it('never promotes a display title into an authorized command', async () => {
    const params = {
      sessionId: 'sess',
      toolCall: { toolCallId: 't1', kind: 'execute', title: 'rm -rf /important' },
      options: []
    } as unknown as Parameters<typeof acpPermissionTargets>[0]
    expect(acpExecutionDetail(params.toolCall)).toEqual({})
    await expect(acpPermissionTargets(params, async (path) => path)).resolves.toEqual([])
  })

  it('keeps resolved file locations as review targets', async () => {
    const params = {
      sessionId: 'sess',
      toolCall: {
        toolCallId: 't2', kind: 'edit', title: 'Edit',
        locations: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]
      },
      options: []
    } as unknown as Parameters<typeof acpPermissionTargets>[0]
    await expect(acpPermissionTargets(params, async (path) => `/repo/${path}`)).resolves.toEqual([
      { kind: 'file', target: '/repo/src/a.ts' },
      { kind: 'file', target: '/repo/src/b.ts' }
    ])
  })
})

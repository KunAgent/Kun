import { describe, expect, it } from 'vitest'
import { pickPermissionOutcome, type AcpPermissionOption } from './acp-permission.js'
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

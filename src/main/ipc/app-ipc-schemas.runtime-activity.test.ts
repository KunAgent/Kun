import { describe, expect, it } from 'vitest'
import {
  KUN_ACTIVITY_EVENTS_PATH,
  KUN_ACTIVITY_FOREGROUND_PATH,
  KUN_ACTIVITY_PATH,
  KUN_APPROVALS_PATH,
  kunActivityUnitPath
} from '../../shared/kun-endpoints'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('activity runtime request allowlist', () => {
  it('admits the renderer activity and pending approval calls', () => {
    const requests = [
      { path: `${KUN_ACTIVITY_PATH}?scope=all`, method: 'GET' },
      { path: `${KUN_ACTIVITY_EVENTS_PATH}?cursor=next&wait_ms=25000`, method: 'GET' },
      { path: KUN_ACTIVITY_FOREGROUND_PATH, method: 'POST', body: '{"threadId":"t1"}' },
      { path: kunActivityUnitPath('u1', 'ack'), method: 'POST' },
      { path: kunActivityUnitPath('u1', 'dismiss'), method: 'POST' },
      { path: kunActivityUnitPath('u1', 'pin'), method: 'POST', body: '{"pinned":true}' },
      { path: `${KUN_APPROVALS_PATH}?threadId=t1`, method: 'GET' }
    ] as const

    for (const request of requests) {
      expect(runtimeRequestPayloadSchema.parse(request).path).toBe(request.path)
    }
  })

  it('keeps method and hook ingestion restrictions', () => {
    const blocked = [
      { path: KUN_ACTIVITY_PATH, method: 'POST' },
      { path: KUN_ACTIVITY_EVENTS_PATH, method: 'POST' },
      { path: KUN_ACTIVITY_FOREGROUND_PATH, method: 'GET' },
      { path: kunActivityUnitPath('u1', 'ack'), method: 'GET' },
      { path: `${KUN_ACTIVITY_PATH}/u1/unknown`, method: 'POST' },
      { path: `${KUN_ACTIVITY_PATH}/hooks`, method: 'POST' },
      { path: KUN_APPROVALS_PATH, method: 'POST' }
    ] as const

    for (const request of blocked) {
      expect(() => runtimeRequestPayloadSchema.parse(request)).toThrow(
        /runtime request path is not allowed/
      )
    }
  })
})

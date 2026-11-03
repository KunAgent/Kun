import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkSlotsStore } from './work-slots-store'

describe('work slots store', () => {
  beforeEach(() => {
    useWorkSlotsStore.setState({ assistantMain: false })
  })

  it('swaps which slot the session owns', () => {
    useWorkSlotsStore.getState().swap()
    expect(useWorkSlotsStore.getState().assistantMain).toBe(true)
    useWorkSlotsStore.getState().swap()
    expect(useWorkSlotsStore.getState().assistantMain).toBe(false)
  })

  it('setAssistantMain is idempotent', () => {
    useWorkSlotsStore.getState().setAssistantMain(true)
    useWorkSlotsStore.getState().setAssistantMain(true)
    expect(useWorkSlotsStore.getState().assistantMain).toBe(true)
  })
})

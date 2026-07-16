import { describe, expect, it } from 'vitest'
import { summarizeTeamProgress, taskControlActions } from './ExpertTeamProgressDrawer'

describe('ExpertTeamProgressDrawer helpers', () => {
  it('summarizes running, interrupted, and completed tasks', () => {
    expect(summarizeTeamProgress([
      { status: 'in_progress' },
      { status: 'interrupted' },
      { status: 'completed' }
    ])).toEqual({ total: 3, running: 1, interrupted: 1, completed: 1 })
  })

  it('offers interrupt for running tasks and continue for recoverable tasks', () => {
    expect(taskControlActions('in_progress')).toEqual(['interrupt'])
    expect(taskControlActions('interrupted')).toEqual(['retry'])
    expect(taskControlActions('failed')).toEqual(['retry'])
    expect(taskControlActions('completed')).toEqual([])
  })
})

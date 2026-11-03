import { describe, expect, it } from 'vitest'
import { useWorkSessionStore } from './work-session-store'

describe('work session titles', () => {
  it('remembers listed titles and ignores empty ones', () => {
    useWorkSessionStore.getState().rememberTitles([
      { id: 't1', title: 'Fast Context：把找代码与改代码' },
      { id: 't2', title: '' },
      { id: '', title: 'x' }
    ])
    const { titles } = useWorkSessionStore.getState()
    expect(titles.t1).toBe('Fast Context：把找代码与改代码')
    expect(titles.t2).toBeUndefined()
  })
})

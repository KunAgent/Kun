import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultScheduleSettings } from '@shared/app-settings'
import { SessionDaemonsView } from './SessionDaemonsView'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: { threads: never[] }) => unknown) => selector({ threads: [] })
}))

describe('SessionDaemonsView master control', () => {
  it('renders one discoverable switch and explains keep-awake independently', () => {
    const schedule = defaultScheduleSettings()
    const html = renderToStaticMarkup(createElement(SessionDaemonsView, {
      schedule,
      clawChannels: [],
      defaultWorkspaceRoot: '/workspace',
      onPatchSchedule: vi.fn(async () => schedule)
    }))

    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('daemonMasterTitle')
    expect(html).toContain('daemonMasterOff')
    expect(html).toContain('daemonKeepAwakeHint')
  })
})

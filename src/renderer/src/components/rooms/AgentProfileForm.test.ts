import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentIdentity } from '@shared/rooms-api'
import { AgentProfileForm } from './AgentProfileForm'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./RoomAvatarPicker', () => ({ RoomAvatarPicker: () => null }))
vi.mock('./AgentPicker', () => ({ AgentPicker: () => null }))
vi.mock('./agent-client', () => ({ agentMember: () => ({ id: 'agent', displayName: 'Agent' }),
  agentPath: () => '', useAgentResource: () => ({}) }))

function workField(external: boolean, work?: 'read' | 'auto') {
  const agent: AgentIdentity = { schemaVersion: 1, id: 'agent', revision: 0, name: 'Agent', title: '', instructions: '',
    defaultRole: 'developer', presetId: 'general', memory: { readEnabled: false, captureEnabled: false },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...(external ? { executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'fixture' } } : {}),
    ...(work ? { workbench: { code: 'confirm', maxActiveTasks: 3, work } } : {}) }
  const html = renderToStaticMarkup(createElement(AgentProfileForm, { agent, onSaved: () => {} }))
  const select = html.match(/roomsWorkbenchPolicyWork<select[^>]*>(.*?)<\/select>/s)?.[1] ?? ''
  return { options: [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]),
    selected: select.match(/<option value="([^"]+)" selected/)?.[1], hint: html.includes('roomsWorkbenchExternalWorkHint') }
}

describe('Work document profile choices', () => {
  it('offers external Agents only off and explicit read, with an explanation', () => {
    expect(workField(true)).toMatchObject({ options: ['off', 'read'], selected: 'off', hint: true })
    expect(workField(true, 'read').selected).toBe('read')
    expect(workField(true, 'auto').selected).toBe('off')
  })

  it('keeps ordinary Kun choices and defaults', () => {
    expect(workField(false)).toMatchObject({ options: ['off', 'read', 'confirm', 'auto'], selected: 'read', hint: false })
  })
})

import { describe, expect, it } from 'vitest'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { resolveCodeRightToolClick } from './useWorkbenchRightTools'

describe('resolveCodeRightToolClick', () => {
  it('collapses the panel when the clicked tool is already visible', () => {
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas
    )).toBe('collapse')
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.changes,
      BUILTIN_RIGHT_PANEL_IDS.changes
    )).toBe('collapse')
  })

  it('opens the tool when another tool or no tool is visible', () => {
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      BUILTIN_RIGHT_PANEL_IDS.changes
    )).toBe('open')
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
      null
    )).toBe('open')
  })

  it('keeps the terminal on its own toggle path', () => {
    expect(resolveCodeRightToolClick(BUILTIN_RIGHT_PANEL_IDS.terminal, null)).toBe('toggle-terminal')
    expect(resolveCodeRightToolClick(
      BUILTIN_RIGHT_PANEL_IDS.terminal,
      BUILTIN_RIGHT_PANEL_IDS.providerQuotas
    )).toBe('toggle-terminal')
  })

  it('collapses an active extension right-rail view', () => {
    const extensionId = 'extension:example/right-panel' as const
    expect(resolveCodeRightToolClick(extensionId, extensionId)).toBe('collapse')
  })
})

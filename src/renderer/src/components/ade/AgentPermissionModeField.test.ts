import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentPermissionModeField } from './AgentPermissionModeField'
import { AgentSettingsSelect } from './AgentSettingsSelect'
import { normalizeKunHarnessSettings } from '@shared/app-settings-kun-harness'
import { nativePermissionPreview } from '../../lib/harness-native-permission'

const t = (key: string): string => key
const modes = [{ id: 'default', label: 'Default', kunPermissionMode: 'ask-for-approval' as const }]
let tree: ReactTestRenderer
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { if (tree) act(() => tree.unmount()); vi.unstubAllGlobals() })
function mount(value = '') {
  const onChange = vi.fn(), onEditingChange = vi.fn()
  act(() => { tree = create(createElement(AgentPermissionModeField, { value, modes, disabled: false, onChange, onEditingChange, t })) })
  const select = (value: string) => act(() => tree.root.findByType(AgentSettingsSelect).props.onChange(value))
  const input = (value: string) => act(() => tree.root.findByType('input').props.onChange({ target: { value } }))
  const button = (key: string) => tree.root.findAllByType('button').find(node => node.children.includes(`adeSettings.harnessPermissionCustom${key}`))!
  return { onChange, onEditingChange, select, input, button }
}
it('keeps custom typing local, applies a trimmed value, and exposes preset and automatic options', () => {
  const f = mount()
  f.select('custom')
  f.input('  yolo  ')
  expect(f.onChange).not.toHaveBeenCalled()
  expect(f.onEditingChange).toHaveBeenLastCalledWith(true)
  act(() => f.button('Apply').props.onClick())
  expect(f.onChange).toHaveBeenLastCalledWith('yolo')
  expect(f.onEditingChange).toHaveBeenLastCalledWith(false)
  f.select('preset:default')
  expect(f.onChange).toHaveBeenLastCalledWith('default')
  f.select('')
  expect(f.onChange).toHaveBeenLastCalledWith('')
})
it('rehydrates a saved custom mode, cancels edits, and clears whitespace to automatic', () => {
  const saved = normalizeKunHarnessSettings({ defaults: { qoder: { permissionMode: 'yolo' } } })
  const f = mount(saved.defaults.qoder.permissionMode)
  expect(tree.root.findByType('input').props.value).toBe('yolo')
  f.input('other')
  act(() => f.button('Cancel').props.onClick())
  expect(tree.root.findByType('input').props.value).toBe('yolo')
  expect(f.onChange).not.toHaveBeenCalled()
  f.input('   ')
  act(() => f.button('Apply').props.onClick())
  expect(f.onChange).toHaveBeenLastCalledWith('')
})
it.each(['x'.repeat(65), 'yolo\n', '\tyolo'])('rejects invalid input without saving or truncating: %j', value => {
  const f = mount('yolo')
  f.input(value)
  expect(tree.root.findByType('input').props['aria-invalid']).toBe(true)
  expect(tree.root.findByType('input').props.value).toBe(value)
  expect(f.button('Apply').props.disabled).toBe(true)
  act(() => f.button('Apply').props.onClick())
  expect(f.onChange).not.toHaveBeenCalled()
  expect(() => normalizeKunHarnessSettings({ defaults: { qoder: { permissionMode: value } } })).toThrow()
})
it('previews unknown modes honestly and preserves non-ACP behavior', () => {
  expect(nativePermissionPreview('qoder', modes, 'full-access', 'yolo', 'acp')).toMatchObject({ id: 'yolo', readOnly: false, requiresFullAccess: false })
  expect(nativePermissionPreview('qoder', modes, 'ask-for-approval', 'yolo', 'acp')).toMatchObject({ id: 'yolo', readOnly: false, requiresFullAccess: true })
  expect(nativePermissionPreview('claude-code', modes, 'full-access', 'yolo', 'agent-sdk')).toMatchObject({ id: 'default' })
})

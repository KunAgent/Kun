import { describe, expect, it } from 'vitest'
import { toElectronAccelerator } from './shortcut'

describe('daily notes global shortcut accelerator conversion', () => {
  it('maps normalized Kun chords to Electron accelerators', () => {
    const expectedMeta = process.platform === 'darwin' ? 'Command+Shift+D' : 'Super+Shift+D'
    expect(toElectronAccelerator('Meta+Shift+D')).toBe(expectedMeta)
    expect(toElectronAccelerator('Ctrl+Shift+D')).toBe('Control+Shift+D')
    expect(toElectronAccelerator('Alt+ArrowRight')).toBe('Alt+Right')
    expect(toElectronAccelerator('')).toBeNull()
    expect(toElectronAccelerator('D')).toBeNull()
  })
})

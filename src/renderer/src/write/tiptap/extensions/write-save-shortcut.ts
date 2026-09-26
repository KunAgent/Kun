import { Extension } from '@tiptap/core'

/**
 * Mod-s saves the document; Mod-f / Mod-Alt-f open the find bar. Lives in
 * an extension so the shortcuts register and die with the editor.
 */
export const WriteSaveShortcut = Extension.create<{
  onSave: () => void
  onFind: (withReplace: boolean) => void
}>({
  name: 'writeSaveShortcut',
  addOptions() {
    return { onSave: () => undefined, onFind: () => undefined }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-s': () => {
        this.options.onSave()
        return true
      },
      'Mod-f': () => {
        this.options.onFind(false)
        return true
      },
      'Mod-Alt-f': () => {
        this.options.onFind(true)
        return true
      }
    }
  }
})

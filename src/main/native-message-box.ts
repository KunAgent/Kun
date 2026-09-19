import { dialog, type BrowserWindow } from 'electron'
import type { NativeDialogCoordinator } from './native-dialog-coordinator'

export function showCoordinatedMessageBox(coordinator: NativeDialogCoordinator, parent: BrowserWindow,
  options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return coordinator.run(parent.webContents, async () => {
    if (parent.isDestroyed()) throw new Error('Native dialog parent window is unavailable.')
    return dialog.showMessageBox(parent, options)
  })
}

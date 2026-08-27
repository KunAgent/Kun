import { app, BrowserWindow, dialog, shell } from 'electron'
import type { MessageBoxOptions } from 'electron'
import type { AppLocale } from '../shared/app-locales'
import {
  changelogUrl,
  DEVELOPMENT_APP_FLAVOR,
  isVersionGreater,
  readGuiVersionState,
  writeGuiVersionState
} from './gui-updater-support'

export async function showGuiUpdateReleaseNotes(
  getMainWindow: (() => BrowserWindow | null) | null,
  getSelectedLocale: (() => AppLocale | Promise<AppLocale>) | null
): Promise<void> {
  if (DEVELOPMENT_APP_FLAVOR || !app.isPackaged) return
  const currentVersion = app.getVersion().trim()
  const state = await readGuiVersionState()
  if (!state.lastSeenVersion) {
    await writeGuiVersionState({ ...state, lastSeenVersion: currentVersion })
    return
  }
  if (state.lastSeenVersion === currentVersion || !isVersionGreater(currentVersion, state.lastSeenVersion)) return
  const pendingUpdate = state.pendingUpdate?.version === currentVersion ? state.pendingUpdate : undefined
  await writeGuiVersionState({ lastSeenVersion: currentVersion })
  const isZh = await selectedLocale(getSelectedLocale) === 'zh'
  const options: MessageBoxOptions = {
    type: 'info',
    title: isZh ? 'Kun 已更新' : 'Kun updated',
    message: isZh ? `已更新到 Kun ${currentVersion}` : `Kun has been updated to ${currentVersion}`,
    detail: pendingUpdate?.releaseNotes ?? (isZh
      ? '此版本的完整更新内容可在 Kun 更新日志中查看。'
      : 'See the Kun changelog for the complete release notes.'),
    buttons: isZh ? ['查看更新日志', '稍后'] : ['View changelog', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  }
  const window = getMainWindow?.()
  const result = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  if (result.response === 0) await shell.openExternal(changelogUrl(currentVersion))
}

async function selectedLocale(
  getSelectedLocale: (() => AppLocale | Promise<AppLocale>) | null
): Promise<'en' | 'zh'> {
  try {
    return (await getSelectedLocale?.()) === 'zh' ? 'zh' : 'en'
  } catch {
    return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
}
